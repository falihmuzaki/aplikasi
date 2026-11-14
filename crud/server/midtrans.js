import crypto from 'node:crypto'

export class PaymentProviderError extends Error {
  constructor(message, code = 'midtrans_error') {
    super(message)
    this.name = 'PaymentProviderError'
    this.code = code
  }
}

function getUrls(isProduction) {
  return isProduction
    ? { snap: 'https://app.midtrans.com/snap/v1/transactions', api: 'https://api.midtrans.com' }
    : { snap: 'https://app.sandbox.midtrans.com/snap/v1/transactions', api: 'https://api.sandbox.midtrans.com' }
}

async function requestMidtrans(url, serverKey, options, fetchImpl) {
  let response
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
        ...options.headers,
      },
    })
  } catch (error) {
    throw new PaymentProviderError(`Midtrans request failed: ${error.message}`, 'midtrans_network_error')
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new PaymentProviderError('Midtrans returned an invalid response.', 'midtrans_invalid_response')
  }
  if (!response.ok) {
    const message = Array.isArray(body?.error_messages) ? body.error_messages.join('; ') : 'Midtrans rejected the request.'
    throw new PaymentProviderError(message, 'midtrans_http_error')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PaymentProviderError('Midtrans returned an invalid response.', 'midtrans_invalid_response')
  }
  return body
}

export async function createMidtransSnap({ serverKey, isProduction = false, payload, fetchImpl = fetch }) {
  if (!serverKey || typeof serverKey !== 'string') throw new PaymentProviderError('Midtrans Server Key is not configured.', 'midtrans_not_configured')
  const { snap } = getUrls(isProduction)
  const result = await requestMidtrans(snap, serverKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, fetchImpl)
  if (typeof result.token !== 'string' || typeof result.redirect_url !== 'string') {
    throw new PaymentProviderError('Midtrans did not return a payment URL.', 'midtrans_invalid_response')
  }
  return { token: result.token, redirectUrl: result.redirect_url }
}

export async function getMidtransTransactionStatus({ serverKey, isProduction = false, orderId, fetchImpl = fetch }) {
  if (!serverKey || typeof serverKey !== 'string') throw new PaymentProviderError('Midtrans Server Key is not configured.', 'midtrans_not_configured')
  const { api } = getUrls(isProduction)
  const result = await requestMidtrans(
    `${api}/v2/${encodeURIComponent(orderId)}/status`,
    serverKey,
    { method: 'GET' },
    fetchImpl,
  )
  if (typeof result.order_id !== 'string' || typeof result.transaction_status !== 'string') {
    throw new PaymentProviderError('Midtrans returned an invalid transaction status.', 'midtrans_invalid_response')
  }
  return result
}

export function verifyMidtransSignature(notification, serverKey) {
  if (!notification || typeof notification !== 'object' || typeof serverKey !== 'string' || !serverKey) return false
  const { order_id: orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: signature } = notification
  if ([orderId, statusCode, grossAmount, signature].some((value) => typeof value !== 'string' || !value)) return false
  if (!/^[a-f\d]{128}$/i.test(signature)) return false
  const expected = crypto.createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest()
  const received = Buffer.from(signature, 'hex')
  return received.length === expected.length && crypto.timingSafeEqual(received, expected)
}

export function parseMidtransAmountToCents(value) {
  const amount = String(value ?? '')
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(amount)
  if (!match) return null
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'))
}

export function classifyMidtransStatus(status, fraudStatus) {
  if ((status === 'settlement' || status === 'capture') && fraudStatus === 'accept') return 'paid'
  if (status === 'pending') return 'pending'
  if (['expire', 'cancel', 'deny'].includes(status)) return 'failed'
  return 'unknown'
}
