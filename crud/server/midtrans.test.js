import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { classifyMidtransStatus, createMidtransSnap, getMidtransTransactionStatus, parseMidtransAmountToCents, verifyMidtransSignature } from './midtrans.js'

function mockResponse(body, ok = true) {
  return { ok, json: async () => body }
}

test('creates a sandbox Snap transaction using Basic server-key auth', async () => {
  let request
  const result = await createMidtransSnap({
    serverKey: 'sandbox-key',
    payload: { transaction_details: { order_id: 'SO-123', gross_amount: 25000 } },
    fetchImpl: async (url, options) => {
      request = { url, options }
      return mockResponse({ token: 'snap-token', redirect_url: 'https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token' })
    },
  })

  assert.equal(request.url, 'https://app.sandbox.midtrans.com/snap/v1/transactions')
  assert.equal(request.options.headers.Authorization, `Basic ${Buffer.from('sandbox-key:').toString('base64')}`)
  assert.equal(result.redirectUrl, 'https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token')
})

test('queries the correct production transaction status endpoint', async () => {
  let requestUrl = ''
  const result = await getMidtransTransactionStatus({
    serverKey: 'production-key',
    isProduction: true,
    orderId: 'SO-2025/1',
    fetchImpl: async (url) => {
      requestUrl = url
      return mockResponse({ order_id: 'SO-2025/1', transaction_status: 'settlement' })
    },
  })
  assert.equal(requestUrl, 'https://api.midtrans.com/v2/SO-2025%2F1/status')
  assert.equal(result.transaction_status, 'settlement')
})

test('checks Midtrans notification signatures and rejects tampering', () => {
  const notification = { order_id: 'SO-123', status_code: '200', gross_amount: '25000.00' }
  notification.signature_key = crypto.createHash('sha512')
    .update(`${notification.order_id}${notification.status_code}${notification.gross_amount}server-key`)
    .digest('hex')

  assert.equal(verifyMidtransSignature(notification, 'server-key'), true)
  assert.equal(verifyMidtransSignature({ ...notification, gross_amount: '1.00' }, 'server-key'), false)
})

test('classifies only settled or accepted captures as paid', () => {
  assert.equal(classifyMidtransStatus('settlement', 'accept'), 'paid')
  assert.equal(classifyMidtransStatus('capture', 'challenge'), 'unknown')
  assert.equal(classifyMidtransStatus('pending', 'accept'), 'pending')
  assert.equal(classifyMidtransStatus('expire', 'accept'), 'failed')
})

test('parses Midtrans amounts exactly without floating-point comparison', () => {
  assert.equal(parseMidtransAmountToCents('25000.00'), 2_500_000n)
  assert.equal(parseMidtransAmountToCents('1.5'), 150n)
  assert.equal(parseMidtransAmountToCents('1.001'), null)
})
