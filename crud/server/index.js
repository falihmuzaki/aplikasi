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

const productFields = 'id, name, category, price, stock, status, media_name, media_type, media_url, low_stock_threshold, sku, deleted_at, created_at, updated_at'
const userFields = 'id, name, email, role, is_active, mfa_enabled, avatar_url, created_at, updated_at'
const categoryFields = 'id, name, created_at, updated_at'

function normalizeCategory(row) {
  return { id: Number(row.id), name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

function normalizeSupplier(row) {
  return {
    id: Number(row.id),
    name: row.name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    purchaseCount: Number(row.purchase_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizePurchaseOrder(row) {
  return {
    id: Number(row.id),
    orderNumber: row.order_number,
    supplierId: Number(row.supplier_id),
    supplierName: row.supplier_name,
    status: row.status,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: row.items || [],
  }
}

function normalizeCustomer(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    orderCount: Number(row.order_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeSalesOrder(row) {
  return {
    id: Number(row.id),
    orderNumber: row.order_number,
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    status: row.status,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (row.items || []).map((item) => ({
      ...item,
      productId: Number(item.productId),
      quantity: Number(item.quantity),
      returnedQuantity: Number(item.returnedQuantity),
      unitPrice: Number(item.unitPrice),
    })),
  }
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
    sku: row.sku ?? null,
    lowStockThreshold: row.low_stock_threshold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function productValues(body) {
  const stock = Number(body.stock) || 0
  return [body.name, body.category, Number(body.price) || 0, stock, stock === 0 ? 'Out of stock' : body.status || 'Active', body.media?.name || null, body.media?.type || null, body.media?.url || null, Math.max(0, Number.parseInt(body.lowStockThreshold, 10) || 5)]
}

function generateSku() {
  return 'SKU-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase()
}

function normalizeMovement(row) {
  return { id: Number(row.id), productId: row.product_id === null ? null : Number(row.product_id), userId: row.user_id === null ? null : Number(row.user_id), userName: row.user_name ?? null, delta: row.delta, stockBefore: row.stock_before, stockAfter: row.stock_after, reason: row.reason ?? null, createdAt: row.created_at }
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
  return { id: Number(row.id), name: row.name, email: row.email, role: row.role, isActive: row.is_active, mfaEnabled: row.mfa_enabled, avatarUrl: row.avatar_url || null, createdAt: row.created_at, updatedAt: row.updated_at }
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

// Public self-registration. New accounts are always role 'staff' and created inactive
// (is_active=FALSE) until a registration OTP is verified; role is never read from the body.
app.post('/api/auth/register', otpSendLimiter, async (request, response, next) => {
  try {
    const name = String(request.body.name || '').trim()
    const email = String(request.body.email || '').trim().toLowerCase()
    const password = String(request.body.password || '')
    const passwordConfirmation = String(request.body.password_confirmation || '')
    if (!name) return response.status(400).json({ message: 'Nama wajib diisi.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ message: 'Format email tidak valid.' })
    if (password !== passwordConfirmation || password.length < 8) return response.status(400).json({ message: 'Password minimal 8 karakter dan konfirmasi harus sama.' })
    const existing = await pool.query('SELECT id, is_active FROM users WHERE email=$1', [email])
    const user = existing.rows[0]
    if (user && user.is_active) return response.status(409).json({ message: 'Email sudah terdaftar.' })
    const code = generateOtp()
    if (user) {
      await pool.query("UPDATE users SET name=$1, password_hash=$2, role='staff', register_otp_hash=$3, register_otp_expires_at=NOW() + INTERVAL '10 minutes', updated_at=NOW() WHERE id=$4", [name, hashPassword(password), hashOtp(code), user.id])
    } else {
      await pool.query("INSERT INTO users (name, email, password_hash, role, is_active, register_otp_hash, register_otp_expires_at) VALUES ($1,$2,$3,'staff',FALSE,$4,NOW() + INTERVAL '10 minutes')", [name, email, hashPassword(password), hashOtp(code)])
    }
    await sendOtpEmail({ to: email, code, purpose: 'register' })
    response.json({ message: 'Kode verifikasi telah dikirim ke email Anda.', requiresOtp: true })
  } catch (error) { next(error) }
})

app.post('/api/auth/register/verify', loginLimiter, async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const otp = String(request.body.otp || '')
    const result = await pool.query(`SELECT ${userFields}, register_otp_hash, register_otp_expires_at FROM users WHERE email=$1 AND is_active=FALSE`, [email])
    const user = result.rows[0]
    if (!user || !user.register_otp_hash || new Date(user.register_otp_expires_at) <= new Date() || !verifyOtp(otp, user.register_otp_hash)) {
      return response.status(400).json({ message: 'Kode OTP tidak valid atau sudah kedaluwarsa.' })
    }
    request.clearRateLimit?.()
    const updated = await pool.query(`UPDATE users SET is_active=TRUE, register_otp_hash=NULL, register_otp_expires_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING ${userFields}`, [user.id])
    response.json({ user: normalizeUser(updated.rows[0]), token: signToken(user.id) })
  } catch (error) { next(error) }
})

app.post('/api/auth/register/resend', otpSendLimiter, async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const result = await pool.query('SELECT id, email FROM users WHERE email=$1 AND is_active=FALSE', [email])
    const user = result.rows[0]
    if (user) {
      const code = generateOtp()
      await pool.query("UPDATE users SET register_otp_hash=$1, register_otp_expires_at=NOW() + INTERVAL '10 minutes', updated_at=NOW() WHERE id=$2", [hashOtp(code), user.id])
      await sendOtpEmail({ to: user.email, code, purpose: 'register' })
    }
    response.json({ message: 'Kode verifikasi baru telah dikirim.' })
  } catch (error) { next(error) }
})

app.get('/api/products', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT ${productFields} FROM products WHERE deleted_at IS NULL ORDER BY created_at DESC`)
    response.json(result.rows.map(normalizeProduct))
  } catch (error) { next(error) }
})

app.get('/api/products/archived', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT ${productFields} FROM products WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
    response.json(result.rows.map(normalizeProduct))
  } catch (error) { next(error) }
})

app.get('/api/products/low-stock', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT ${productFields} FROM products WHERE deleted_at IS NULL AND stock <= low_stock_threshold ORDER BY stock ASC`)
    response.json(result.rows.map(normalizeProduct))
  } catch (error) { next(error) }
})

app.get('/api/stats', requireAuth, async (_request, response, next) => {
  try {
    const totals = await pool.query('SELECT COUNT(*)::int AS total_products, COALESCE(SUM(stock), 0)::int AS total_stock_units, COALESCE(SUM(price * stock), 0)::float AS inventory_value, COUNT(*) FILTER (WHERE stock = 0)::int AS out_of_stock_count, COUNT(*) FILTER (WHERE stock > 0 AND stock <= low_stock_threshold)::int AS low_stock_count, COUNT(DISTINCT category)::int AS category_count FROM products WHERE deleted_at IS NULL')
    const byCategory = await pool.query('SELECT category, COUNT(*)::int AS product_count, COALESCE(SUM(stock), 0)::int AS stock_units, COALESCE(SUM(price * stock), 0)::float AS value FROM products WHERE deleted_at IS NULL GROUP BY category ORDER BY category ASC')
    const row = totals.rows[0]
    response.json({
      totalProducts: row.total_products,
      totalStockUnits: row.total_stock_units,
      inventoryValue: row.inventory_value,
      outOfStockCount: row.out_of_stock_count,
      lowStockCount: row.low_stock_count,
      categoryCount: row.category_count,
      byCategory: byCategory.rows.map((item) => ({ category: item.category, productCount: item.product_count, stockUnits: item.stock_units, value: item.value })),
    })
  } catch (error) { next(error) }
})

app.post('/api/products', requireAuth, async (request, response, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const values = productValues(request.body)
    const stock = values[3]
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const userName = userResult.rows[0]?.name ?? null
    const provided = String(request.body.sku || '').trim()
    // Insert the product; on a generated-SKU collision (23505 on products_sku_idx) retry
    // with a fresh SKU a few times before surfacing the error.
    let row
    let attempts = provided ? 1 : 5
    while (attempts > 0) {
      const sku = provided || generateSku()
      // A failed INSERT aborts the whole transaction, so each attempt runs inside a
      // SAVEPOINT and rolls back to it on a 23505 collision before the next retry.
      await client.query('SAVEPOINT sku_attempt')
      try {
        const result = await client.query(`INSERT INTO products (name, category, price, stock, status, media_name, media_type, media_url, low_stock_threshold, sku) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${productFields}`, [...values, sku])
        row = result.rows[0]
        await client.query('RELEASE SAVEPOINT sku_attempt')
        break
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT sku_attempt')
        attempts -= 1
        if (provided || error.code !== '23505' || attempts === 0) throw error
      }
    }
    if (stock > 0) {
      const reason = String(request.body.reason || '').trim() || 'Initial stock'
      await client.query('INSERT INTO stock_movements (product_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [row.id, request.userId, userName, stock, 0, stock, reason])
    }
    await client.query('COMMIT')
    response.status(201).json(normalizeProduct(row))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally {
    client.release()
  }
})

app.put('/api/products/:id', requireAuth, async (request, response, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT stock, sku FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [request.params.id])
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Product not found' })
    }
    const oldStock = existing.rows[0].stock
    const values = productValues(request.body)
    const newStock = values[3]
    const provided = String(request.body.sku || '').trim()
    const sku = provided || existing.rows[0].sku
    const result = await client.query(`UPDATE products SET name=$1, category=$2, price=$3, stock=$4, status=$5, media_name=$6, media_type=$7, media_url=$8, low_stock_threshold=$9, sku=$10, updated_at=NOW() WHERE id=$11 RETURNING ${productFields}`, [...values, sku, request.params.id])
    if (newStock !== oldStock) {
      const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
      const userName = userResult.rows[0]?.name ?? null
      const reason = String(request.body.reason || '').trim() || 'Manual update'
      await client.query('INSERT INTO stock_movements (product_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [request.params.id, request.userId, userName, newStock - oldStock, oldStock, newStock, reason])
    }
    await client.query('COMMIT')
    response.json(normalizeProduct(result.rows[0]))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally {
    client.release()
  }
})

app.delete('/api/products/:id', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query('UPDATE products SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL', [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Product not found' })
    response.status(204).end()
  } catch (error) { next(error) }
})

app.post('/api/products/:id/restore', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(`UPDATE products SET deleted_at=NULL, updated_at=NOW() WHERE id=$1 AND deleted_at IS NOT NULL RETURNING ${productFields}`, [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Product not found' })
    response.json(normalizeProduct(result.rows[0]))
  } catch (error) { next(error) }
})

app.delete('/api/products/:id/permanent', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id=$1', [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Product not found' })
    response.status(204).end()
  } catch (error) {
    if (error.code === '23503') return response.status(409).json({ message: 'Produk yang tercatat pada pesanan pembelian tidak dapat dihapus permanen.' })
    next(error)
  }
})

app.get('/api/products/:id/movements', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query('SELECT id, product_id, user_id, user_name, delta, stock_before, stock_after, reason, created_at FROM stock_movements WHERE product_id=$1 ORDER BY created_at DESC', [request.params.id])
    response.json(result.rows.map(normalizeMovement))
  } catch (error) { next(error) }
})

app.get('/api/stock-movements', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT m.id, m.product_id, m.user_id, m.user_name, m.delta, m.stock_before, m.stock_after, m.reason, m.created_at, p.name AS product_name FROM stock_movements m LEFT JOIN products p ON p.id=m.product_id ORDER BY m.created_at DESC LIMIT 200')
    response.json(result.rows.map((row) => ({ ...normalizeMovement(row), productName: row.product_name ?? null })))
  } catch (error) { next(error) }
})

app.post('/api/products/bulk', requireAuth, async (request, response) => {
  const products = request.body?.products
  if (!Array.isArray(products) || products.length === 0) return response.status(400).json({ message: 'A non-empty products array is required.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const userName = userResult.rows[0]?.name ?? null
    const rows = []
    for (let index = 0; index < products.length; index += 1) {
      const body = products[index]
      try {
        const values = productValues(body)
        const stock = values[3]
        const provided = String(body.sku || '').trim()
        let row
        let attempts = provided ? 1 : 5
        while (attempts > 0) {
          const sku = provided || generateSku()
          // SAVEPOINT per attempt so a 23505 collision doesn't abort the whole bulk
          // transaction; roll back to it before retrying with a fresh SKU.
          await client.query('SAVEPOINT sku_attempt')
          try {
            const result = await client.query(`INSERT INTO products (name, category, price, stock, status, media_name, media_type, media_url, low_stock_threshold, sku) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${productFields}`, [...values, sku])
            row = result.rows[0]
            await client.query('RELEASE SAVEPOINT sku_attempt')
            break
          } catch (error) {
            await client.query('ROLLBACK TO SAVEPOINT sku_attempt')
            attempts -= 1
            if (provided || error.code !== '23505' || attempts === 0) throw error
          }
        }
        if (stock > 0) {
          const reason = String(body.reason || '').trim() || 'Initial stock'
          await client.query('INSERT INTO stock_movements (product_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [row.id, request.userId, userName, stock, 0, stock, reason])
        }
        rows.push(row)
      } catch (error) {
        error.rowIndex = index
        throw error
      }
    }
    await client.query('COMMIT')
    response.json({ created: rows.map(normalizeProduct) })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const index = typeof error.rowIndex === 'number' ? error.rowIndex : null
    const message = error.code === '23505' ? 'Duplicate SKU in import.' : (error.message || 'Bulk import failed.')
    response.status(400).json({ message, index })
  } finally {
    client.release()
  }
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

const supplierFields = 'id, name, contact_name, email, phone, address, notes, created_at, updated_at'

function supplierValues(body = {}) {
  const name = String(body.name || '').trim()
  const contactName = String(body.contactName || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const phone = String(body.phone || '').trim()
  const address = String(body.address || '').trim()
  const notes = String(body.notes || '').trim()
  if (!name || name.length > 160) return { error: 'Nama pemasok wajib diisi (maksimal 160 karakter).' }
  if (contactName.length > 120 || email.length > 255 || phone.length > 40 || address.length > 4000 || notes.length > 4000) {
    return { error: 'Panjang informasi kontak pemasok melebihi batas.' }
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Format email pemasok tidak valid.' }
  return { values: [name, contactName || null, email || null, phone || null, address || null, notes || null] }
}

app.get('/api/suppliers', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT s.*, COUNT(po.id)::int AS purchase_count
      FROM suppliers s
      LEFT JOIN purchase_orders po ON po.supplier_id = s.id
      GROUP BY s.id
      ORDER BY s.name ASC
    `)
    response.json(result.rows.map(normalizeSupplier))
  } catch (error) { next(error) }
})

app.post('/api/suppliers', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const validated = supplierValues(request.body)
    if (validated.error) return response.status(400).json({ message: validated.error })
    const result = await pool.query(`INSERT INTO suppliers (name, contact_name, email, phone, address, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${supplierFields}`, validated.values)
    response.status(201).json(normalizeSupplier(result.rows[0]))
  } catch (error) { next(error) }
})

app.put('/api/suppliers/:id', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const validated = supplierValues(request.body)
    if (validated.error) return response.status(400).json({ message: validated.error })
    const result = await pool.query(`UPDATE suppliers SET name=$1, contact_name=$2, email=$3, phone=$4, address=$5, notes=$6, updated_at=NOW() WHERE id=$7 RETURNING ${supplierFields}`, [...validated.values, request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Pemasok tidak ditemukan.' })
    response.json(normalizeSupplier(result.rows[0]))
  } catch (error) { next(error) }
})

app.delete('/api/suppliers/:id', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const result = await pool.query('DELETE FROM suppliers WHERE id=$1', [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Pemasok tidak ditemukan.' })
    response.status(204).end()
  } catch (error) {
    if (error.code === '23503') return response.status(409).json({ message: 'Pemasok yang sudah memiliki pesanan pembelian tidak dapat dihapus.' })
    next(error)
  }
})

async function readPurchaseOrders(where = '', values = []) {
  const result = await pool.query(`
    SELECT po.*,
      COALESCE(
        json_agg(json_build_object(
          'id', poi.id,
          'productId', poi.product_id,
          'productName', poi.product_name,
          'sku', poi.sku,
          'quantity', poi.quantity,
          'receivedQuantity', poi.received_quantity,
          'unitCost', poi.unit_cost
        ) ORDER BY poi.id) FILTER (WHERE poi.id IS NOT NULL),
        '[]'::json
      ) AS items
    FROM purchase_orders po
    LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    ${where}
    GROUP BY po.id
    ORDER BY po.created_at DESC, po.id DESC
  `, values)
  return result.rows.map(normalizePurchaseOrder)
}

app.get('/api/purchases', requireAuth, async (_request, response, next) => {
  try { response.json(await readPurchaseOrders()) } catch (error) { next(error) }
})

app.post('/api/purchases', requireAuth, async (request, response, next) => {
  const { supplierId, items, notes = '' } = request.body || {}
  if (!Number.isSafeInteger(Number(supplierId)) || Number(supplierId) < 1) return response.status(400).json({ message: 'Pemasok wajib dipilih.' })
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return response.status(400).json({ message: 'Pesanan harus memiliki 1 sampai 100 produk.' })
  const normalizedItems = items.map((item) => ({
    productId: Number(item?.productId),
    quantity: Number(item?.quantity),
    unitCost: Number(item?.unitCost),
  }))
  if (normalizedItems.some((item) => !Number.isSafeInteger(item.productId) || item.productId < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 2_147_483_647 || !Number.isFinite(item.unitCost) || item.unitCost < 0 || item.unitCost > 9_999_999_999.99)) {
    return response.status(400).json({ message: 'Produk, jumlah, atau harga beli tidak valid.' })
  }
  if (new Set(normalizedItems.map((item) => item.productId)).size !== normalizedItems.length) return response.status(400).json({ message: 'Produk yang sama tidak boleh ditambahkan lebih dari sekali.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const supplierResult = await client.query(`SELECT ${supplierFields} FROM suppliers WHERE id=$1 FOR SHARE`, [supplierId])
    if (!supplierResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Pemasok tidak ditemukan.' })
    }
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const orderResult = await client.query(
      'INSERT INTO purchase_orders (supplier_id, supplier_name, notes, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
      [supplierId, supplierResult.rows[0].name, String(notes).slice(0, 2000) || null, request.userId, userResult.rows[0]?.name || null],
    )
    const order = orderResult.rows[0]
    const date = new Date(order.created_at).toISOString().slice(0, 10).replaceAll('-', '')
    const orderNumber = `PO-${date}-${String(order.id).padStart(6, '0')}`
    await client.query('UPDATE purchase_orders SET order_number=$1 WHERE id=$2', [orderNumber, order.id])

    for (const item of normalizedItems) {
      const productResult = await client.query(
        'SELECT id, name, sku FROM products WHERE id=$1 AND deleted_at IS NULL FOR SHARE',
        [item.productId],
      )
      if (!productResult.rowCount) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Produk dengan ID ${item.productId} tidak ditemukan atau sudah diarsipkan.` })
      }
      const product = productResult.rows[0]
      await client.query(
        'INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, sku, quantity, unit_cost) VALUES ($1,$2,$3,$4,$5,$6)',
        [order.id, product.id, product.name, product.sku, item.quantity, item.unitCost],
      )
    }
    await client.query('COMMIT')
    response.status(201).json((await readPurchaseOrders('WHERE po.id=$1', [order.id]))[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

app.post('/api/purchases/:id/receive', requireAuth, async (request, response, next) => {
  const { items } = request.body || {}
  if (!Array.isArray(items) || items.length < 1) return response.status(400).json({ message: 'Masukkan jumlah barang yang diterima.' })
  const receipts = items.map((item) => ({ itemId: Number(item?.itemId), quantity: Number(item?.quantity) }))
  if (receipts.some((item) => !Number.isSafeInteger(item.itemId) || item.itemId < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 2_147_483_647)) {
    return response.status(400).json({ message: 'Jumlah penerimaan harus berupa bilangan bulat positif.' })
  }
  if (new Set(receipts.map((item) => item.itemId)).size !== receipts.length) return response.status(400).json({ message: 'Baris produk duplikat pada penerimaan.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query('SELECT id, order_number, status FROM purchase_orders WHERE id=$1 FOR UPDATE', [request.params.id])
    if (!orderResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Pesanan pembelian tidak ditemukan.' })
    }
    const order = orderResult.rows[0]
    if (order.status === 'received') {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Pesanan ini sudah diterima seluruhnya.' })
    }
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    for (const receipt of receipts) {
      const itemResult = await client.query(`
        SELECT poi.id, poi.product_id, poi.product_name, poi.quantity, poi.received_quantity,
               p.stock, p.low_stock_threshold, p.deleted_at
        FROM purchase_order_items poi
        JOIN products p ON p.id=poi.product_id
        WHERE poi.id=$1 AND poi.purchase_order_id=$2
        FOR UPDATE OF poi, p
      `, [receipt.itemId, order.id])
      if (!itemResult.rowCount) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: 'Baris produk tidak termasuk dalam pesanan ini.' })
      }
      const item = itemResult.rows[0]
      if (item.deleted_at) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Produk "${item.product_name}" sudah diarsipkan dan tidak dapat menerima stok.` })
      }
      const remaining = item.quantity - item.received_quantity
      if (receipt.quantity > remaining) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Jumlah penerimaan "${item.product_name}" melebihi sisa ${remaining} unit.` })
      }
      const stockBefore = item.stock
      const stockAfter = stockBefore + receipt.quantity
      if (stockAfter > 2_147_483_647) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Stok "${item.product_name}" melebihi batas yang dapat dicatat.` })
      }
      const status = stockAfter === 0 ? 'Out of stock' : stockAfter <= item.low_stock_threshold ? 'Low stock' : 'Active'
      await client.query(
        'UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3',
        [stockAfter, status, item.product_id],
      )
      await client.query(
        'UPDATE purchase_order_items SET received_quantity=received_quantity+$1 WHERE id=$2',
        [receipt.quantity, item.id],
      )
      await client.query(
        'INSERT INTO stock_movements (product_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [item.product_id, request.userId, userResult.rows[0]?.name ?? null, receipt.quantity, stockBefore, stockAfter, `Purchase ${order.order_number}`],
      )
    }
    const remainingResult = await client.query('SELECT COUNT(*)::int AS count FROM purchase_order_items WHERE purchase_order_id=$1 AND received_quantity < quantity', [order.id])
    const status = remainingResult.rows[0].count === 0 ? 'received' : 'partially_received'
    await client.query('UPDATE purchase_orders SET status=$1, updated_at=NOW() WHERE id=$2', [status, order.id])
    await client.query('COMMIT')
    response.json((await readPurchaseOrders('WHERE po.id=$1', [order.id]))[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

const customerFields = 'id, name, email, phone, address, notes, created_at, updated_at'

function customerValues(body = {}) {
  const name = String(body.name || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const phone = String(body.phone || '').trim()
  const address = String(body.address || '').trim()
  const notes = String(body.notes || '').trim()
  if (!name || name.length > 160) return { error: 'Nama pelanggan wajib diisi (maksimal 160 karakter).' }
  if (email.length > 255 || phone.length > 40 || address.length > 4000 || notes.length > 4000) return { error: 'Panjang informasi pelanggan melebihi batas.' }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Format email pelanggan tidak valid.' }
  return { values: [name, email || null, phone || null, address || null, notes || null] }
}

app.get('/api/customers', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT c.*, COUNT(so.id)::int AS order_count
      FROM customers c
      LEFT JOIN sales_orders so ON so.customer_id=c.id
      GROUP BY c.id
      ORDER BY c.name ASC
    `)
    response.json(result.rows.map(normalizeCustomer))
  } catch (error) { next(error) }
})

app.post('/api/customers', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const validated = customerValues(request.body)
    if (validated.error) return response.status(400).json({ message: validated.error })
    const result = await pool.query(`INSERT INTO customers (name, email, phone, address, notes) VALUES ($1,$2,$3,$4,$5) RETURNING ${customerFields}`, validated.values)
    response.status(201).json(normalizeCustomer(result.rows[0]))
  } catch (error) { next(error) }
})

app.put('/api/customers/:id', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const validated = customerValues(request.body)
    if (validated.error) return response.status(400).json({ message: validated.error })
    const result = await pool.query(`UPDATE customers SET name=$1, email=$2, phone=$3, address=$4, notes=$5, updated_at=NOW() WHERE id=$6 RETURNING ${customerFields}`, [...validated.values, request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Pelanggan tidak ditemukan.' })
    response.json(normalizeCustomer(result.rows[0]))
  } catch (error) { next(error) }
})

app.delete('/api/customers/:id', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const result = await pool.query('DELETE FROM customers WHERE id=$1', [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Pelanggan tidak ditemukan.' })
    response.status(204).end()
  } catch (error) { next(error) }
})

async function readSalesOrders(where = '', values = []) {
  const result = await pool.query(`
    SELECT so.*,
      COALESCE(
        json_agg(json_build_object(
          'id', soi.id,
          'productId', soi.product_id,
          'productName', soi.product_name,
          'sku', soi.sku,
          'quantity', soi.quantity,
          'returnedQuantity', soi.returned_quantity,
          'unitPrice', soi.unit_price
        ) ORDER BY soi.id) FILTER (WHERE soi.id IS NOT NULL),
        '[]'::json
      ) AS items
    FROM sales_orders so
    LEFT JOIN sales_order_items soi ON soi.sales_order_id=so.id
    ${where}
    GROUP BY so.id
    ORDER BY so.created_at DESC, so.id DESC
  `, values)
  return result.rows.map(normalizeSalesOrder)
}

app.get('/api/sales', requireAuth, async (_request, response, next) => {
  try { response.json(await readSalesOrders()) } catch (error) { next(error) }
})

app.post('/api/sales', requireAuth, async (request, response, next) => {
  const { customerId, items, notes = '' } = request.body || {}
  if (!Number.isSafeInteger(Number(customerId)) || Number(customerId) < 1) return response.status(400).json({ message: 'Pelanggan wajib dipilih.' })
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return response.status(400).json({ message: 'Pesanan harus memiliki 1 sampai 100 produk.' })
  const normalizedItems = items.map((item) => ({
    productId: Number(item?.productId),
    quantity: Number(item?.quantity),
  }))
  if (normalizedItems.some((item) => !Number.isSafeInteger(item.productId) || item.productId < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 2_147_483_647)) {
    return response.status(400).json({ message: 'Produk atau jumlah tidak valid.' })
  }
  if (new Set(normalizedItems.map((item) => item.productId)).size !== normalizedItems.length) return response.status(400).json({ message: 'Produk yang sama tidak boleh ditambahkan lebih dari sekali.' })
  if (String(notes).length > 2000) return response.status(400).json({ message: 'Catatan maksimal 2.000 karakter.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const customerResult = await client.query(`SELECT ${customerFields} FROM customers WHERE id=$1 FOR SHARE`, [customerId])
    if (!customerResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Pelanggan tidak ditemukan.' })
    }
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const customer = customerResult.rows[0]
    const orderResult = await client.query(
      'INSERT INTO sales_orders (customer_id, customer_name, customer_email, customer_phone, notes, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at',
      [customer.id, customer.name, customer.email, customer.phone, String(notes).trim() || null, request.userId, userResult.rows[0]?.name || null],
    )
    const order = orderResult.rows[0]
    const date = new Date(order.created_at).toISOString().slice(0, 10).replaceAll('-', '')
    const orderNumber = `SO-${date}-${String(order.id).padStart(6, '0')}`
    await client.query('UPDATE sales_orders SET order_number=$1 WHERE id=$2', [orderNumber, order.id])

    for (const item of normalizedItems.sort((a, b) => a.productId - b.productId)) {
      const productResult = await client.query(
        'SELECT id, name, sku, price, stock, low_stock_threshold FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
        [item.productId],
      )
      if (!productResult.rowCount) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Produk dengan ID ${item.productId} tidak ditemukan atau sudah diarsipkan.` })
      }
      const product = productResult.rows[0]
      if (item.quantity > product.stock) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Stok "${product.name}" tidak cukup. Tersedia ${product.stock} unit.` })
      }
      const stockAfter = product.stock - item.quantity
      const status = stockAfter === 0 ? 'Out of stock' : stockAfter <= product.low_stock_threshold ? 'Low stock' : 'Active'
      await client.query('UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3', [stockAfter, status, product.id])
      await client.query(
        'INSERT INTO sales_order_items (sales_order_id, product_id, product_name, sku, quantity, unit_price) VALUES ($1,$2,$3,$4,$5,$6)',
        [order.id, product.id, product.name, product.sku, item.quantity, product.price],
      )
      await client.query(
        'INSERT INTO stock_movements (product_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [product.id, request.userId, userResult.rows[0]?.name ?? null, -item.quantity, product.stock, stockAfter, `Sale ${orderNumber}`],
      )
    }
    await client.query('COMMIT')
    response.status(201).json((await readSalesOrders('WHERE so.id=$1', [order.id]))[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

app.post('/api/sales/:id/return', requireAuth, async (request, response, next) => {
  const { items } = request.body || {}
  if (!Array.isArray(items) || items.length < 1) return response.status(400).json({ message: 'Pilih produk dan jumlah retur.' })
  const returns = items.map((item) => ({ itemId: Number(item?.itemId), quantity: Number(item?.quantity) }))
  if (returns.some((item) => !Number.isSafeInteger(item.itemId) || item.itemId < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 2_147_483_647)) {
    return response.status(400).json({ message: 'Jumlah retur harus berupa bilangan bulat positif.' })
  }
  if (new Set(returns.map((item) => item.itemId)).size !== returns.length) return response.status(400).json({ message: 'Baris produk duplikat pada retur.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query('SELECT id, order_number, status FROM sales_orders WHERE id=$1 FOR UPDATE', [request.params.id])
    if (!orderResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Pesanan penjualan tidak ditemukan.' })
    }
    const order = orderResult.rows[0]
    if (order.status === 'cancelled' || order.status === 'returned') {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Pesanan ini sudah dibatalkan atau seluruhnya diretur.' })
    }
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    for (const item of returns) {
      const lineResult = await client.query(`
        SELECT soi.id, soi.product_id, soi.product_name, soi.quantity, soi.returned_quantity,
               p.stock, p.low_stock_threshold
        FROM sales_order_items soi
        JOIN products p ON p.id=soi.product_id
        WHERE soi.id=$1 AND soi.sales_order_id=$2
        FOR UPDATE OF soi, p
      `, [item.itemId, order.id])
      if (!lineResult.rowCount) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: 'Baris produk tidak termasuk dalam pesanan ini.' })
      }
      const line = lineResult.rows[0]
      const remaining = line.quantity - line.returned_quantity
      if (item.quantity > remaining) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Jumlah retur "${line.product_name}" melebihi sisa ${remaining} unit.` })
      }
      if (line.stock + item.quantity > 2_147_483_647) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Stok "${line.product_name}" melebihi batas yang dapat dicatat.` })
      }
      const stockAfter = line.stock + item.quantity
      const status = stockAfter <= line.low_stock_threshold ? 'Low stock' : 'Active'
      await client.query('UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3', [stockAfter, status, line.product_id])
      await client.query('UPDATE sales_order_items SET returned_quantity=returned_quantity+$1 WHERE id=$2', [item.quantity, line.id])
      await client.query(
        'INSERT INTO stock_movements (product_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [line.product_id, request.userId, userResult.rows[0]?.name ?? null, item.quantity, line.stock, stockAfter, `Return ${order.order_number}`],
      )
    }
    const outstanding = await client.query('SELECT COUNT(*)::int AS count FROM sales_order_items WHERE sales_order_id=$1 AND returned_quantity < quantity', [order.id])
    const status = outstanding.rows[0].count === 0 ? 'returned' : 'partially_returned'
    await client.query('UPDATE sales_orders SET status=$1, updated_at=NOW() WHERE id=$2', [status, order.id])
    await client.query('COMMIT')
    response.json((await readSalesOrders('WHERE so.id=$1', [order.id]))[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

app.post('/api/sales/:id/cancel', requireAuth, async (request, response, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query('SELECT id, order_number, status FROM sales_orders WHERE id=$1 FOR UPDATE', [request.params.id])
    if (!orderResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Pesanan penjualan tidak ditemukan.' })
    }
    const order = orderResult.rows[0]
    if (order.status === 'cancelled') {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Pesanan ini sudah dibatalkan.' })
    }
    if (order.status === 'returned') {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Pesanan yang sudah diretur seluruhnya tidak dapat dibatalkan.' })
    }
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const linesResult = await client.query(`
      SELECT soi.id, soi.product_id, soi.product_name, soi.quantity, soi.returned_quantity,
             p.stock, p.low_stock_threshold
      FROM sales_order_items soi
      JOIN products p ON p.id=soi.product_id
      WHERE soi.sales_order_id=$1
      ORDER BY soi.id
      FOR UPDATE OF soi, p
    `, [order.id])
    for (const line of linesResult.rows) {
      const quantity = line.quantity - line.returned_quantity
      if (!quantity) continue
      if (line.stock + quantity > 2_147_483_647) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Stok "${line.product_name}" melebihi batas yang dapat dicatat.` })
      }
      const stockAfter = line.stock + quantity
      const status = stockAfter <= line.low_stock_threshold ? 'Low stock' : 'Active'
      await client.query('UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3', [stockAfter, status, line.product_id])
      await client.query(
        'INSERT INTO stock_movements (product_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [line.product_id, request.userId, userResult.rows[0]?.name ?? null, quantity, line.stock, stockAfter, `Cancel ${order.order_number}`],
      )
    }
    await client.query("UPDATE sales_orders SET status='cancelled', updated_at=NOW() WHERE id=$1", [order.id])
    await client.query('COMMIT')
    response.json((await readSalesOrders('WHERE so.id=$1', [order.id]))[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
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
    // Avatar is optional. Only touch the column when the client sent the key, so a plain
    // name/email save doesn't wipe an existing photo. A data URL sets it; null clears it.
    const hasAvatar = Object.prototype.hasOwnProperty.call(request.body, 'avatarUrl')
    const avatarUrl = request.body.avatarUrl ? String(request.body.avatarUrl) : null
    if (hasAvatar && avatarUrl && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(avatarUrl)) {
      return response.status(400).json({ message: 'Format gambar tidak didukung.' })
    }
    const query = hasAvatar
      ? { text: `UPDATE users SET name=$1, email=$2, avatar_url=$3, updated_at=NOW() WHERE id=$4 RETURNING ${userFields}`, values: [name, email, avatarUrl, request.userId] }
      : { text: `UPDATE users SET name=$1, email=$2, updated_at=NOW() WHERE id=$3 RETURNING ${userFields}`, values: [name, email, request.userId] }
    const result = await pool.query(query.text, query.values)
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
