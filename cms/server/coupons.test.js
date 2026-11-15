import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCouponDiscount, normalizeCouponInput } from './coupons.js'

test('normalizes coupon codes and rejects invalid discount configurations', () => {
  const result = normalizeCouponInput({ code: 'hemat10', discountType: 'percent', discountValue: '10', minimumOrderAmount: '50000' })
  assert.equal(result.data.code, 'HEMAT10')
  assert.equal(result.data.discountValue, 10)
  assert.ok(normalizeCouponInput({ code: 'X', discountType: 'percent', discountValue: 101 }).error)
  assert.ok(normalizeCouponInput({ code: 'VALID', discountType: 'fixed', discountValue: 100, startsAt: 'bad-date' }).error)
})

test('calculates fixed and percent discounts without exceeding the cart total', () => {
  const subtotalCents = 1250000n
  assert.equal(calculateCouponDiscount(subtotalCents, {
    discount_type: 'percent',
    discount_value: '10',
    minimum_order_amount: '0',
  }).discountCents, 125000n)
  assert.equal(calculateCouponDiscount(subtotalCents, {
    discount_type: 'fixed',
    discount_value: '20000',
    minimum_order_amount: '0',
  }).discountCents, 2000000n > subtotalCents ? subtotalCents : 2000000n)
  assert.ok(calculateCouponDiscount(subtotalCents, {
    discount_type: 'fixed',
    discount_value: '1',
    minimum_order_amount: '20000',
  }).error)
})
