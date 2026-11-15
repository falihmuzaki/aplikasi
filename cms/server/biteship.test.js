import test from 'node:test'
import assert from 'node:assert/strict'
import { createBiteshipOrder, getBiteshipRates, getBiteshipTracking } from './biteship.js'

test('requests rates using documented postal-code and parcel fields', async () => {
  let request
  const rates = await getBiteshipRates({
    apiKey: 'biteship_test_key',
    originPostalCode: '17610',
    destinationPostalCode: '40111',
    couriers: 'jne,sicepat',
    items: [{ name: 'Produk', value: 25000, weight: 500, quantity: 2 }],
    fetchImpl: async (url, options) => {
      request = { url, options }
      return Response.json({
        success: true,
        pricing: [{
          courier_code: 'jne',
          courier_name: 'JNE',
          courier_service_code: 'reg',
          courier_service_name: 'Reguler',
          duration: '2 - 3 days',
          price: 12000,
        }],
      })
    },
  })

  assert.equal(request.url, 'https://api.biteship.com/v1/rates/couriers')
  assert.equal(request.options.headers.Authorization, 'biteship_test_key')
  assert.deepEqual(JSON.parse(request.options.body), {
    origin_postal_code: 17610,
    destination_postal_code: 40111,
    couriers: 'jne,sicepat',
    items: [{ name: 'Produk', value: 25000, weight: 500, quantity: 2 }],
  })
  assert.deepEqual(rates, [{
    courierCode: 'jne',
    courierName: 'JNE',
    serviceCode: 'reg',
    serviceName: 'Reguler',
    price: 12000,
    duration: '2 - 3 days',
  }])
})

test('creates an order and reads tracking using Biteship IDs', async () => {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(url)
    if (url.endsWith('/v1/orders')) {
      return Response.json({ success: true, id: 'order-1', courier: { tracking_id: 'tracking-1', waybill_id: 'waybill-1' }, status: 'confirmed' })
    }
    return Response.json({ success: true, id: 'tracking-1', waybill_id: 'waybill-1', status: 'picked', history: [] })
  }

  const order = await createBiteshipOrder({ apiKey: 'biteship_test_key', payload: {}, fetchImpl })
  const tracking = await getBiteshipTracking({ apiKey: 'biteship_test_key', trackingId: order.trackingId, fetchImpl })

  assert.deepEqual(order, { orderId: 'order-1', trackingId: 'tracking-1', waybillId: 'waybill-1', status: 'confirmed' })
  assert.deepEqual(tracking, { status: 'picked', waybillId: 'waybill-1', history: [] })
  assert.deepEqual(urls, [
    'https://api.biteship.com/v1/orders',
    'https://api.biteship.com/v1/trackings/tracking-1',
  ])
})
