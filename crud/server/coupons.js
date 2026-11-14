export function normalizeCouponInput(input) {
  const code = String(input?.code || '').trim().toUpperCase()
  const discountType = String(input?.discountType || '')
  const discountValue = Number(input?.discountValue)
  const minimumOrderAmount = Number(input?.minimumOrderAmount || 0)
  const usageLimit = input?.usageLimit === '' || input?.usageLimit === null || input?.usageLimit === undefined
    ? null
    : Number(input.usageLimit)
  const parseDate = (value) => {
    if (value === '' || value === null || value === undefined) return null
    if (typeof value !== 'string' || value.length > 40) return undefined
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  const startsAt = parseDate(input?.startsAt)
  const expiresAt = parseDate(input?.expiresAt)
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return { error: 'Kode kupon harus 3–40 karakter: huruf, angka, garis, atau garis bawah.' }
  if (!['percent', 'fixed'].includes(discountType)) return { error: 'Jenis diskon kupon tidak valid.' }
  if (!Number.isFinite(discountValue) || discountValue <= 0 || (discountType === 'percent' && discountValue > 100)
    || Math.round(discountValue * 100) !== discountValue * 100) return { error: 'Nilai diskon tidak valid.' }
  if (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0
    || Math.round(minimumOrderAmount * 100) !== minimumOrderAmount * 100) return { error: 'Minimum belanja tidak valid.' }
  if (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1)) return { error: 'Batas penggunaan harus bilangan bulat positif.' }
  if (startsAt === undefined || expiresAt === undefined) return { error: 'Tanggal kupon tidak valid.' }
  if (startsAt && expiresAt && Date.parse(startsAt) >= Date.parse(expiresAt)) return { error: 'Tanggal akhir harus setelah tanggal mulai.' }
  return {
    data: {
      code,
      discountType,
      discountValue,
      minimumOrderAmount,
      usageLimit,
      startsAt,
      expiresAt,
      isActive: input?.isActive !== false,
    },
  }
}

export function calculateCouponDiscount(subtotalCents, coupon) {
  const minimumCents = BigInt(Math.round(Number(coupon.minimum_order_amount) * 100))
  if (subtotalCents < minimumCents) return { error: 'Nilai keranjang belum mencapai minimum belanja kupon.' }
  const valueCents = BigInt(Math.round(Number(coupon.discount_value) * 100))
  const discountCents = coupon.discount_type === 'percent'
    ? (subtotalCents * valueCents + 5000n) / 10000n
    : valueCents
  return { discountCents: discountCents > subtotalCents ? subtotalCents : discountCents }
}
