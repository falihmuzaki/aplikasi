import 'dotenv/config'
import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { sendOtpEmail } from './mailer.js'

const { Pool } = pg
const app = express()
const port = Number(process.env.PORT || 3001)
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql')

app.use(cors())
app.use(express.json({ limit: '8mb' }))

const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'lumina-dev-token-secret-change-me'
const TOKEN_TTL_SECONDS = 7 * 24 * 3600

// In-memory sliding-window rate limiter. No external dependency, consistent with the
// rest of this server. State lives in a single process; for multi-instance deploys this
// should move to a shared store (e.g. Redis). Each limiter keeps timestamps per key and
// drops any older than windowMs before counting.
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map()
  // Periodically evict stale keys so the map doesn't grow unbounded.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((time) => time > cutoff)
      if (fresh.length) hits.set(key, fresh)
      else hits.delete(key)
    }
  }, windowMs)
  sweep.unref?.()

  const middleware = (request, response, next) => {
    const ip = request.ip || request.socket?.remoteAddress || 'unknown'
    const email = String(request.body?.email || '').trim().toLowerCase()
    const key = `${ip}|${email}`
    const now = Date.now()
    const timestamps = (hits.get(key) || []).filter((time) => time > now - windowMs)
    if (timestamps.length >= max) {
      const retryAfterSec = Math.ceil((timestamps[0] + windowMs - now) / 1000)
      response.setHeader('Retry-After', String(retryAfterSec))
      return response.status(429).json({ message })
    }
    timestamps.push(now)
    hits.set(key, timestamps)
    // Expose a reset so a successful auth can clear the counter for this key.
    request.clearRateLimit = () => hits.delete(key)
    next()
  }
  return middleware
}

// Login/OTP verification: strict, protects against password and OTP brute force.
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Terlalu banyak percobaan. Coba lagi dalam beberapa menit.',
})
// OTP/email dispatch (resend, forgot, reset): protects against email flooding.
const otpSendLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Terlalu banyak permintaan kode. Coba lagi nanti.',
})

const productFields = 'id, name, category, price, stock, status, media_name, media_type, media_url, created_at, updated_at'
const userFields = 'id, name, email, role, is_active, mfa_enabled, created_at, updated_at'
const categoryFields = 'id, name, created_at, updated_at'

function normalizeCategory(row) {
  return { id: Number(row.id), name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

function normalizeProduct(row) {
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category,
    price: Number(row.price),
    stock: row.stock,
    status: row.status,
    media: row.media_url ? { name: row.media_name, type: row.media_type, url: row.media_url } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function productValues(body) {
  const stock = Number(body.stock) || 0
  return [body.name, body.category, Number(body.price) || 0, stock, stock === 0 ? 'Out of stock' : body.status || 'Active', body.media?.name || null, body.media?.type || null, body.media?.url || null]
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(':')
  if (!salt || !hash) return false
  const derivedHash = crypto.scryptSync(password, salt, 64)
  const expectedHash = Buffer.from(hash, 'hex')
  return expectedHash.length === derivedHash.length && crypto.timingSafeEqual(expectedHash, derivedHash)
}

function normalizeUser(row) {
  return { id: Number(row.id), name: row.name, email: row.email, role: row.role, isActive: row.is_active, mfaEnabled: row.mfa_enabled, createdAt: row.created_at, updatedAt: row.updated_at }
}

function signToken(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })).toString('base64url')
  const signature = crypto.createHmac('sha256', AUTH_TOKEN_SECRET).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function verifyToken(token) {
  const [payload, signature] = String(token || '').split('.')
  if (!payload || !signature) return null
  const expected = crypto.createHmac('sha256', AUTH_TOKEN_SECRET).update(payload).digest('base64url')
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!data.uid || typeof data.exp !== 'number' || data.exp <= Math.floor(Date.now() / 1000)) return null
    return { uid: data.uid }
  } catch { return null }
}

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashOtp(code) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${crypto.scryptSync(code, salt, 64).toString('hex')}`
}

function verifyOtp(code, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':')
  if (!salt || !hash) return false
  const derivedHash = crypto.scryptSync(code, salt, 64)
  const expectedHash = Buffer.from(hash, 'hex')
  return expectedHash.length === derivedHash.length && crypto.timingSafeEqual(expectedHash, derivedHash)
}

function requireAuth(request, response, next) {
  const header = request.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const payload = verifyToken(token)
  if (!payload) return response.status(401).json({ message: 'Sesi tidak valid. Silakan masuk kembali.' })
  request.userId = payload.uid
  next()
}

// Approach (a): the token stays {uid, exp} and never carries the role, so the
// client can't forge privilege. requireAdmin runs AFTER requireAuth (request.userId set)
// and reads the authoritative role from the DB with a parameterized query. Any user that
// isn't an active admin (including a missing/inactive row) gets 403.
async function requireAdmin(request, response, next) {
  try {
    const result = await pool.query('SELECT role FROM users WHERE id=$1 AND is_active=TRUE', [request.userId])
    const user = result.rows[0]
    if (!user || user.role !== 'admin') return response.status(403).json({ message: 'Akses ditolak. Hanya admin yang diizinkan.' })
    next()
  } catch (error) { next(error) }
}

app.get('/api/health', async (_request, response) => {
  const result = await pool.query('SELECT NOW() AS now')
  response.json({ ok: true, databaseTime: result.rows[0].now })
})

app.post('/api/auth/login', loginLimiter, async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const password = String(request.body.password || '')
    const result = await pool.query(`SELECT ${userFields}, password_hash FROM users WHERE email=$1 AND is_active=TRUE`, [email])
    const user = result.rows[0]
    if (!user || !verifyPassword(password, user.password_hash)) return response.status(401).json({ message: 'Email atau password tidak sesuai.' })
    request.clearRateLimit?.()
    if (user.mfa_enabled) {
      const code = generateOtp()
      await pool.query("UPDATE users SET login_otp_hash=$1, login_otp_expires_at=NOW() + INTERVAL '10 minutes', updated_at=NOW() WHERE id=$2", [hashOtp(code), user.id])
      await sendOtpEmail({ to: user.email, code, purpose: 'login' })
      return response.json({ requiresOtp: true })
    }
    response.json({ user: normalizeUser(user), token: signToken(user.id) })
  } catch (error) { next(error) }
})

app.post('/api/auth/otp/verify', loginLimiter, async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const otp = String(request.body.otp || '')
    const result = await pool.query(`SELECT ${userFields}, login_otp_hash, login_otp_expires_at FROM users WHERE email=$1 AND is_active=TRUE`, [email])
    const user = result.rows[0]
    if (!user || !user.login_otp_hash || new Date(user.login_otp_expires_at) <= new Date() || !verifyOtp(otp, user.login_otp_hash)) {
      return response.status(400).json({ message: 'Kode OTP tidak valid atau sudah kedaluwarsa.' })
    }
    request.clearRateLimit?.()
    await pool.query('UPDATE users SET login_otp_hash=NULL, login_otp_expires_at=NULL, updated_at=NOW() WHERE id=$1', [user.id])
    response.json({ user: normalizeUser(user), token: signToken(user.id) })
  } catch (error) { next(error) }
})

app.post('/api/auth/otp/resend', otpSendLimiter, async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const result = await pool.query('SELECT id, email FROM users WHERE email=$1 AND is_active=TRUE', [email])
    const user = result.rows[0]
    if (user) {
      const code = generateOtp()
      await pool.query("UPDATE users SET login_otp_hash=$1, login_otp_expires_at=NOW() + INTERVAL '10 minutes', updated_at=NOW() WHERE id=$2", [hashOtp(code), user.id])
      await sendOtpEmail({ to: user.email, code, purpose: 'login' })
    }
    response.json({ message: 'Kode OTP baru telah dikirim.' })
  } catch (error) { next(error) }
})

app.post('/api/auth/password/forgot', otpSendLimiter, async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const result = await pool.query('SELECT id, email FROM users WHERE email=$1 AND is_active=TRUE', [email])
    const user = result.rows[0]
    if (user) {
      const code = generateOtp()
      await pool.query("UPDATE users SET reset_otp_hash=$1, reset_otp_expires_at=NOW() + INTERVAL '10 minutes', updated_at=NOW() WHERE id=$2", [hashOtp(code), user.id])
      await sendOtpEmail({ to: user.email, code, purpose: 'reset' })
    }
    response.json({ message: 'Jika email terdaftar, kode reset telah dikirim.' })
  } catch (error) { next(error) }
})

app.post('/api/auth/password/reset', loginLimiter, async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const otp = String(request.body.otp || '')
    const password = String(request.body.password || '')
    const passwordConfirmation = String(request.body.password_confirmation || '')
    const result = await pool.query('SELECT id, reset_otp_hash, reset_otp_expires_at FROM users WHERE email=$1 AND is_active=TRUE', [email])
    const user = result.rows[0]
    if (!user || !user.reset_otp_hash || new Date(user.reset_otp_expires_at) <= new Date() || !verifyOtp(otp, user.reset_otp_hash)) {
      return response.status(400).json({ message: 'Kode OTP tidak valid atau sudah kedaluwarsa.' })
    }
    if (password !== passwordConfirmation || password.length < 8) {
      return response.status(400).json({ message: 'Password minimal 8 karakter dan konfirmasi harus sama.' })
    }
    await pool.query('UPDATE users SET password_hash=$1, reset_otp_hash=NULL, reset_otp_expires_at=NULL, updated_at=NOW() WHERE id=$2', [hashPassword(password), user.id])
    response.json({ message: 'Password berhasil diperbarui. Silakan masuk.' })
  } catch (error) { next(error) }
})

app.get('/api/products', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT ${productFields} FROM products ORDER BY created_at DESC`)
    response.json(result.rows.map(normalizeProduct))
  } catch (error) { next(error) }
})

app.post('/api/products', requireAuth, async (request, response, next) => {
  try {
    const values = productValues(request.body)
    const result = await pool.query(`INSERT INTO products (name, category, price, stock, status, media_name, media_type, media_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${productFields}`, values)
    response.status(201).json(normalizeProduct(result.rows[0]))
  } catch (error) { next(error) }
})

app.put('/api/products/:id', requireAuth, async (request, response, next) => {
  try {
    const values = productValues(request.body)
    const result = await pool.query(`UPDATE products SET name=$1, category=$2, price=$3, stock=$4, status=$5, media_name=$6, media_type=$7, media_url=$8, updated_at=NOW() WHERE id=$9 RETURNING ${productFields}`, [...values, request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Product not found' })
    response.json(normalizeProduct(result.rows[0]))
  } catch (error) { next(error) }
})

app.delete('/api/products/:id', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id=$1', [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Product not found' })
    response.status(204).end()
  } catch (error) { next(error) }
})

app.get('/api/users', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT ${userFields} FROM users ORDER BY created_at DESC`)
    response.json(result.rows.map(normalizeUser))
  } catch (error) { next(error) }
})

app.post('/api/users', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const { name, email, password, role = 'staff', isActive = true, mfaEnabled = false } = request.body
    if (!name || !email || !password) return response.status(400).json({ message: 'Name, email, and password are required' })
    const result = await pool.query(`INSERT INTO users (name, email, password_hash, role, is_active, mfa_enabled) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${userFields}`, [name, email.toLowerCase(), hashPassword(password), role, isActive, mfaEnabled])
    response.status(201).json(normalizeUser(result.rows[0]))
  } catch (error) { next(error) }
})

app.put('/api/users/:id', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const { name, email, password, role = 'staff', isActive = true, mfaEnabled = false } = request.body
    const values = [name, email.toLowerCase(), role, isActive, mfaEnabled]
    const passwordPart = password ? ', password_hash=$6' : ''
    if (password) values.push(hashPassword(password))
    values.push(request.params.id)
    const result = await pool.query(`UPDATE users SET name=$1, email=$2, role=$3, is_active=$4, mfa_enabled=$5${passwordPart}, updated_at=NOW() WHERE id=$${password ? 7 : 6} RETURNING ${userFields}`, values)
    if (!result.rowCount) return response.status(404).json({ message: 'User not found' })
    response.json(normalizeUser(result.rows[0]))
  } catch (error) { next(error) }
})

app.delete('/api/users/:id', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const result = await pool.query('DELETE FROM users WHERE id=$1', [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'User not found' })
    response.status(204).end()
  } catch (error) { next(error) }
})

// --- Categories: read for any authenticated user, writes restricted to admins. ---
// Each category row carries a live product usage count so the UI can show it and so
// deletes can be refused while a category is still referenced by products.

app.get('/api/categories', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.created_at, c.updated_at,
             COUNT(p.id)::int AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category = c.name
      GROUP BY c.id
      ORDER BY c.name ASC
    `)
    response.json(result.rows.map((row) => ({ ...normalizeCategory(row), productCount: row.product_count })))
  } catch (error) { next(error) }
})

app.post('/api/categories', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const name = String(request.body.name || '').trim()
    if (!name) return response.status(400).json({ message: 'Nama kategori wajib diisi.' })
    const result = await pool.query(`INSERT INTO categories (name) VALUES ($1) RETURNING ${categoryFields}`, [name])
    response.status(201).json({ ...normalizeCategory(result.rows[0]), productCount: 0 })
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'Kategori dengan nama itu sudah ada.' })
    next(error)
  }
})

app.put('/api/categories/:id', requireAuth, requireAdmin, async (request, response, next) => {
  const client = await pool.connect()
  try {
    const name = String(request.body.name || '').trim()
    if (!name) return response.status(400).json({ message: 'Nama kategori wajib diisi.' })
    await client.query('BEGIN')
    const existing = await client.query('SELECT name FROM categories WHERE id=$1 FOR UPDATE', [request.params.id])
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Kategori tidak ditemukan.' })
    }
    const oldName = existing.rows[0].name
    const result = await client.query(`UPDATE categories SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING ${categoryFields}`, [name, request.params.id])
    // Keep product rows (which store category as text) in sync when a category is renamed.
    let affected = 0
    if (oldName !== name) {
      const sync = await client.query('UPDATE products SET category=$1, updated_at=NOW() WHERE category=$2', [name, oldName])
      affected = sync.rowCount
    }
    await client.query('COMMIT')
    response.json({ ...normalizeCategory(result.rows[0]), productCount: affected || 0, renamedProducts: affected })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505') return response.status(409).json({ message: 'Kategori dengan nama itu sudah ada.' })
    next(error)
  } finally {
    client.release()
  }
})

app.delete('/api/categories/:id', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const found = await pool.query('SELECT name FROM categories WHERE id=$1', [request.params.id])
    if (!found.rowCount) return response.status(404).json({ message: 'Kategori tidak ditemukan.' })
    const used = await pool.query('SELECT COUNT(*)::int AS count FROM products WHERE category=$1', [found.rows[0].name])
    if (used.rows[0].count > 0) {
      return response.status(409).json({ message: `Kategori masih dipakai ${used.rows[0].count} produk. Pindahkan produk tersebut lebih dulu.` })
    }
    await pool.query('DELETE FROM categories WHERE id=$1', [request.params.id])
    response.status(204).end()
  } catch (error) { next(error) }
})

// --- Self-service profile (any authenticated user manages their own account) ---

app.get('/api/auth/me', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(`SELECT ${userFields} FROM users WHERE id=$1 AND is_active=TRUE`, [request.userId])
    const user = result.rows[0]
    if (!user) return response.status(404).json({ message: 'Akun tidak ditemukan.' })
    response.json(normalizeUser(user))
  } catch (error) { next(error) }
})

app.put('/api/auth/profile', requireAuth, async (request, response, next) => {
  try {
    const name = String(request.body.name || '').trim()
    const email = String(request.body.email || '').trim().toLowerCase()
    if (!name || !email) return response.status(400).json({ message: 'Nama dan email wajib diisi.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ message: 'Format email tidak valid.' })
    const result = await pool.query(`UPDATE users SET name=$1, email=$2, updated_at=NOW() WHERE id=$3 RETURNING ${userFields}`, [name, email, request.userId])
    if (!result.rowCount) return response.status(404).json({ message: 'Akun tidak ditemukan.' })
    response.json(normalizeUser(result.rows[0]))
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'Email sudah digunakan akun lain.' })
    next(error)
  }
})

app.post('/api/auth/password/change', requireAuth, async (request, response, next) => {
  try {
    const currentPassword = String(request.body.currentPassword || '')
    const newPassword = String(request.body.newPassword || '')
    const confirmation = String(request.body.newPasswordConfirmation || '')
    if (newPassword.length < 8) return response.status(400).json({ message: 'Password baru minimal 8 karakter.' })
    if (newPassword !== confirmation) return response.status(400).json({ message: 'Konfirmasi password tidak sama.' })
    const result = await pool.query('SELECT password_hash FROM users WHERE id=$1 AND is_active=TRUE', [request.userId])
    const user = result.rows[0]
    if (!user) return response.status(404).json({ message: 'Akun tidak ditemukan.' })
    if (!verifyPassword(currentPassword, user.password_hash)) return response.status(400).json({ message: 'Password saat ini tidak sesuai.' })
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hashPassword(newPassword), request.userId])
    response.json({ message: 'Password berhasil diperbarui.' })
  } catch (error) { next(error) }
})

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ message: 'Database request failed' })
})

try {
  const schema = await fs.readFile(schemaPath, 'utf8')
  await pool.query(schema)
  app.listen(port, () => console.log(`API ready at http://localhost:${port}`))
} catch (error) {
  console.error('Unable to initialize PostgreSQL. Check DATABASE_URL and ensure the database exists.')
  console.error(error.message)
  process.exitCode = 1
}
