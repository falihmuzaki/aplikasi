export class BiteshipError extends Error {
  constructor(message, code = 'biteship_error') {
    super(message)
    this.name = 'BiteshipError'
    this.code = code
  }
}

const API_BASE_URL = 'https://api.biteship.com'

async function requestBiteship(path, { apiKey, method = 'GET', body, fetchImpl = fetch }) {
  if (!apiKey) throw new BiteshipError('Biteship API key is not configured.', 'biteship_not_configured')
  let response
  try {
    response = await fetchImpl(`${API_BASE_URL}${path}`, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
        Authorization: apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    throw new BiteshipError(`Biteship request failed: ${error.message}`, 'biteship_network_error')
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new BiteshipError('Biteship returned an invalid response.', 'biteship_invalid_response')
  }
  if (!response.ok || result?.success === false) {
    throw new BiteshipError('Biteship rejected the shipping request.', 'biteship_http_error')
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new BiteshipError('Biteship returned an invalid response.', 'biteship_invalid_response')
  }
  return result
}

export async function getBiteshipRates({
  apiKey,
  originPostalCode,
  destinationPostalCode,
  couriers,
  items,
  fetchImpl = fetch,
}) {
  const result = await requestBiteship('/v1/rates/couriers', {
    apiKey,
    method: 'POST',
    body: {
      origin_postal_code: Number(originPostalCode),
      destination_postal_code: Number(destinationPostalCode),
      couriers,
      items,
    },
    fetchImpl,
  })
  if (!Array.isArray(result.pricing)) throw new BiteshipError('Biteship returned no courier rates.', 'biteship_invalid_response')
  return result.pricing.flatMap((rate) => {
    const price = Number(rate?.price)
    const courierCode = String(rate?.courier_code || rate?.company || '')
    const serviceCode = String(rate?.courier_service_code || rate?.type || '')
    if (!courierCode || !serviceCode || !Number.isSafeInteger(price) || price < 0) return []
    return [{
      courierCode,
      courierName: String(rate.courier_name || rate.courier_code || rate.company),
      serviceCode,
      serviceName: String(rate.courier_service_name || rate.type || serviceCode),
      price,
      duration: String(rate.duration || ''),
    }]
  })
}

export async function createBiteshipOrder({ apiKey, payload, fetchImpl = fetch }) {
  const result = await requestBiteship('/v1/orders', { apiKey, method: 'POST', body: payload, fetchImpl })
  if (typeof result.id !== 'string' || !result.id) throw new BiteshipError('Biteship did not return an order ID.', 'biteship_invalid_response')
  return {
    orderId: result.id,
    trackingId: typeof result.courier?.tracking_id === 'string' ? result.courier.tracking_id : null,
    waybillId: typeof result.courier?.waybill_id === 'string' ? result.courier.waybill_id : null,
    status: typeof result.status === 'string' ? result.status : 'confirmed',
  }
}

export async function getBiteshipTracking({ apiKey, trackingId, fetchImpl = fetch }) {
  if (!trackingId || typeof trackingId !== 'string') throw new BiteshipError('Biteship tracking ID is invalid.', 'biteship_invalid_tracking_id')
  const result = await requestBiteship(`/v1/trackings/${encodeURIComponent(trackingId)}`, { apiKey, fetchImpl })
  if (typeof result.id !== 'string' || !Array.isArray(result.history)) {
    throw new BiteshipError('Biteship returned an invalid tracking response.', 'biteship_invalid_response')
  }
  return {
    status: typeof result.status === 'string' ? result.status : null,
    waybillId: typeof result.waybill_id === 'string' ? result.waybill_id : null,
    history: result.history,
  }
}
