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
app.use(express.json({ limit: '50mb' }))

const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'lumina-dev-token-secret-change-me'
const TOKEN_TTL_SECONDS = 7 * 24 * 3600
const backupTables = [
  'users', 'cash_sessions', 'categories', 'suppliers', 'warehouses', 'products', 'customers',
  'purchase_orders', 'purchase_order_items', 'purchase_payments', 'supplier_returns',
  'supplier_return_items', 'sales_orders', 'sales_order_items', 'product_batches',
  'sales_payments', 'sales_order_item_batches', 'warehouse_stocks', 'stock_movements',
  'stock_transfers', 'stocktakes', 'stocktake_items', 'operating_expenses',
]

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

app.get('/api/products/lookup/:code', requireAuth, async (request, response, next) => {
  try {
    const code = String(request.params.code || '').trim()
    if (!code || code.length > 120) return response.status(400).json({ message: 'Barcode atau SKU tidak valid.' })
    const result = await pool.query(`SELECT ${productFields} FROM products WHERE deleted_at IS NULL AND (barcode=$1 OR sku=$1) LIMIT 1`, [code])
    if (!result.rowCount) return response.status(404).json({ message: 'Produk dengan barcode atau SKU tersebut tidak ditemukan.' })
    response.json(normalizeProduct(result.rows[0]))
  } catch (error) { next(error) }
})
// OTP/email dispatch (resend, forgot, reset): protects against email flooding.
const otpSendLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Terlalu banyak permintaan kode. Coba lagi nanti.',
})

app.get('/api/product-batches', requireAuth, async (request, response, next) => {
  try {
    const values = []
    const clauses = ['p.deleted_at IS NULL']
    if (request.query.productId) { values.push(request.query.productId); clauses.push(`pb.product_id=$${values.length}`) }
    if (request.query.warehouseId) { values.push(request.query.warehouseId); clauses.push(`pb.warehouse_id=$${values.length}`) }
    const result = await pool.query(`
      SELECT pb.id, pb.product_id, p.name AS product_name, pb.warehouse_id, w.name AS warehouse_name,
        pb.batch_number, pb.serial_number, pb.expires_at, pb.quantity
      FROM product_batches pb JOIN products p ON p.id=pb.product_id JOIN warehouses w ON w.id=pb.warehouse_id
      WHERE ${clauses.join(' AND ')} ORDER BY pb.expires_at NULLS LAST, pb.created_at
    `, values)
    response.json(result.rows.map((row) => ({ id: Number(row.id), productId: Number(row.product_id), productName: row.product_name, warehouseId: Number(row.warehouse_id), warehouseName: row.warehouse_name, batchNumber: row.batch_number, serialNumber: row.serial_number, expiresAt: row.expires_at, quantity: row.quantity })))
  } catch (error) { next(error) }
})

app.post('/api/product-batches', requireAuth, async (request, response, next) => {
  const productId = Number(request.body.productId)
  const warehouseId = Number(request.body.warehouseId)
  const quantity = Number(request.body.quantity)
  const batchNumber = String(request.body.batchNumber || '').trim()
  const serialNumber = String(request.body.serialNumber || '').trim() || null
  const expiresAt = request.body.expiresAt ? String(request.body.expiresAt) : null
  if (![productId, warehouseId, quantity].every(Number.isSafeInteger) || productId < 1 || warehouseId < 1 || quantity < 1 || !batchNumber || batchNumber.length > 120 || (serialNumber && serialNumber.length > 120) || (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) || (serialNumber && quantity !== 1)) return response.status(400).json({ message: 'Informasi batch, jumlah, atau tanggal kedaluwarsa tidak valid.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const product = await client.query('SELECT track_batches FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [productId])
    if (!product.rowCount || !product.rows[0].track_batches) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Aktifkan pelacakan batch pada produk terlebih dahulu.' })
    }
    const available = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [warehouseId, productId])
    const alreadyAssigned = await client.query('SELECT COALESCE(SUM(quantity),0)::int AS quantity FROM product_batches WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId])
    if (!available.rowCount || Number(alreadyAssigned.rows[0].quantity) + quantity > available.rows[0].stock) {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Jumlah batch melebihi stok yang tersedia di gudang.' })
    }
    const result = await client.query('INSERT INTO product_batches (product_id, warehouse_id, batch_number, serial_number, expires_at, quantity) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, expires_at', [productId, warehouseId, batchNumber, serialNumber, expiresAt, quantity])
    await client.query('COMMIT')
    response.status(201).json({ id: Number(result.rows[0].id), productId, warehouseId, batchNumber, serialNumber, expiresAt: result.rows[0].expires_at, quantity })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505') return response.status(409).json({ message: 'Nomor batch atau serial sudah tercatat.' })
    next(error)
  } finally { client.release() }
})

const productFields = 'id, name, category, price, stock, status, media_name, media_type, media_url, low_stock_threshold, sku, barcode, track_batches, deleted_at, created_at, updated_at'
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
  const totalAmount = Number(row.total_amount || 0)
  const paidAmount = Number(row.paid_amount || 0)
  const returnedAmount = Number(row.returned_amount || 0)
  return {
    id: Number(row.id),
    orderNumber: row.order_number,
    supplierId: Number(row.supplier_id),
    warehouseId: row.warehouse_id === null ? null : Number(row.warehouse_id),
    supplierName: row.supplier_name,
    status: row.status,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dueDate: row.due_date,
    totalAmount,
    paidAmount,
    returnedAmount,
    balanceDue: Math.max(0, Math.round((totalAmount - returnedAmount - paidAmount) * 100) / 100),
    payments: row.payments || [],
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
  const items = (row.items || []).map((item) => ({
    ...item,
    productId: Number(item.productId),
    quantity: Number(item.quantity),
    returnedQuantity: Number(item.returnedQuantity),
    unitPrice: Number(item.unitPrice),
  }))
  const paidAmount = Math.round(Number(row.paid_amount || 0) * 100) / 100
  const refundedAmount = Math.round(Number(row.refunded_amount || 0) * 100) / 100
  const payments = (row.payments || []).map((payment) => ({ ...payment, amount: Number(payment.amount) }))
  const totalAmount = row.status === 'cancelled' ? 0 : Math.round(items.reduce((sum, item) => sum + (item.quantity - item.returnedQuantity) * item.unitPrice, 0) * 100) / 100
  const netPaid = paidAmount - refundedAmount
  const refundDue = Math.round(Math.max(0, netPaid - totalAmount) * 100) / 100
  let paymentStatus = 'unpaid'
  if (refundedAmount > 0 && netPaid <= 0) paymentStatus = 'refunded'
  else if (refundDue > 0 && refundedAmount > 0) paymentStatus = 'partially_refunded'
  else if (refundDue > 0) paymentStatus = 'refund_due'
  else if (totalAmount > 0 && netPaid >= totalAmount) paymentStatus = 'paid'
  else if (refundedAmount > 0) paymentStatus = 'partially_refunded'
  else if (netPaid > 0) paymentStatus = 'partial'

  return {
    id: Number(row.id),
    orderNumber: row.order_number,
    invoiceNumber: row.invoice_number,
    warehouseId: row.warehouse_id === null ? null : Number(row.warehouse_id),
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    status: row.status,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalAmount,
    paidAmount,
    refundedAmount,
    balanceDue: Math.round(Math.max(0, totalAmount - netPaid) * 100) / 100,
    refundDue,
    paymentStatus,
    payments,
    items,
  }
}

function getProductStatus(stock, threshold) {
  return stock <= 0 ? 'Out of stock' : stock <= threshold ? 'Low stock' : 'Active'
}

function normalizeProduct(row) {
  const stock = Number(row.stock)
  const lowStockThreshold = Number(row.low_stock_threshold)
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category,
    price: Number(row.price),
    stock,
    status: getProductStatus(stock, lowStockThreshold),
    media: row.media_url ? { name: row.media_name, type: row.media_type, url: row.media_url } : null,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    trackBatches: row.track_batches ?? false,
    lowStockThreshold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function productValues(body) {
  const stock = Number(body.stock) || 0
  const lowStockThreshold = Math.max(0, Number.parseInt(body.lowStockThreshold, 10) || 5)
  return [body.name, body.category, Number(body.price) || 0, stock, getProductStatus(stock, lowStockThreshold), body.media?.name || null, body.media?.type || null, body.media?.url || null, lowStockThreshold]
}

function isValidStockQuantity(stock) {
  return Number.isSafeInteger(stock) && stock >= 0 && stock <= 2_147_483_647
}

function generateSku() {
  return 'SKU-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase()
}

function normalizeMovement(row) {
  return { id: Number(row.id), productId: row.product_id === null ? null : Number(row.product_id), warehouseId: row.warehouse_id === null || row.warehouse_id === undefined ? null : Number(row.warehouse_id), warehouseName: row.warehouse_name ?? null, userId: row.user_id === null ? null : Number(row.user_id), userName: row.user_name ?? null, delta: row.delta, stockBefore: row.stock_before, stockAfter: row.stock_after, reason: row.reason ?? null, createdAt: row.created_at }
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
async function isActiveAdmin(userId) {
  const result = await pool.query('SELECT role FROM users WHERE id=$1 AND is_active=TRUE', [userId])
  return result.rows[0]?.role === 'admin'
}

async function requireAdmin(request, response, next) {
  try {
    if (!(await isActiveAdmin(request.userId))) return response.status(403).json({ message: 'Akses ditolak. Hanya admin yang diizinkan.' })
    next()
  } catch (error) { next(error) }
}

async function lockOpenCashSession(client, userId) {
  const result = await client.query(
    "SELECT id FROM cash_sessions WHERE opened_by=$1 AND status='open' FOR UPDATE",
    [userId],
  )
  return result.rows[0] || null
}

app.get('/api/backup', requireAuth, requireAdmin, async (_request, response, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const tables = {}
    for (const table of backupTables) {
      const result = await client.query(`SELECT * FROM ${table}`)
      tables[table] = result.rows.map((row) => {
        if (table !== 'users') return row
        const safeUser = { ...row }
        for (const column of ['login_otp_hash', 'login_otp_expires_at', 'reset_otp_hash', 'reset_otp_expires_at', 'register_otp_hash', 'register_otp_expires_at']) delete safeUser[column]
        return safeUser
      })
    }
    await client.query('COMMIT')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Content-Disposition', `attachment; filename="ifal-store-backup-${new Date().toISOString().slice(0, 10)}.json"`)
    response.json({ format: 'ifal-store-backup', version: 1, createdAt: new Date().toISOString(), tables })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

app.post('/api/backup/restore', requireAuth, requireAdmin, async (request, response, next) => {
  const backup = request.body
  if (backup?.format !== 'ifal-store-backup' || backup.version !== 1 || !backup.tables || typeof backup.tables !== 'object' || Array.isArray(backup.tables)) return response.status(400).json({ message: 'File backup tidak valid atau versinya tidak didukung.' })
  const restoreTables = { ...backup.tables, cash_sessions: backup.tables.cash_sessions === undefined ? [] : backup.tables.cash_sessions }
  if (backupTables.some((table) => !Array.isArray(restoreTables[table])) || Object.keys(backup.tables).some((table) => !backupTables.includes(table))) return response.status(400).json({ message: 'Isi backup tidak cocok dengan tabel aplikasi.' })
  const totalRows = backupTables.reduce((sum, table) => sum + restoreTables[table].length, 0)
  if (totalRows > 300_000) return response.status(413).json({ message: 'Backup melebihi batas 300.000 baris.' })
  for (const table of backupTables) {
    if (restoreTables[table].some((row) => !row || typeof row !== 'object' || Array.isArray(row))) return response.status(400).json({ message: `Data tabel ${table} tidak valid.` })
  }
  if (!restoreTables.users.some((user) => user.role === 'admin' && user.is_active === true && typeof user.password_hash === 'string' && /^[a-f\d]{32}:[a-f\d]{128}$/i.test(user.password_hash))) return response.status(400).json({ message: 'Backup harus berisi setidaknya satu akun admin aktif dengan hash kata sandi valid agar aplikasi tetap dapat diakses.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`LOCK TABLE ${backupTables.join(', ')} IN ACCESS EXCLUSIVE MODE`)
    const columnResults = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name = ANY($1::text[])`,
      [backupTables],
    )
    const columnsByTable = new Map(backupTables.map((table) => [table, new Set()]))
    for (const column of columnResults.rows) columnsByTable.get(column.table_name)?.add(column.column_name)
    for (const table of backupTables) {
      const allowedColumns = columnsByTable.get(table)
      if (!allowedColumns?.size || restoreTables[table].some((row) => Object.keys(row).some((key) => !allowedColumns.has(key)))) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Kolom backup tabel ${table} tidak sesuai.` })
      }
    }

    for (const table of [...backupTables].reverse()) await client.query(`DELETE FROM ${table}`)
    for (const table of backupTables) {
      const columns = [...columnsByTable.get(table)]
      for (const row of restoreTables[table]) {
        const presentColumns = columns.filter((column) => Object.hasOwn(row, column))
        if (!presentColumns.length) continue
        const placeholders = presentColumns.map((_, index) => `$${index + 1}`).join(', ')
        await client.query(
          `INSERT INTO ${table} (${presentColumns.join(', ')}) VALUES (${placeholders})`,
          presentColumns.map((column) => row[column]),
        )
      }
      if (columnsByTable.get(table).has('id')) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`,
          [table],
        )
      }
    }
    await client.query('COMMIT')
    response.json({ message: `Pemulihan selesai. ${totalRows} baris data berhasil dipulihkan.` })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

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

app.get('/api/warehouses', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT w.id, w.name, w.address, w.is_default,
        COALESCE(SUM(ws.stock), 0)::int AS stock_units
      FROM warehouses w
      LEFT JOIN warehouse_stocks ws ON ws.warehouse_id=w.id
      GROUP BY w.id
      ORDER BY w.is_default DESC, w.name
    `)
    response.json(result.rows.map((row) => ({ id: Number(row.id), name: row.name, address: row.address, isDefault: row.is_default, stockUnits: row.stock_units })))
  } catch (error) { next(error) }
})

app.post('/api/warehouses', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const name = String(request.body.name || '').trim()
    const address = String(request.body.address || '').trim()
    if (!name || name.length > 120 || address.length > 2000) return response.status(400).json({ message: 'Nama gudang wajib diisi dan maksimal 120 karakter.' })
    const result = await pool.query('INSERT INTO warehouses (name, address) VALUES ($1,$2) RETURNING id, name, address, is_default', [name, address || null])
    response.status(201).json({ id: Number(result.rows[0].id), name: result.rows[0].name, address: result.rows[0].address, isDefault: result.rows[0].is_default, stockUnits: 0 })
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'Nama gudang sudah digunakan.' })
    next(error)
  }
})

app.get('/api/warehouses/:id/stock', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.sku, p.barcode, p.low_stock_threshold, ws.stock
      FROM warehouse_stocks ws JOIN products p ON p.id=ws.product_id
      WHERE ws.warehouse_id=$1 AND p.deleted_at IS NULL
      ORDER BY p.name
    `, [request.params.id])
    response.json(result.rows.map((row) => ({ productId: Number(row.id), name: row.name, sku: row.sku, barcode: row.barcode, lowStockThreshold: row.low_stock_threshold, stock: row.stock })))
  } catch (error) { next(error) }
})

app.post('/api/stock-transfers', requireAuth, requireAdmin, async (request, response, next) => {
  const sourceWarehouseId = Number(request.body.sourceWarehouseId)
  const destinationWarehouseId = Number(request.body.destinationWarehouseId)
  const productId = Number(request.body.productId)
  const quantity = Number(request.body.quantity)
  if (![sourceWarehouseId, destinationWarehouseId, productId, quantity].every(Number.isSafeInteger) || sourceWarehouseId < 1 || destinationWarehouseId < 1 || productId < 1 || quantity < 1 || sourceWarehouseId === destinationWarehouseId) {
    return response.status(400).json({ message: 'Gudang asal/tujuan, produk, atau jumlah transfer tidak valid.' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const product = await client.query('SELECT name, track_batches FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [productId])
    if (!product.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Produk tidak ditemukan.' })
    }
    const source = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [sourceWarehouseId, productId])
    if (!source.rowCount || source.rows[0].stock < quantity) {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Stok gudang asal tidak mencukupi.' })
    }
    const destination = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [destinationWarehouseId, productId])
    const destinationStock = destination.rows[0]?.stock || 0
    await client.query('UPDATE warehouse_stocks SET stock=stock-$1 WHERE warehouse_id=$2 AND product_id=$3', [quantity, sourceWarehouseId, productId])
    await client.query('INSERT INTO warehouse_stocks (warehouse_id, product_id, stock) VALUES ($1,$2,$3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET stock=warehouse_stocks.stock+EXCLUDED.stock', [destinationWarehouseId, productId, quantity])
    const user = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const result = await client.query('INSERT INTO stock_transfers (source_warehouse_id, destination_warehouse_id, product_id, quantity, notes, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at', [sourceWarehouseId, destinationWarehouseId, productId, quantity, String(request.body.notes || '').trim().slice(0, 500) || null, request.userId, user.rows[0]?.name || null])
    if (product.rows[0].track_batches) {
      const batches = await client.query('SELECT id, batch_number, serial_number, expires_at, quantity FROM product_batches WHERE product_id=$1 AND warehouse_id=$2 AND quantity>0 ORDER BY expires_at NULLS LAST, id FOR UPDATE', [productId, sourceWarehouseId])
      if (batches.rows.reduce((sum, batch) => sum + batch.quantity, 0) < quantity) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Batch ${product.rows[0].name} belum mencukupi untuk transfer.` })
      }
      let remaining = quantity
      for (const batch of batches.rows) {
        if (!remaining) break
        const moved = Math.min(remaining, batch.quantity)
        await client.query('UPDATE product_batches SET quantity=quantity-$1 WHERE id=$2', [moved, batch.id])
        await client.query('INSERT INTO product_batches (product_id, warehouse_id, batch_number, serial_number, expires_at, quantity) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (product_id, warehouse_id, batch_number, COALESCE(serial_number, \'\')) DO UPDATE SET quantity=product_batches.quantity+EXCLUDED.quantity', [productId, destinationWarehouseId, batch.batch_number, batch.serial_number, batch.expires_at, moved])
        remaining -= moved
      }
    }
    await client.query('INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8),($1,$9,$3,$4,$10,$11,$12,$13)', [productId, sourceWarehouseId, request.userId, user.rows[0]?.name || null, -quantity, source.rows[0].stock, source.rows[0].stock - quantity, `Transfer #${result.rows[0].id} ke gudang ${destinationWarehouseId}`, destinationWarehouseId, quantity, destinationStock, destinationStock + quantity, `Transfer #${result.rows[0].id} dari gudang ${sourceWarehouseId}`])
    await client.query('COMMIT')
    response.status(201).json({ id: Number(result.rows[0].id), quantity, createdAt: result.rows[0].created_at })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505' && error.constraint === 'products_barcode_idx') return response.status(409).json({ message: 'Barcode sudah digunakan produk lain.' })
    next(error)
  } finally { client.release() }
})

app.get('/api/stocktakes', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT st.id, st.warehouse_id, w.name AS warehouse_name, st.status, st.notes,
        st.created_by_name, st.created_at, st.completed_at,
        COUNT(sti.id)::int AS item_count,
        COUNT(sti.id) FILTER (WHERE sti.expected_quantity<>sti.counted_quantity)::int AS variance_count
      FROM stocktakes st
      JOIN warehouses w ON w.id=st.warehouse_id
      LEFT JOIN stocktake_items sti ON sti.stocktake_id=st.id
      GROUP BY st.id, w.name
      ORDER BY st.created_at DESC
    `)
    response.json(result.rows.map((row) => ({ id: Number(row.id), warehouseId: Number(row.warehouse_id), warehouseName: row.warehouse_name, status: row.status, notes: row.notes, createdByName: row.created_by_name, createdAt: row.created_at, completedAt: row.completed_at, itemCount: row.item_count, varianceCount: row.variance_count })))
  } catch (error) { next(error) }
})

app.post('/api/stocktakes', requireAuth, requireAdmin, async (request, response, next) => {
  const warehouseId = Number(request.body.warehouseId)
  const items = Array.isArray(request.body.items) ? request.body.items : []
  if (!Number.isSafeInteger(warehouseId) || warehouseId < 1 || !items.length || items.length > 5000) return response.status(400).json({ message: 'Pilih gudang dan minimal satu item stok opname.' })
  const counts = items.map((item) => ({ productId: Number(item.productId), countedQuantity: Number(item.countedQuantity) }))
  if (counts.some((item) => !Number.isSafeInteger(item.productId) || item.productId < 1 || !Number.isSafeInteger(item.countedQuantity) || item.countedQuantity < 0 || item.countedQuantity > 2_147_483_647) || new Set(counts.map((item) => item.productId)).size !== counts.length) return response.status(400).json({ message: 'Daftar produk atau jumlah hitung tidak valid.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const warehouse = await client.query('SELECT id FROM warehouses WHERE id=$1 FOR SHARE', [warehouseId])
    if (!warehouse.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Gudang tidak ditemukan.' })
    }
    const user = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const countResult = await client.query('INSERT INTO stocktakes (warehouse_id, notes, created_by, created_by_name) VALUES ($1,$2,$3,$4) RETURNING id, created_at', [warehouseId, String(request.body.notes || '').trim().slice(0, 500) || null, request.userId, user.rows[0]?.name || null])
    for (const item of counts) {
      const product = await client.query('SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [item.productId])
      if (!product.rowCount) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Produk ${item.productId} tidak ditemukan atau sudah diarsipkan.` })
      }
      const expected = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR SHARE', [warehouseId, item.productId])
      await client.query('INSERT INTO stocktake_items (stocktake_id, product_id, expected_quantity, counted_quantity) VALUES ($1,$2,$3,$4)', [countResult.rows[0].id, item.productId, expected.rows[0]?.stock || 0, item.countedQuantity])
    }
    await client.query('COMMIT')
    response.status(201).json({ id: Number(countResult.rows[0].id), warehouseId, status: 'draft', itemCount: counts.length })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505' && error.constraint === 'products_barcode_idx') return response.status(409).json({ message: 'Barcode sudah digunakan produk lain.' })
    next(error)
  } finally { client.release() }
})

app.post('/api/stocktakes/:id/complete', requireAuth, requireAdmin, async (request, response, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const stocktake = await client.query('SELECT id, warehouse_id, status FROM stocktakes WHERE id=$1 FOR UPDATE', [request.params.id])
    if (!stocktake.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Stok opname tidak ditemukan.' })
    }
    if (stocktake.rows[0].status !== 'draft') {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Stok opname ini sudah diselesaikan.' })
    }
    const items = await client.query(`
      SELECT sti.product_id, sti.expected_quantity, sti.counted_quantity, p.name, p.stock, p.low_stock_threshold, p.track_batches
      FROM stocktake_items sti JOIN products p ON p.id=sti.product_id
      WHERE sti.stocktake_id=$1 ORDER BY sti.product_id FOR UPDATE OF sti, p
    `, [stocktake.rows[0].id])
    const user = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    for (const item of items.rows) {
      const current = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [stocktake.rows[0].warehouse_id, item.product_id])
      if ((current.rows[0]?.stock || 0) !== item.expected_quantity) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Stok "${item.name}" berubah sejak hitung dibuat. Buat ulang stok opname untuk menghindari selisih yang salah.` })
      }
      const delta = item.counted_quantity - item.expected_quantity
      if (!delta) continue
      if (item.track_batches) {
        if (delta > 0) {
          await client.query('INSERT INTO product_batches (product_id, warehouse_id, batch_number, quantity) VALUES ($1,$2,$3,$4)', [item.product_id, stocktake.rows[0].warehouse_id, `STOCKTAKE-${stocktake.rows[0].id}`, delta])
        } else {
          const batches = await client.query('SELECT id, quantity FROM product_batches WHERE product_id=$1 AND warehouse_id=$2 AND quantity>0 ORDER BY expires_at NULLS LAST, id FOR UPDATE', [item.product_id, stocktake.rows[0].warehouse_id])
          let remaining = -delta
          if (batches.rows.reduce((sum, batch) => sum + batch.quantity, 0) < remaining) {
            await client.query('ROLLBACK')
            return response.status(409).json({ message: `Jumlah batch "${item.name}" tidak cukup untuk mengurangi stok saat stok opname.` })
          }
          for (const batch of batches.rows) {
            if (!remaining) break
            const reduction = Math.min(remaining, batch.quantity)
            await client.query('UPDATE product_batches SET quantity=quantity-$1 WHERE id=$2', [reduction, batch.id])
            remaining -= reduction
          }
        }
      }
      const totalAfter = item.stock + delta
      if (totalAfter < 0) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Penyesuaian "${item.name}" membuat stok total negatif.` })
      }
      await client.query('INSERT INTO warehouse_stocks (warehouse_id, product_id, stock) VALUES ($1,$2,$3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET stock=EXCLUDED.stock', [stocktake.rows[0].warehouse_id, item.product_id, item.counted_quantity])
      await client.query('UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3', [totalAfter, totalAfter === 0 ? 'Out of stock' : totalAfter <= item.low_stock_threshold ? 'Low stock' : 'Active', item.product_id])
      await client.query('INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [item.product_id, stocktake.rows[0].warehouse_id, request.userId, user.rows[0]?.name || null, delta, item.expected_quantity, item.counted_quantity, `Stocktake #${stocktake.rows[0].id}`])
    }
    await client.query("UPDATE stocktakes SET status='completed', completed_at=NOW() WHERE id=$1", [stocktake.rows[0].id])
    await client.query('COMMIT')
    response.json({ id: Number(stocktake.rows[0].id), status: 'completed', variances: items.rows.filter((item) => item.expected_quantity !== item.counted_quantity).length })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
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

app.get('/api/restock-recommendations', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.sku, p.barcode, p.low_stock_threshold,
        w.id AS warehouse_id, w.name AS warehouse_name, ws.stock,
        GREATEST(p.low_stock_threshold * 2 - ws.stock, p.low_stock_threshold) AS suggested_quantity
      FROM warehouse_stocks ws
      JOIN products p ON p.id=ws.product_id
      JOIN warehouses w ON w.id=ws.warehouse_id
      WHERE p.deleted_at IS NULL AND ws.stock <= p.low_stock_threshold
      ORDER BY ws.stock ASC, p.name, w.name
    `)
    response.json(result.rows.map((row) => ({ productId: Number(row.id), name: row.name, sku: row.sku, barcode: row.barcode, warehouseId: Number(row.warehouse_id), warehouseName: row.warehouse_name, stock: row.stock, lowStockThreshold: row.low_stock_threshold, suggestedQuantity: row.suggested_quantity })))
  } catch (error) { next(error) }
})

app.get('/api/reports', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const from = String(request.query.from || '')
    const to = String(request.query.to || '')
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) return response.status(400).json({ message: 'Format tanggal laporan harus YYYY-MM-DD.' })
    const sales = await pool.query(`
      SELECT COUNT(*)::int AS order_count,
        COALESCE(SUM((SELECT SUM((quantity-returned_quantity)*unit_price) FROM sales_order_items WHERE sales_order_id=so.id)),0)::numeric AS revenue,
        COALESCE(SUM((SELECT SUM((quantity-returned_quantity)*(unit_price-unit_cost)) FROM sales_order_items WHERE sales_order_id=so.id)),0)::numeric AS gross_margin,
        COALESCE(SUM((SELECT SUM(amount) FROM sales_payments WHERE sales_order_id=so.id AND kind='payment')),0)::numeric AS payments,
        COALESCE(SUM((SELECT SUM(amount) FROM sales_payments WHERE sales_order_id=so.id AND kind='refund')),0)::numeric AS refunds
      FROM sales_orders so
      WHERE so.status<>'cancelled' AND ($1='' OR so.created_at::date >= $1::date) AND ($2='' OR so.created_at::date <= $2::date)
    `, [from, to])
    const purchases = await pool.query(`
      SELECT COUNT(*)::int AS order_count,
        COALESCE(SUM((SELECT SUM(quantity*unit_cost) FROM purchase_order_items WHERE purchase_order_id=po.id)),0)::numeric AS ordered_amount,
        COALESCE(SUM((SELECT SUM(amount) FROM purchase_payments WHERE purchase_order_id=po.id)),0)::numeric AS paid_amount
      FROM purchase_orders po
      WHERE ($1='' OR po.created_at::date >= $1::date) AND ($2='' OR po.created_at::date <= $2::date)
    `, [from, to])
    const expenses = await pool.query(`
      SELECT COUNT(*)::int AS entry_count, COALESCE(SUM(amount), 0)::numeric AS total
      FROM operating_expenses
      WHERE ($1='' OR created_at::date >= $1::date) AND ($2='' OR created_at::date <= $2::date)
    `, [from, to])
    const bestsellers = await pool.query(`
      SELECT soi.product_id, soi.product_name, SUM(soi.quantity-soi.returned_quantity)::int AS units_sold,
        SUM((soi.quantity-soi.returned_quantity)*soi.unit_price)::numeric AS revenue,
        SUM((soi.quantity-soi.returned_quantity)*(soi.unit_price-soi.unit_cost))::numeric AS gross_margin
      FROM sales_order_items soi JOIN sales_orders so ON so.id=soi.sales_order_id
      WHERE so.status<>'cancelled' AND ($1='' OR so.created_at::date >= $1::date) AND ($2='' OR so.created_at::date <= $2::date)
      GROUP BY soi.product_id, soi.product_name ORDER BY units_sold DESC, revenue DESC LIMIT 10
    `, [from, to])
    const grossMargin = Number(sales.rows[0].gross_margin)
    const operatingExpenses = Number(expenses.rows[0].total)
    response.json({ from: from || null, to: to || null, sales: { orderCount: sales.rows[0].order_count, revenue: Number(sales.rows[0].revenue), grossMargin, payments: Number(sales.rows[0].payments), refunds: Number(sales.rows[0].refunds) }, purchases: { orderCount: purchases.rows[0].order_count, orderedAmount: Number(purchases.rows[0].ordered_amount), paidAmount: Number(purchases.rows[0].paid_amount) }, expenses: { entryCount: expenses.rows[0].entry_count, total: operatingExpenses }, estimatedNetProfit: grossMargin - operatingExpenses, bestsellers: bestsellers.rows.map((row) => ({ productId: Number(row.product_id), productName: row.product_name, unitsSold: row.units_sold, revenue: Number(row.revenue), grossMargin: Number(row.gross_margin) })) })
  } catch (error) { next(error) }
})

app.get('/api/expenses', requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const from = String(request.query.from || '')
    const to = String(request.query.to || '')
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) return response.status(400).json({ message: 'Format tanggal harus YYYY-MM-DD.' })
    const result = await pool.query(`
      SELECT e.*, COALESCE(e.recorded_by_name, u.name) AS recorded_by_name
      FROM operating_expenses e LEFT JOIN users u ON u.id=e.recorded_by
      WHERE ($1='' OR e.created_at::date >= $1::date) AND ($2='' OR e.created_at::date <= $2::date)
      ORDER BY e.created_at DESC, e.id DESC LIMIT 500
    `, [from, to])
    response.json(result.rows.map((row) => ({ id: Number(row.id), description: row.description, category: row.category, amount: Number(row.amount), paymentMethod: row.payment_method, reference: row.reference, notes: row.notes, recordedByName: row.recorded_by_name, createdAt: row.created_at })))
  } catch (error) { next(error) }
})

app.post('/api/expenses', requireAuth, requireAdmin, async (request, response, next) => {
  const { description, category, amount, paymentMethod = 'cash', reference = '', notes = '' } = request.body || {}
  const cleanDescription = String(description || '').trim()
  const cleanCategory = String(category || '').trim()
  const numericAmount = Number(amount)
  if (!cleanDescription || cleanDescription.length > 200 || !cleanCategory || cleanCategory.length > 80 || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 9_999_999_999.99) return response.status(400).json({ message: 'Deskripsi, kategori, dan jumlah biaya harus valid.' })
  if (!['cash', 'bank_transfer', 'qris', 'card', 'other'].includes(paymentMethod)) return response.status(400).json({ message: 'Metode pembayaran tidak valid.' })
  if (String(reference).length > 120 || String(notes).length > 500) return response.status(400).json({ message: 'Referensi maksimal 120 dan catatan maksimal 500 karakter.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let cashSession = null
    if (paymentMethod === 'cash') {
      cashSession = await lockOpenCashSession(client, request.userId)
      if (!cashSession) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: 'Buka sesi kas terlebih dahulu untuk mencatat pengeluaran tunai.' })
      }
    }
    const user = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const result = await client.query(`
      INSERT INTO operating_expenses (description, category, amount, payment_method, reference, notes, recorded_by, recorded_by_name, cash_session_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [cleanDescription, cleanCategory, numericAmount, paymentMethod, String(reference).trim() || null, String(notes).trim() || null, request.userId, user.rows[0]?.name || null, cashSession?.id || null])
    await client.query('COMMIT')
    const row = result.rows[0]
    response.status(201).json({ id: Number(row.id), description: row.description, category: row.category, amount: Number(row.amount), paymentMethod: row.payment_method, reference: row.reference, notes: row.notes, recordedByName: row.recorded_by_name, createdAt: row.created_at })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

app.get('/api/cash-sessions', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT cs.*,
        COALESCE((SELECT SUM(amount) FROM sales_payments WHERE cash_session_id=cs.id AND kind='payment' AND method='cash'),0)::numeric AS cash_received,
        COALESCE((SELECT SUM(amount) FROM sales_payments WHERE cash_session_id=cs.id AND kind='refund' AND method='cash'),0)::numeric AS cash_refunded,
        COALESCE((SELECT SUM(amount) FROM operating_expenses WHERE cash_session_id=cs.id AND payment_method='cash'),0)::numeric AS cash_expenses,
        cs.opening_amount
          + COALESCE((SELECT SUM(amount) FROM sales_payments WHERE cash_session_id=cs.id AND kind='payment' AND method='cash'),0)
          - COALESCE((SELECT SUM(amount) FROM sales_payments WHERE cash_session_id=cs.id AND kind='refund' AND method='cash'),0)
          - COALESCE((SELECT SUM(amount) FROM operating_expenses WHERE cash_session_id=cs.id AND payment_method='cash'),0) AS calculated_expected
      FROM cash_sessions cs
      WHERE cs.opened_by=$1
      ORDER BY cs.opened_at DESC, cs.id DESC
      LIMIT 100
    `, [request.userId])
    const sessions = result.rows.map((row) => ({
      id: Number(row.id), status: row.status, openingAmount: Number(row.opening_amount),
      closingAmount: row.closing_amount === null ? null : Number(row.closing_amount),
      expectedAmount: row.status === 'open' ? Number(row.calculated_expected) : Number(row.expected_amount),
      differenceAmount: row.difference_amount === null ? null : Number(row.difference_amount),
      cashReceived: Number(row.cash_received), cashRefunded: Number(row.cash_refunded),
      cashExpenses: Number(row.cash_expenses), openedByName: row.opened_by_name,
      closedByName: row.closed_by_name, openedAt: row.opened_at, closedAt: row.closed_at,
    }))
    response.json({ activeSession: sessions.find((session) => session.status === 'open') || null, history: sessions.filter((session) => session.status === 'closed') })
  } catch (error) { next(error) }
})

app.post('/api/cash-sessions/open', requireAuth, async (request, response, next) => {
  const openingText = String(request.body?.openingAmount ?? '')
  const openingAmount = Number(openingText)
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(openingText) || !Number.isFinite(openingAmount) || openingAmount > 9_999_999_999.99) return response.status(400).json({ message: 'Saldo awal harus angka valid minimal 0 dengan maksimal 2 desimal.' })
  try {
    const user = await pool.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const result = await pool.query(`
      INSERT INTO cash_sessions (opening_amount, opened_by, opened_by_name)
      VALUES ($1,$2,$3) RETURNING *
    `, [openingAmount, request.userId, user.rows[0]?.name || null])
    response.status(201).json({ id: Number(result.rows[0].id), status: 'open', openingAmount, expectedAmount: openingAmount, cashReceived: 0, cashRefunded: 0, cashExpenses: 0, openedByName: result.rows[0].opened_by_name, openedAt: result.rows[0].opened_at })
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'Sesi kas Anda masih terbuka. Tutup sesi tersebut sebelum membuka sesi baru.' })
    next(error)
  }
})

app.post('/api/cash-sessions/:id/close', requireAuth, async (request, response, next) => {
  const closingText = String(request.body?.closingAmount ?? '')
  const closingAmount = Number(closingText)
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(closingText) || !Number.isFinite(closingAmount) || closingAmount > 9_999_999_999.99) return response.status(400).json({ message: 'Saldo fisik harus angka valid minimal 0 dengan maksimal 2 desimal.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const sessionResult = await client.query("SELECT * FROM cash_sessions WHERE id=$1 AND opened_by=$2 AND status='open' FOR UPDATE", [request.params.id, request.userId])
    if (!sessionResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Sesi kas aktif tidak ditemukan.' })
    }
    const session = sessionResult.rows[0]
    const totals = await client.query(`
      SELECT
        COALESCE((SELECT SUM(amount) FROM sales_payments WHERE cash_session_id=$1 AND kind='payment' AND method='cash'),0)::numeric AS cash_received,
        COALESCE((SELECT SUM(amount) FROM sales_payments WHERE cash_session_id=$1 AND kind='refund' AND method='cash'),0)::numeric AS cash_refunded,
        COALESCE((SELECT SUM(amount) FROM operating_expenses WHERE cash_session_id=$1 AND payment_method='cash'),0)::numeric AS cash_expenses
    `, [session.id])
    const cashReceived = Number(totals.rows[0].cash_received)
    const cashRefunded = Number(totals.rows[0].cash_refunded)
    const cashExpenses = Number(totals.rows[0].cash_expenses)
    const expectedAmount = Math.round((Number(session.opening_amount) + cashReceived - cashRefunded - cashExpenses) * 100) / 100
    const differenceAmount = Math.round((closingAmount - expectedAmount) * 100) / 100
    const user = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const result = await client.query(`
      UPDATE cash_sessions
      SET status='closed', closing_amount=$1, expected_amount=$2, difference_amount=$3, closed_by=$4, closed_by_name=$5, closed_at=NOW()
      WHERE id=$6 RETURNING *
    `, [closingAmount, expectedAmount, differenceAmount, request.userId, user.rows[0]?.name || null, session.id])
    await client.query('COMMIT')
    response.json({ id: Number(result.rows[0].id), status: 'closed', openingAmount: Number(session.opening_amount), closingAmount, expectedAmount, differenceAmount, cashReceived, cashRefunded, cashExpenses, openedByName: session.opened_by_name, closedByName: result.rows[0].closed_by_name, openedAt: session.opened_at, closedAt: result.rows[0].closed_at })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
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

app.get('/api/navigation-counts', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM suppliers) AS suppliers,
        (SELECT COUNT(*)::int FROM purchase_orders) AS purchases,
        (SELECT COUNT(*)::int FROM customers) AS customers,
        (SELECT COUNT(*)::int FROM sales_orders) AS sales
    `)
    response.json(result.rows[0])
  } catch (error) { next(error) }
})

app.post('/api/products', requireAuth, async (request, response, next) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const values = productValues(request.body)
    const stock = values[3]
    if (!isValidStockQuantity(stock)) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Stok harus berupa bilangan bulat nonnegatif.' })
    }
    if (stock !== 0 && !(await isActiveAdmin(request.userId))) {
      await client.query('ROLLBACK')
      return response.status(403).json({ message: 'Stok awal hanya dapat diatur oleh admin. Staf dapat mencatat stok melalui transaksi pembelian.' })
    }
    const barcode = String(request.body.barcode || '').trim() || null
    if (barcode && barcode.length > 120) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Barcode maksimal 120 karakter.' })
    }
    const trackBatches = Boolean(request.body.trackBatches)
    const warehouseResult = await client.query('SELECT id FROM warehouses WHERE is_default=TRUE')
    const defaultWarehouseId = warehouseResult.rows[0]?.id
    if (!defaultWarehouseId) throw new Error('Gudang utama belum dikonfigurasi.')
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
        const result = await client.query(`INSERT INTO products (name, category, price, stock, status, media_name, media_type, media_url, low_stock_threshold, sku, barcode, track_batches) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${productFields}`, [...values, sku, barcode, trackBatches])
        row = result.rows[0]
        await client.query('RELEASE SAVEPOINT sku_attempt')
        break
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT sku_attempt')
        attempts -= 1
        if (provided || error.code !== '23505' || attempts === 0) throw error
      }
    }
    await client.query('INSERT INTO warehouse_stocks (warehouse_id, product_id, stock) VALUES ($1,$2,$3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET stock=EXCLUDED.stock', [defaultWarehouseId, row.id, stock])
    if (stock > 0) {
      const reason = String(request.body.reason || '').trim() || 'Initial stock'
      await client.query('INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, defaultWarehouseId, request.userId, userName, stock, 0, stock, reason])
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
    const existing = await client.query('SELECT stock, sku, track_batches FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [request.params.id])
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Product not found' })
    }
    const oldStock = existing.rows[0].stock
    const values = productValues(request.body)
    const newStock = values[3]
    if (!isValidStockQuantity(newStock)) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Stok harus berupa bilangan bulat nonnegatif.' })
    }
    if (newStock !== oldStock && !(await isActiveAdmin(request.userId))) {
      await client.query('ROLLBACK')
      return response.status(403).json({ message: 'Perubahan stok manual hanya dapat dilakukan oleh admin. Staf dapat mencatat stok melalui transaksi pembelian atau penjualan.' })
    }
    const barcode = String(request.body.barcode || '').trim() || null
    if (barcode && barcode.length > 120) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Barcode maksimal 120 karakter.' })
    }
    const trackBatches = Boolean(request.body.trackBatches)
    if (newStock !== oldStock && (existing.rows[0].track_batches || trackBatches)) {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Stok produk dengan pelacakan batch harus disesuaikan melalui stok opname atau penerimaan pembelian agar jumlah batch tetap akurat.' })
    }
    const warehouseResult = await client.query('SELECT id FROM warehouses WHERE is_default=TRUE')
    const defaultWarehouseId = warehouseResult.rows[0]?.id
    const otherStockResult = await client.query('SELECT COALESCE(SUM(stock),0)::int AS stock FROM warehouse_stocks WHERE product_id=$1 AND warehouse_id<>$2', [request.params.id, defaultWarehouseId])
    if (newStock < otherStockResult.rows[0].stock) {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Stok total tidak boleh lebih kecil dari stok di gudang lain.' })
    }
    const provided = String(request.body.sku || '').trim()
    const sku = provided || existing.rows[0].sku
    const result = await client.query(`UPDATE products SET name=$1, category=$2, price=$3, stock=$4, status=$5, media_name=$6, media_type=$7, media_url=$8, low_stock_threshold=$9, sku=$10, barcode=$11, track_batches=$12, updated_at=NOW() WHERE id=$13 RETURNING ${productFields}`, [...values, sku, barcode, trackBatches, request.params.id])
    const defaultStock = newStock - otherStockResult.rows[0].stock
    await client.query('INSERT INTO warehouse_stocks (warehouse_id, product_id, stock) VALUES ($1,$2,$3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET stock=EXCLUDED.stock', [defaultWarehouseId, request.params.id, defaultStock])
    if (newStock !== oldStock) {
      const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
      const userName = userResult.rows[0]?.name ?? null
      const reason = String(request.body.reason || '').trim() || 'Manual update'
      await client.query('INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [request.params.id, defaultWarehouseId, request.userId, userName, newStock - oldStock, oldStock, newStock, reason])
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

app.put('/api/products/:id/metadata', requireAuth, async (request, response, next) => {
  const barcode = String(request.body.barcode || '').trim() || null
  const trackBatches = Boolean(request.body.trackBatches)
  if (barcode && barcode.length > 120) return response.status(400).json({ message: 'Barcode maksimal 120 karakter.' })
  try {
    const result = await pool.query(`UPDATE products SET barcode=$1, track_batches=$2, updated_at=NOW() WHERE id=$3 AND deleted_at IS NULL RETURNING ${productFields}`, [barcode, trackBatches, request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Produk tidak ditemukan.' })
    response.json(normalizeProduct(result.rows[0]))
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ message: 'Barcode sudah digunakan produk lain.' })
    next(error)
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
    const result = await pool.query('SELECT m.id, m.product_id, m.warehouse_id, w.name AS warehouse_name, m.user_id, m.user_name, m.delta, m.stock_before, m.stock_after, m.reason, m.created_at FROM stock_movements m LEFT JOIN warehouses w ON w.id=m.warehouse_id WHERE m.product_id=$1 ORDER BY m.created_at DESC', [request.params.id])
    response.json(result.rows.map(normalizeMovement))
  } catch (error) { next(error) }
})

app.get('/api/stock-movements', requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT m.id, m.product_id, m.warehouse_id, w.name AS warehouse_name, m.user_id, m.user_name, m.delta, m.stock_before, m.stock_after, m.reason, m.created_at, p.name AS product_name FROM stock_movements m LEFT JOIN products p ON p.id=m.product_id LEFT JOIN warehouses w ON w.id=m.warehouse_id ORDER BY m.created_at DESC LIMIT 200')
    response.json(result.rows.map((row) => ({ ...normalizeMovement(row), productName: row.product_name ?? null })))
  } catch (error) { next(error) }
})

app.post('/api/products/bulk', requireAuth, async (request, response) => {
  const products = request.body?.products
  if (!Array.isArray(products) || products.length === 0) return response.status(400).json({ message: 'A non-empty products array is required.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (products.some((product) => Number(product?.stock) > 0) && !(await isActiveAdmin(request.userId))) {
      await client.query('ROLLBACK')
      return response.status(403).json({ message: 'Impor produk dengan stok awal hanya dapat dilakukan oleh admin.' })
    }
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const userName = userResult.rows[0]?.name ?? null
    const rows = []
    for (let index = 0; index < products.length; index += 1) {
      const body = products[index]
      try {
        const values = productValues(body)
        const stock = values[3]
        if (!isValidStockQuantity(stock)) throw new Error('Stok harus berupa bilangan bulat nonnegatif.')
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
          'unitCost', poi.unit_cost,
          'trackBatches', p.track_batches
        ) ORDER BY poi.id) FILTER (WHERE poi.id IS NOT NULL),
        '[]'::json
      ) AS items,
      COALESCE((SELECT SUM(quantity*unit_cost) FROM purchase_order_items WHERE purchase_order_id=po.id),0) AS total_amount,
      COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_order_id=po.id),0) AS paid_amount,
      COALESCE((SELECT SUM(sri.quantity*sri.unit_cost) FROM supplier_return_items sri JOIN supplier_returns sr ON sr.id=sri.supplier_return_id WHERE sr.purchase_order_id=po.id),0) AS returned_amount,
      COALESCE((SELECT json_agg(json_build_object('id',pp.id,'amount',pp.amount,'method',pp.method,'reference',pp.reference,'notes',pp.notes,'createdAt',pp.created_at) ORDER BY pp.created_at DESC) FROM purchase_payments pp WHERE pp.purchase_order_id=po.id),'[]'::json) AS payments
    FROM purchase_orders po
    LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    LEFT JOIN products p ON p.id=poi.product_id
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
  const requestedWarehouseId = Number(request.body?.warehouseId || 0)
  const dueDate = request.body?.dueDate ? String(request.body.dueDate) : null
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return response.status(400).json({ message: 'Tanggal jatuh tempo harus berformat YYYY-MM-DD.' })
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
    const warehouseResult = requestedWarehouseId
      ? await client.query('SELECT id FROM warehouses WHERE id=$1 FOR SHARE', [requestedWarehouseId])
      : await client.query('SELECT id FROM warehouses WHERE is_default=TRUE FOR SHARE')
    if (!warehouseResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Gudang tujuan tidak ditemukan.' })
    }
    const warehouseId = warehouseResult.rows[0].id
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const orderResult = await client.query(
      'INSERT INTO purchase_orders (supplier_id, supplier_name, warehouse_id, due_date, notes, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at',
      [supplierId, supplierResult.rows[0].name, warehouseId, dueDate, String(notes).slice(0, 2000) || null, request.userId, userResult.rows[0]?.name || null],
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
  const receipts = items.map((item) => ({ itemId: Number(item?.itemId), quantity: Number(item?.quantity), batchNumber: String(item?.batchNumber || '').trim(), serialNumber: String(item?.serialNumber || '').trim() || null, expiresAt: item?.expiresAt ? String(item.expiresAt) : null }))
  if (receipts.some((item) => !Number.isSafeInteger(item.itemId) || item.itemId < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 2_147_483_647)) {
    return response.status(400).json({ message: 'Jumlah penerimaan harus berupa bilangan bulat positif.' })
  }
  if (new Set(receipts.map((item) => item.itemId)).size !== receipts.length) return response.status(400).json({ message: 'Baris produk duplikat pada penerimaan.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query('SELECT id, order_number, status, warehouse_id FROM purchase_orders WHERE id=$1 FOR UPDATE', [request.params.id])
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
               p.stock, p.low_stock_threshold, p.deleted_at, p.track_batches
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
      if (item.track_batches && (!receipt.batchNumber || receipt.batchNumber.length > 120 || (receipt.serialNumber && (receipt.serialNumber.length > 120 || receipt.quantity !== 1)) || (receipt.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(receipt.expiresAt)))) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Batch, serial, atau tanggal kedaluwarsa untuk "${item.product_name}" wajib valid.` })
      }
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
      const warehouseBeforeResult = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [order.warehouse_id, item.product_id])
      const warehouseStockBefore = warehouseBeforeResult.rows[0]?.stock || 0
      const warehouseStockAfter = warehouseStockBefore + receipt.quantity
      if (stockAfter > 2_147_483_647) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Stok "${item.product_name}" melebihi batas yang dapat dicatat.` })
      }
      const status = stockAfter === 0 ? 'Out of stock' : stockAfter <= item.low_stock_threshold ? 'Low stock' : 'Active'
      await client.query(
        'UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3',
        [stockAfter, status, item.product_id],
      )
      await client.query('INSERT INTO warehouse_stocks (warehouse_id, product_id, stock) VALUES ($1,$2,$3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET stock=warehouse_stocks.stock+EXCLUDED.stock', [order.warehouse_id, item.product_id, receipt.quantity])
      await client.query(
        'UPDATE purchase_order_items SET received_quantity=received_quantity+$1 WHERE id=$2',
        [receipt.quantity, item.id],
      )
      if (item.track_batches) {
        await client.query('INSERT INTO product_batches (product_id, warehouse_id, batch_number, serial_number, expires_at, quantity) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (product_id, warehouse_id, batch_number, COALESCE(serial_number, \'\')) DO UPDATE SET quantity=product_batches.quantity+EXCLUDED.quantity, expires_at=COALESCE(EXCLUDED.expires_at, product_batches.expires_at)', [item.product_id, order.warehouse_id, receipt.batchNumber, receipt.serialNumber, receipt.expiresAt || null, receipt.quantity])
      }
      await client.query(
        'INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [item.product_id, order.warehouse_id, request.userId, userResult.rows[0]?.name ?? null, receipt.quantity, warehouseStockBefore, warehouseStockAfter, `Purchase ${order.order_number}`],
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

app.post('/api/purchases/:id/payments', requireAuth, async (request, response, next) => {
  const amount = Number(request.body.amount)
  const method = String(request.body.method || '')
  const allowedMethods = ['cash', 'bank_transfer', 'qris', 'card', 'other']
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999.99 || !allowedMethods.includes(method)) return response.status(400).json({ message: 'Jumlah atau metode pembayaran pemasok tidak valid.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const order = await client.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE', [request.params.id])
    if (!order.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Pesanan pembelian tidak ditemukan.' })
    }
    const totals = await client.query(`
      SELECT COALESCE((SELECT SUM(quantity*unit_cost) FROM purchase_order_items WHERE purchase_order_id=$1),0)
        - COALESCE((SELECT SUM(sri.quantity*sri.unit_cost) FROM supplier_return_items sri JOIN supplier_returns sr ON sr.id=sri.supplier_return_id WHERE sr.purchase_order_id=$1),0)
        - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_order_id=$1),0) AS balance_due
    `, [request.params.id])
    const balanceCents = Math.max(0, Math.round(Number(totals.rows[0].balance_due) * 100))
    const amountCents = Math.round(amount * 100)
    if (amountCents > balanceCents) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: `Pembayaran melebihi sisa utang ${(balanceCents / 100).toFixed(2)}.` })
    }
    const user = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    await client.query('INSERT INTO purchase_payments (purchase_order_id, amount, method, reference, notes, recorded_by, recorded_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)', [request.params.id, amount, method, String(request.body.reference || '').trim().slice(0, 120) || null, String(request.body.notes || '').trim().slice(0, 500) || null, request.userId, user.rows[0]?.name || null])
    await client.query('COMMIT')
    response.json((await readPurchaseOrders('WHERE po.id=$1', [request.params.id]))[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

app.post('/api/supplier-returns', requireAuth, async (request, response, next) => {
  const purchaseOrderId = Number(request.body.purchaseOrderId)
  const items = Array.isArray(request.body.items) ? request.body.items : []
  if (!Number.isSafeInteger(purchaseOrderId) || purchaseOrderId < 1 || !items.length || items.length > 100) return response.status(400).json({ message: 'Pilih pesanan pembelian dan minimal satu produk untuk diretur.' })
  const returns = items.map((item) => ({ productId: Number(item.productId), quantity: Number(item.quantity) }))
  if (returns.some((item) => !Number.isSafeInteger(item.productId) || item.productId < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1) || new Set(returns.map((item) => item.productId)).size !== returns.length) return response.status(400).json({ message: 'Produk retur atau jumlah tidak valid.' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const orderResult = await client.query('SELECT id, supplier_id, warehouse_id FROM purchase_orders WHERE id=$1 FOR UPDATE', [purchaseOrderId])
    if (!orderResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Pesanan pembelian tidak ditemukan.' })
    }
    const order = orderResult.rows[0]
    const user = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const returnResult = await client.query('INSERT INTO supplier_returns (supplier_id, purchase_order_id, warehouse_id, reason, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [order.supplier_id, order.id, order.warehouse_id, String(request.body.reason || '').trim().slice(0, 500) || null, request.userId, user.rows[0]?.name || null])
    for (const item of returns) {
      const line = await client.query(`
        SELECT poi.id, poi.product_id, poi.product_name, poi.unit_cost, poi.received_quantity, p.stock, p.low_stock_threshold,
          COALESCE((SELECT SUM(sri.quantity) FROM supplier_return_items sri JOIN supplier_returns sr ON sr.id=sri.supplier_return_id WHERE sr.purchase_order_id=$1 AND sri.product_id=poi.product_id),0)::int AS already_returned,
          COALESCE((SELECT stock FROM warehouse_stocks WHERE warehouse_id=$2 AND product_id=poi.product_id),0)::int AS warehouse_stock,
          p.track_batches
        FROM purchase_order_items poi JOIN products p ON p.id=poi.product_id
        WHERE poi.purchase_order_id=$1 AND poi.product_id=$3
        FOR UPDATE OF poi, p
      `, [order.id, order.warehouse_id, item.productId])
      if (!line.rowCount) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Produk ${item.productId} tidak ada pada pesanan tersebut.` })
      }
      const row = line.rows[0]
      if (item.quantity > row.received_quantity - row.already_returned || item.quantity > row.warehouse_stock) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Jumlah retur ${row.product_name} melebihi barang diterima yang masih tersedia.` })
      }
      const totalAfter = row.stock - item.quantity
      const warehouseAfter = row.warehouse_stock - item.quantity
      if (row.track_batches) {
        const batches = await client.query('SELECT id, batch_number, serial_number, quantity FROM product_batches WHERE product_id=$1 AND warehouse_id=$2 AND quantity>0 ORDER BY expires_at NULLS LAST, id FOR UPDATE', [row.product_id, order.warehouse_id])
        const availableBatchUnits = batches.rows.reduce((sum, batch) => sum + batch.quantity, 0)
        if (item.quantity > availableBatchUnits) {
          await client.query('ROLLBACK')
          return response.status(409).json({ message: `Jumlah batch ${row.product_name} tidak sesuai stok tersedia.` })
        }
        let remainingBatchReturn = item.quantity
        for (const batch of batches.rows) {
          if (!remainingBatchReturn) break
          const quantity = Math.min(remainingBatchReturn, batch.quantity)
          await client.query('UPDATE product_batches SET quantity=quantity-$1 WHERE id=$2', [quantity, batch.id])
          remainingBatchReturn -= quantity
        }
      }
      await client.query('UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3', [totalAfter, totalAfter === 0 ? 'Out of stock' : totalAfter <= row.low_stock_threshold ? 'Low stock' : 'Active', row.product_id])
      await client.query('UPDATE warehouse_stocks SET stock=$1 WHERE warehouse_id=$2 AND product_id=$3', [warehouseAfter, order.warehouse_id, row.product_id])
      await client.query('INSERT INTO supplier_return_items (supplier_return_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)', [returnResult.rows[0].id, row.product_id, item.quantity, row.unit_cost])
      await client.query('INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [row.product_id, order.warehouse_id, request.userId, user.rows[0]?.name || null, -item.quantity, row.warehouse_stock, warehouseAfter, `Supplier return #${returnResult.rows[0].id}`])
    }
    await client.query('COMMIT')
    response.status(201).json({ id: Number(returnResult.rows[0].id), purchaseOrderId, supplierId: Number(order.supplier_id), items: returns })
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
      ) AS items,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', sp.id,
          'kind', sp.kind,
          'amount', sp.amount,
          'method', sp.method,
          'reference', sp.reference,
          'notes', sp.notes,
          'recordedByName', sp.recorded_by_name,
          'createdAt', sp.created_at
        ) ORDER BY sp.created_at DESC, sp.id DESC)
        FROM sales_payments sp
        WHERE sp.sales_order_id=so.id
      ), '[]'::json) AS payments,
      COALESCE((SELECT SUM(sp.amount) FROM sales_payments sp WHERE sp.sales_order_id=so.id AND sp.kind='payment'), 0) AS paid_amount,
      COALESCE((SELECT SUM(sp.amount) FROM sales_payments sp WHERE sp.sales_order_id=so.id AND sp.kind='refund'), 0) AS refunded_amount
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

app.get('/api/receivables', requireAuth, async (_request, response, next) => {
  try {
    const orders = await readSalesOrders()
    const now = Date.now()
    const outstanding = orders
      .filter((order) => order.balanceDue > 0)
      .map((order) => ({ orderNumber: order.orderNumber, customerId: order.customerId, customerName: order.customerName, totalAmount: order.totalAmount, paidAmount: order.paidAmount, balanceDue: order.balanceDue, createdAt: order.createdAt, agingDays: Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 86_400_000)) }))
    response.json({ totalOutstanding: Math.round(outstanding.reduce((sum, order) => sum + order.balanceDue, 0) * 100) / 100, orders: outstanding })
  } catch (error) { next(error) }
})

app.post('/api/sales', requireAuth, async (request, response, next) => {
  const { customerId, items, notes = '' } = request.body || {}
  const checkoutPaymentMethod = request.body?.checkoutPaymentMethod || null
  const requestedWarehouseId = Number(request.body?.warehouseId || 0)
  const normalizedCustomerId = customerId === null || customerId === undefined || customerId === '' ? null : Number(customerId)
  if (normalizedCustomerId !== null && (!Number.isSafeInteger(normalizedCustomerId) || normalizedCustomerId < 1)) return response.status(400).json({ message: 'Pelanggan tidak valid.' })
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
  if (checkoutPaymentMethod !== null && checkoutPaymentMethod !== 'cash') return response.status(400).json({ message: 'Metode pembayaran checkout tidak valid.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cashSession = checkoutPaymentMethod === 'cash' ? await lockOpenCashSession(client, request.userId) : null
    if (checkoutPaymentMethod === 'cash' && !cashSession) {
      await client.query('ROLLBACK')
      return response.status(409).json({ message: 'Buka sesi kas harian sebelum checkout POS tunai.' })
    }
    const customerResult = normalizedCustomerId === null
      ? { rows: [{ id: null, name: 'Pelanggan umum', email: null, phone: null }], rowCount: 1 }
      : await client.query(`SELECT ${customerFields} FROM customers WHERE id=$1 FOR SHARE`, [normalizedCustomerId])
    if (!customerResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Pelanggan tidak ditemukan.' })
    }
    const warehouseResult = requestedWarehouseId
      ? await client.query('SELECT id FROM warehouses WHERE id=$1 FOR SHARE', [requestedWarehouseId])
      : await client.query('SELECT id FROM warehouses WHERE is_default=TRUE FOR SHARE')
    if (!warehouseResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(400).json({ message: 'Gudang pengambilan tidak ditemukan.' })
    }
    const warehouseId = warehouseResult.rows[0].id
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    const customer = customerResult.rows[0]
    const orderResult = await client.query(
      'INSERT INTO sales_orders (customer_id, customer_name, customer_email, customer_phone, warehouse_id, notes, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at',
      [customer.id, customer.name, customer.email, customer.phone, warehouseId, String(notes).trim() || null, request.userId, userResult.rows[0]?.name || null],
    )
    const order = orderResult.rows[0]
    const date = new Date(order.created_at).toISOString().slice(0, 10).replaceAll('-', '')
    const orderNumber = `SO-${date}-${String(order.id).padStart(6, '0')}`
    const invoiceNumber = orderNumber.replace(/^SO-/, 'INV-')
    await client.query('UPDATE sales_orders SET order_number=$1, invoice_number=$2 WHERE id=$3', [orderNumber, invoiceNumber, order.id])

    let checkoutTotalCents = 0n
    for (const item of normalizedItems.sort((a, b) => a.productId - b.productId)) {
      const productResult = await client.query(
        `SELECT p.id, p.name, p.sku, p.price, p.stock, p.low_stock_threshold, p.track_batches,
          (SELECT poi.unit_cost FROM purchase_order_items poi JOIN purchase_orders po ON po.id=poi.purchase_order_id
            WHERE poi.product_id=p.id AND poi.received_quantity>0 ORDER BY po.created_at DESC, poi.id DESC LIMIT 1) AS last_unit_cost
          FROM products p WHERE p.id=$1 AND p.deleted_at IS NULL FOR UPDATE`,
        [item.productId],
      )
      if (!productResult.rowCount) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Produk dengan ID ${item.productId} tidak ditemukan atau sudah diarsipkan.` })
      }
      const product = productResult.rows[0]
      if (checkoutPaymentMethod === 'cash') {
        const [wholePrice, fractionalPrice = ''] = String(product.price).split('.')
        checkoutTotalCents += (BigInt(wholePrice) * 100n + BigInt(fractionalPrice.padEnd(2, '0'))) * BigInt(item.quantity)
        if (checkoutTotalCents > 999_999_999_999n) {
          await client.query('ROLLBACK')
          return response.status(400).json({ message: 'Total checkout melebihi batas nominal transaksi.' })
        }
      }
      const warehouseStockResult = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [warehouseId, product.id])
      const warehouseStock = warehouseStockResult.rows[0]?.stock || 0
      if (item.quantity > warehouseStock) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Stok "${product.name}" di gudang terpilih tidak cukup. Tersedia ${warehouseStock} unit.` })
      }
      const stockAfter = product.stock - item.quantity
      const warehouseStockAfter = warehouseStock - item.quantity
      const status = stockAfter === 0 ? 'Out of stock' : stockAfter <= product.low_stock_threshold ? 'Low stock' : 'Active'
      await client.query('UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3', [stockAfter, status, product.id])
      await client.query('UPDATE warehouse_stocks SET stock=$1 WHERE warehouse_id=$2 AND product_id=$3', [warehouseStockAfter, warehouseId, product.id])
      const salesItemResult = await client.query(
        'INSERT INTO sales_order_items (sales_order_id, product_id, product_name, sku, quantity, unit_price, unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [order.id, product.id, product.name, product.sku, item.quantity, product.price, Number(product.last_unit_cost || 0)],
      )
      if (product.track_batches) {
        const batches = await client.query('SELECT id, quantity FROM product_batches WHERE product_id=$1 AND warehouse_id=$2 AND quantity>0 ORDER BY expires_at NULLS LAST, created_at, id FOR UPDATE', [product.id, warehouseId])
        const availableBatchUnits = batches.rows.reduce((sum, batch) => sum + batch.quantity, 0)
        if (availableBatchUnits < item.quantity) {
          await client.query('ROLLBACK')
          return response.status(409).json({ message: `Batch/serial ${product.name} belum terdaftar atau jumlah batch tidak mencukupi.` })
        }
        let remaining = item.quantity
        for (const batch of batches.rows) {
          if (!remaining) break
          const allocated = Math.min(remaining, batch.quantity)
          await client.query('UPDATE product_batches SET quantity=quantity-$1 WHERE id=$2', [allocated, batch.id])
          await client.query('INSERT INTO sales_order_item_batches (sales_order_item_id, product_batch_id, quantity) VALUES ($1,$2,$3)', [salesItemResult.rows[0].id, batch.id, allocated])
          remaining -= allocated
        }
      }
      await client.query(
        'INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [product.id, warehouseId, request.userId, userResult.rows[0]?.name ?? null, -item.quantity, warehouseStock, warehouseStockAfter, `Sale ${orderNumber}`],
      )
    }
    if (checkoutPaymentMethod === 'cash') {
      const checkoutTotal = `${checkoutTotalCents / 100n}.${String(checkoutTotalCents % 100n).padStart(2, '0')}`
      await client.query(
        "INSERT INTO sales_payments (sales_order_id, kind, amount, method, notes, recorded_by, recorded_by_name, cash_session_id) VALUES ($1,'payment',$2,'cash','POS checkout',$3,$4,$5)",
        [order.id, checkoutTotal, request.userId, userResult.rows[0]?.name || null, cashSession.id],
      )
    }
    await client.query('COMMIT')
    response.status(201).json((await readSalesOrders('WHERE so.id=$1', [order.id]))[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    next(error)
  } finally { client.release() }
})

app.post('/api/sales/:id/payments', requireAuth, async (request, response, next) => {
  const { kind = 'payment', amount, method, reference = '', notes = '' } = request.body || {}
  const amountText = String(amount ?? '')
  const amountValue = Number(amountText)
  const amountCents = Math.round(amountValue * 100)
  const methods = ['cash', 'bank_transfer', 'qris', 'card', 'other']
  if (!['payment', 'refund'].includes(kind)) return response.status(400).json({ message: 'Jenis pencatatan pembayaran tidak valid.' })
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amountText) || !Number.isFinite(amountValue) || amountValue <= 0 || amountValue > 9_999_999_999.99) {
    return response.status(400).json({ message: 'Jumlah harus lebih dari nol dan maksimal dua angka desimal.' })
  }
  if (!methods.includes(method)) return response.status(400).json({ message: 'Metode pembayaran tidak valid.' })
  if (String(reference).length > 120 || String(notes).length > 500) return response.status(400).json({ message: 'Referensi maksimal 120 karakter dan catatan maksimal 500 karakter.' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let cashSession = null
    if (method === 'cash') {
      cashSession = await lockOpenCashSession(client, request.userId)
      if (!cashSession) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: 'Buka sesi kas harian sebelum mencatat pembayaran atau refund tunai.' })
      }
    }
    const orderResult = await client.query('SELECT id, status FROM sales_orders WHERE id=$1 FOR UPDATE', [request.params.id])
    if (!orderResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ message: 'Invoice tidak ditemukan.' })
    }
    const order = orderResult.rows[0]
    const amountResult = await client.query(`
      SELECT COALESCE(SUM((quantity-returned_quantity)*unit_price), 0) AS total_amount
      FROM sales_order_items
      WHERE sales_order_id=$1
    `, [order.id])
    const paymentResult = await client.query(`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE kind='payment'), 0) AS paid_amount,
        COALESCE(SUM(amount) FILTER (WHERE kind='refund'), 0) AS refunded_amount
      FROM sales_payments
      WHERE sales_order_id=$1
    `, [order.id])
    const totalAmount = order.status === 'cancelled' ? 0 : Number(amountResult.rows[0].total_amount)
    const paidAmount = Number(paymentResult.rows[0].paid_amount)
    const refundedAmount = Number(paymentResult.rows[0].refunded_amount)
    const netPaid = paidAmount - refundedAmount
    if (kind === 'payment') {
      if (order.status === 'cancelled' || order.status === 'returned') {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: 'Pembayaran tidak dapat ditambahkan pada pesanan batal atau yang sudah diretur seluruhnya.' })
      }
      const outstandingCents = Math.max(0, Math.round((totalAmount - netPaid) * 100))
      if (amountCents > outstandingCents) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Jumlah pembayaran melebihi sisa tagihan ${(outstandingCents / 100).toFixed(2)}.` })
      }
    } else {
      const refundAvailableCents = Math.max(0, Math.round((netPaid - totalAmount) * 100))
      if (amountCents > refundAvailableCents) {
        await client.query('ROLLBACK')
        return response.status(400).json({ message: `Jumlah refund melebihi dana berlebih ${(refundAvailableCents / 100).toFixed(2)}.` })
      }
    }
    const userResult = await client.query('SELECT name FROM users WHERE id=$1', [request.userId])
    await client.query(
      'INSERT INTO sales_payments (sales_order_id, kind, amount, method, reference, notes, recorded_by, recorded_by_name, cash_session_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [order.id, kind, amountValue, method, String(reference).trim() || null, String(notes).trim() || null, request.userId, userResult.rows[0]?.name || null, cashSession?.id || null],
    )
    await client.query('COMMIT')
    response.json((await readSalesOrders('WHERE so.id=$1', [order.id]))[0])
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
    const orderResult = await client.query('SELECT id, order_number, status, warehouse_id FROM sales_orders WHERE id=$1 FOR UPDATE', [request.params.id])
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
               p.stock, p.low_stock_threshold, p.track_batches
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
      const warehouseStockResult = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [order.warehouse_id, line.product_id])
      const warehouseStock = warehouseStockResult.rows[0]?.stock || 0
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
      const warehouseStockAfter = warehouseStock + item.quantity
      const status = stockAfter === 0 ? 'Out of stock' : stockAfter <= line.low_stock_threshold ? 'Low stock' : 'Active'
      await client.query('UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3', [stockAfter, status, line.product_id])
      await client.query('INSERT INTO warehouse_stocks (warehouse_id, product_id, stock) VALUES ($1,$2,$3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET stock=EXCLUDED.stock', [order.warehouse_id, line.product_id, warehouseStockAfter])
      if (line.track_batches) {
        const batchAllocations = await client.query(`
          SELECT sob.product_batch_id, sob.quantity, sob.returned_quantity
          FROM sales_order_item_batches sob
          JOIN product_batches pb ON pb.id=sob.product_batch_id
          WHERE sob.sales_order_item_id=$1
          ORDER BY pb.expires_at NULLS LAST, pb.id
          FOR UPDATE OF sob, pb
        `, [line.id])
        let toRestore = item.quantity
        for (const allocation of batchAllocations.rows) {
          if (!toRestore) break
          const restore = Math.min(toRestore, allocation.quantity - allocation.returned_quantity)
          if (!restore) continue
          await client.query('UPDATE product_batches SET quantity=quantity+$1 WHERE id=$2', [restore, allocation.product_batch_id])
          await client.query('UPDATE sales_order_item_batches SET returned_quantity=returned_quantity+$1 WHERE sales_order_item_id=$2 AND product_batch_id=$3', [restore, line.id, allocation.product_batch_id])
          toRestore -= restore
        }
        if (toRestore) {
          await client.query('ROLLBACK')
          return response.status(409).json({ message: `Alokasi batch untuk "${line.product_name}" tidak lengkap.` })
        }
      }
      await client.query('UPDATE sales_order_items SET returned_quantity=returned_quantity+$1 WHERE id=$2', [item.quantity, line.id])
      await client.query(
        'INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [line.product_id, order.warehouse_id, request.userId, userResult.rows[0]?.name ?? null, item.quantity, warehouseStock, warehouseStockAfter, `Return ${order.order_number}`],
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
    const orderResult = await client.query('SELECT id, order_number, status, warehouse_id FROM sales_orders WHERE id=$1 FOR UPDATE', [request.params.id])
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
             p.stock, p.low_stock_threshold, p.track_batches
      FROM sales_order_items soi
      JOIN products p ON p.id=soi.product_id
      WHERE soi.sales_order_id=$1
      ORDER BY soi.id
      FOR UPDATE OF soi, p
    `, [order.id])
    for (const line of linesResult.rows) {
      const quantity = line.quantity - line.returned_quantity
      if (!quantity) continue
      const warehouseStockResult = await client.query('SELECT stock FROM warehouse_stocks WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE', [order.warehouse_id, line.product_id])
      const warehouseStock = warehouseStockResult.rows[0]?.stock || 0
      if (line.stock + quantity > 2_147_483_647) {
        await client.query('ROLLBACK')
        return response.status(409).json({ message: `Stok "${line.product_name}" melebihi batas yang dapat dicatat.` })
      }
      const stockAfter = line.stock + quantity
      const warehouseStockAfter = warehouseStock + quantity
      const status = stockAfter === 0 ? 'Out of stock' : stockAfter <= line.low_stock_threshold ? 'Low stock' : 'Active'
      await client.query('UPDATE products SET stock=$1, status=$2, updated_at=NOW() WHERE id=$3', [stockAfter, status, line.product_id])
      await client.query('INSERT INTO warehouse_stocks (warehouse_id, product_id, stock) VALUES ($1,$2,$3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET stock=EXCLUDED.stock', [order.warehouse_id, line.product_id, warehouseStockAfter])
      if (line.track_batches) {
        const allocations = await client.query('SELECT product_batch_id, quantity, returned_quantity FROM sales_order_item_batches WHERE sales_order_item_id=$1 FOR UPDATE', [line.id])
        let restoreRemaining = quantity
        for (const allocation of allocations.rows) {
          if (!restoreRemaining) break
          const restore = Math.min(restoreRemaining, allocation.quantity - allocation.returned_quantity)
          if (!restore) continue
          await client.query('UPDATE product_batches SET quantity=quantity+$1 WHERE id=$2', [restore, allocation.product_batch_id])
          await client.query('UPDATE sales_order_item_batches SET returned_quantity=quantity WHERE sales_order_item_id=$1 AND product_batch_id=$2', [line.id, allocation.product_batch_id])
          restoreRemaining -= restore
        }
        if (restoreRemaining) {
          await client.query('ROLLBACK')
          return response.status(409).json({ message: `Alokasi batch untuk "${line.product_name}" tidak lengkap.` })
        }
      }
      await client.query(
        'INSERT INTO stock_movements (product_id, warehouse_id, user_id, user_name, delta, stock_before, stock_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [line.product_id, order.warehouse_id, request.userId, userResult.rows[0]?.name ?? null, quantity, warehouseStock, warehouseStockAfter, `Cancel ${order.order_number}`],
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
