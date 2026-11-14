import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export function createBackupObjectKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `backups/daily/ifal-store-${values.year}-${values.month}-${values.day}.json`
}

function readStorageConfig(env) {
  const accountId = String(env.R2_ACCOUNT_ID || '').trim()
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim()
  const bucket = String(env.R2_BUCKET_NAME || '').trim()
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME are required.')
  }
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

export async function uploadBackupToR2(payload, { env = process.env, client } = {}) {
  const { accountId, accessKeyId, secretAccessKey, bucket } = readStorageConfig(env)
  const s3 = client || new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  const key = createBackupObjectKey(new Date(payload.createdAt))
  const body = Buffer.from(JSON.stringify(payload))
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    ContentLength: body.length,
  }))
  return { key, sizeBytes: body.length }
}
