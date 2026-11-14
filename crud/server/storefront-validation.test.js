import assert from 'node:assert/strict'
import test from 'node:test'
import { validateStorefrontOrder } from './storefront-validation.js'

const validOrder = {
  customerName: '  Siti Aminah ',
  customerEmail: 'SITI@example.com',
  customerPhone: '+62 812-3456-7890',
  fulfillmentMethod: 'delivery',
  deliveryAddress: 'Jalan Melati 10',
  notes: '  Tolong hubungi sebelum dikirim. ',
  items: [{ productId: '4', quantity: '2' }],
}

test('normalizes guest checkout details and delivery address', () => {
  assert.deepEqual(validateStorefrontOrder(validOrder), {
    data: {
      customerName: 'Siti Aminah',
      customerEmail: 'siti@example.com',
      customerPhone: '+62 812-3456-7890',
      fulfillmentMethod: 'delivery',
      deliveryAddress: 'Jalan Melati 10',
      notes: 'Tolong hubungi sebelum dikirim.',
      items: [{ productId: 4, quantity: 2 }],
    },
  })
})

test('requires a valid destination for delivery orders', () => {
  assert.deepEqual(
    validateStorefrontOrder({ ...validOrder, deliveryAddress: ' ' }),
    { error: 'Alamat pengiriman wajib diisi.' },
  )
})

test('rejects duplicate products and malformed contact details', () => {
  assert.deepEqual(
    validateStorefrontOrder({ ...validOrder, items: [{ productId: 4, quantity: 1 }, { productId: 4, quantity: 2 }] }),
    { error: 'Produk yang sama tidak boleh ditambahkan lebih dari sekali.' },
  )
  assert.deepEqual(
    validateStorefrontOrder({ ...validOrder, customerPhone: 'nomor tidak valid' }),
    { error: 'Nomor telepon harus berisi minimal 6 angka.' },
  )
})

test('clears delivery address for pickup orders', () => {
  const { data } = validateStorefrontOrder({ ...validOrder, fulfillmentMethod: 'pickup', deliveryAddress: '' })
  assert.equal(data.deliveryAddress, null)
})
