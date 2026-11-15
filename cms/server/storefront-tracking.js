import crypto from 'node:crypto'

export function createStorefrontTrackingToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function isStorefrontTrackingToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

export function hashStorefrontTrackingToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function canAdvanceStorefrontFulfillmentStatus(current, method, next) {
  if (current === 'pending') return next === 'processing'
  if (current === 'processing') return method === 'pickup' ? next === 'ready_for_pickup' : method === 'delivery' && next === 'shipped'
  if (current === 'ready_for_pickup') return method === 'pickup' && next === 'completed'
  if (current === 'shipped') return method === 'delivery' && next === 'completed'
  return false
}
