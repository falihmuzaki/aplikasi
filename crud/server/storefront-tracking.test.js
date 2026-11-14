import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAdvanceStorefrontFulfillmentStatus,
  createStorefrontTrackingToken,
  hashStorefrontTrackingToken,
  isStorefrontTrackingToken,
} from './storefront-tracking.js'

test('creates an unguessable URL-safe token and stores only its hash', () => {
  const token = createStorefrontTrackingToken()
  assert.equal(isStorefrontTrackingToken(token), true)
  assert.equal(token.length, 43)
  assert.equal(hashStorefrontTrackingToken(token), hashStorefrontTrackingToken(token))
  assert.notEqual(hashStorefrontTrackingToken(token), token)
  assert.equal(isStorefrontTrackingToken('not-a-tracking-token'), false)
})

test('allows only the next fulfillment step for the selected method', () => {
  assert.equal(canAdvanceStorefrontFulfillmentStatus('pending', 'pickup', 'processing'), true)
  assert.equal(canAdvanceStorefrontFulfillmentStatus('processing', 'pickup', 'ready_for_pickup'), true)
  assert.equal(canAdvanceStorefrontFulfillmentStatus('processing', 'delivery', 'shipped'), true)
  assert.equal(canAdvanceStorefrontFulfillmentStatus('shipped', 'delivery', 'completed'), true)
  assert.equal(canAdvanceStorefrontFulfillmentStatus('pending', 'delivery', 'shipped'), false)
  assert.equal(canAdvanceStorefrontFulfillmentStatus('ready_for_pickup', 'delivery', 'completed'), false)
  assert.equal(canAdvanceStorefrontFulfillmentStatus('completed', 'pickup', 'processing'), false)
})
