import test from 'node:test'
import assert from 'node:assert/strict'
import { createBackupObjectKey, uploadBackupToR2 } from './backup-storage.js'

const storageEnv = {
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'ifal-backups',
}

test('creates a daily R2 key using the Jakarta calendar date', () => {
  assert.equal(createBackupObjectKey(new Date('2025-01-01T17:00:00.000Z')), 'backups/daily/ifal-store-2025-01-02.json')
})

test('refuses to upload when R2 credentials are incomplete', async () => {
  await assert.rejects(
    uploadBackupToR2({ createdAt: '2025-01-01T00:00:00.000Z' }, { env: {} }),
    /R2_ACCOUNT_ID/,
  )
})

test('uploads the JSON backup to the expected bucket and key', async () => {
  let command
  const client = { send: async (value) => { command = value } }
  const payload = { format: 'ifal-store-backup', version: 2, createdAt: '2025-01-01T17:00:00.000Z', tables: {} }
  const result = await uploadBackupToR2(payload, { env: storageEnv, client })

  assert.equal(result.key, 'backups/daily/ifal-store-2025-01-02.json')
  assert.equal(command.input.Bucket, 'ifal-backups')
  assert.equal(command.input.Key, result.key)
  assert.equal(command.input.ContentType, 'application/json')
  assert.equal(command.input.Body.toString('utf8'), JSON.stringify(payload))
})
