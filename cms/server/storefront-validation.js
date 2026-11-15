export function validateStorefrontOrder(body) {
  const customerName = String(body?.customerName || '').trim()
  const customerEmail = String(body?.customerEmail || '').trim().toLowerCase()
  const customerPhone = String(body?.customerPhone || '').trim()
  const fulfillmentMethod = String(body?.fulfillmentMethod || '')
  const deliveryAddress = String(body?.deliveryAddress || '').trim()
  const destinationPostalCode = String(body?.destinationPostalCode || '').trim()
  const notes = String(body?.notes || '').trim()
  const shippingOption = body?.shippingOption && typeof body.shippingOption === 'object'
    ? {
      courierCode: String(body.shippingOption.courierCode || '').trim(),
      serviceCode: String(body.shippingOption.serviceCode || '').trim(),
      price: Number(body.shippingOption.price),
    }
    : null
  const items = Array.isArray(body?.items) ? body.items.map((item) => ({
    productId: Number(item?.productId),
    quantity: Number(item?.quantity),
  })) : []

  if (!customerName || customerName.length > 120) return { error: 'Nama wajib diisi dan maksimal 120 karakter.' }
  if (customerEmail && (customerEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) return { error: 'Email tidak valid.' }
  if (customerPhone.length < 6 || customerPhone.length > 40 || !/^[+\d()\s-]+$/.test(customerPhone) || customerPhone.replace(/\D/g, '').length < 6) return { error: 'Nomor telepon harus berisi minimal 6 angka.' }
  if (!['pickup', 'delivery'].includes(fulfillmentMethod)) return { error: 'Pilih pengambilan di toko atau pengiriman.' }
  if (fulfillmentMethod === 'delivery' && !deliveryAddress) return { error: 'Alamat pengiriman wajib diisi.' }
  if (destinationPostalCode && !/^\d{5}$/.test(destinationPostalCode)) return { error: 'Kode pos harus terdiri dari 5 angka.' }
  if (shippingOption && (!/^[a-z0-9_-]{1,64}$/i.test(shippingOption.courierCode)
    || !/^[a-z0-9_-]{1,64}$/i.test(shippingOption.serviceCode)
    || !Number.isSafeInteger(shippingOption.price) || shippingOption.price < 0)) return { error: 'Pilihan layanan pengiriman tidak valid.' }
  if (deliveryAddress.length > 1000 || notes.length > 500) return { error: 'Alamat maksimal 1.000 karakter dan catatan maksimal 500 karakter.' }
  if (items.length < 1 || items.length > 50) return { error: 'Pesanan harus memiliki 1 sampai 50 produk.' }
  if (items.some((item) => !Number.isSafeInteger(item.productId) || item.productId < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000)) return { error: 'Produk atau jumlah tidak valid.' }
  if (new Set(items.map((item) => item.productId)).size !== items.length) return { error: 'Produk yang sama tidak boleh ditambahkan lebih dari sekali.' }

  return {
    data: {
      customerName,
      customerEmail: customerEmail || null,
      customerPhone,
      fulfillmentMethod,
      deliveryAddress: fulfillmentMethod === 'delivery' ? deliveryAddress : null,
      destinationPostalCode: fulfillmentMethod === 'delivery' ? destinationPostalCode || null : null,
      shippingOption: fulfillmentMethod === 'delivery' ? shippingOption : null,
      notes: notes || null,
      items,
    },
  }
}
