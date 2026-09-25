import 'dotenv/config'
import crypto from 'node:crypto'
import pg from 'pg'

const { Pool } = pg
const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
const name = process.env.ADMIN_NAME || 'Administrator'

if (!email || !password) {
  console.error('Set ADMIN_EMAIL dan ADMIN_PASSWORD di file .env terlebih dahulu.')
  process.exit(1)
}

const salt = crypto.randomBytes(16).toString('hex')
const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  await pool.query(`
    INSERT INTO users (name, email, password_hash, role, is_active)
    VALUES ($1, $2, $3, 'admin', TRUE)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      role = 'admin',
      is_active = TRUE,
      updated_at = NOW()
  `, [name, email, passwordHash])
  console.log(`Admin user ready: ${email}`)
} finally {
  await pool.end()
}
