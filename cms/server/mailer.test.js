import test from 'node:test'
import assert from 'node:assert/strict'
import { createCustomerStorefrontMessage } from './mailer.js'

test('escapes customer content in HTML transaction emails', () => {
  const message = createCustomerStorefrontMessage({
    subject: 'Pesanan dibuat',
    title: '<script>alert(1)</script>',
    lines: ['Nama: A & B'],
    trackingUrl: 'https://store.example/?shop=1#track=abc',
  })

  assert.equal(message.subject, 'Pesanan dibuat')
  assert.match(message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(message.html, /Nama: A &amp; B/)
  assert.doesNotMatch(message.html, /<script>/)
  assert.match(message.html, /href="https:\/\/store\.example\/\?shop=1#track=abc"/)
})

test('omits tracking links with unsupported schemes', () => {
  const message = createCustomerStorefrontMessage({
    subject: 'Pembaruan pesanan',
    title: 'Status pesanan berubah',
    lines: ['Pesanan sedang diproses.'],
    trackingUrl: 'javascript:alert(1)',
  })

  assert.doesNotMatch(message.text, /javascript:/)
  assert.doesNotMatch(message.html, /href=/)
})
