import 'dotenv/config'
import crypto from 'node:crypto'
import pg from 'pg'

const { Pool } = pg
const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
const name = process.env.ADMIN_NAME || 'Administrator'
const databaseUrl = process.env.DATABASE_URL

if (!email || !password) {
  console.error('Set ADMIN_EMAIL dan ADMIN_PASSWORD di file .env terlebih dahulu.')
  process.exit(1)
}

let parsedDatabaseUrl
try {
  parsedDatabaseUrl = new URL(databaseUrl)
} catch {
  console.error('Set DATABASE_URL di file .env ke connection string PostgreSQL yang valid.')
  process.exit(1)
}

if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) || !parsedDatabaseUrl.hostname || !parsedDatabaseUrl.username || !parsedDatabaseUrl.password) {
  console.error('DATABASE_URL harus berisi URL PostgreSQL dengan host, username, dan password.')
  process.exit(1)
}

const salt = crypto.randomBytes(16).toString('hex')
const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
const pool = new Pool({ connectionString: databaseUrl })

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
