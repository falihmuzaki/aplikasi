import 'dotenv/config'
import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const app = express()
const port = Number(process.env.PORT || 3001)
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql')

app.use(cors())
app.use(express.json({ limit: '8mb' }))

const productFields = 'id, name, category, price, stock, status, media_name, media_type, media_url, created_at, updated_at'
const userFields = 'id, name, email, role, is_active, created_at, updated_at'

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
  return { id: Number(row.id), name: row.name, email: row.email, role: row.role, isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at }
}

app.get('/api/health', async (_request, response) => {
  const result = await pool.query('SELECT NOW() AS now')
  response.json({ ok: true, databaseTime: result.rows[0].now })
})

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const password = String(request.body.password || '')
    const result = await pool.query(`SELECT ${userFields}, password_hash FROM users WHERE email=$1 AND is_active=TRUE`, [email])
    const user = result.rows[0]
    if (!user || !verifyPassword(password, user.password_hash)) return response.status(401).json({ message: 'Email atau password tidak sesuai.' })
    response.json({ user: normalizeUser(user) })
  } catch (error) { next(error) }
})

app.get('/api/products', async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT ${productFields} FROM products ORDER BY created_at DESC`)
    response.json(result.rows.map(normalizeProduct))
  } catch (error) { next(error) }
})

app.post('/api/products', async (request, response, next) => {
  try {
    const values = productValues(request.body)
    const result = await pool.query(`INSERT INTO products (name, category, price, stock, status, media_name, media_type, media_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${productFields}`, values)
    response.status(201).json(normalizeProduct(result.rows[0]))
  } catch (error) { next(error) }
})

app.put('/api/products/:id', async (request, response, next) => {
  try {
    const values = productValues(request.body)
    const result = await pool.query(`UPDATE products SET name=$1, category=$2, price=$3, stock=$4, status=$5, media_name=$6, media_type=$7, media_url=$8, updated_at=NOW() WHERE id=$9 RETURNING ${productFields}`, [...values, request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Product not found' })
    response.json(normalizeProduct(result.rows[0]))
  } catch (error) { next(error) }
})

app.delete('/api/products/:id', async (request, response, next) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id=$1', [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'Product not found' })
    response.status(204).end()
  } catch (error) { next(error) }
})

app.get('/api/users', async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT ${userFields} FROM users ORDER BY created_at DESC`)
    response.json(result.rows.map(normalizeUser))
  } catch (error) { next(error) }
})

app.post('/api/users', async (request, response, next) => {
  try {
    const { name, email, password, role = 'staff', isActive = true } = request.body
    if (!name || !email || !password) return response.status(400).json({ message: 'Name, email, and password are required' })
    const result = await pool.query(`INSERT INTO users (name, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING ${userFields}`, [name, email.toLowerCase(), hashPassword(password), role, isActive])
    response.status(201).json(normalizeUser(result.rows[0]))
  } catch (error) { next(error) }
})

app.put('/api/users/:id', async (request, response, next) => {
  try {
    const { name, email, password, role = 'staff', isActive = true } = request.body
    const values = [name, email.toLowerCase(), role, isActive]
    const passwordPart = password ? ', password_hash=$5' : ''
    if (password) values.push(hashPassword(password))
    values.push(request.params.id)
    const result = await pool.query(`UPDATE users SET name=$1, email=$2, role=$3, is_active=$4${passwordPart}, updated_at=NOW() WHERE id=$${password ? 6 : 5} RETURNING ${userFields}`, values)
    if (!result.rowCount) return response.status(404).json({ message: 'User not found' })
    response.json(normalizeUser(result.rows[0]))
  } catch (error) { next(error) }
})

app.delete('/api/users/:id', async (request, response, next) => {
  try {
    const result = await pool.query('DELETE FROM users WHERE id=$1', [request.params.id])
    if (!result.rowCount) return response.status(404).json({ message: 'User not found' })
    response.status(204).end()
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
