import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, LogOut, Minus, Plus, Search, ShoppingBag, Store, Truck, UserRound, X } from 'lucide-react'
import { API_URL } from './api-url'
import './Storefront.css'

const formatIDR = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0)
const initialCheckout = { customerName: '', customerEmail: '', customerPhone: '', fulfillmentMethod: 'pickup', deliveryAddress: '', destinationPostalCode: '', shippingOption: null, notes: '', paymentMethod: 'midtrans', couponCode: '', loyaltyPointsRedeemed: '' }
const fulfillmentLabels = { pending: 'Menunggu diproses', processing: 'Sedang diproses', ready_for_pickup: 'Siap diambil', shipped: 'Dalam pengiriman', completed: 'Selesai', cancelled: 'Dibatalkan' }
const paymentStatusLabels = { unpaid: 'Belum dibayar', partial: 'Dibayar sebagian', paid: 'Lunas', refund_due: 'Menunggu refund', partially_refunded: 'Refund sebagian', refunded: 'Dana dikembalikan' }
const gatewayStatusLabels = { pending: 'Menunggu pembayaran Midtrans', expire: 'Pembayaran kedaluwarsa', cancel: 'Pembayaran dibatalkan', deny: 'Pembayaran ditolak', settlement: 'Pembayaran berhasil', capture: 'Pembayaran diproses' }
const trackingSteps = {
  pickup: ['pending', 'processing', 'ready_for_pickup', 'completed'],
  delivery: ['pending', 'processing', 'shipped', 'completed'],
}

async function requestTrackingOrder(token, signal) {
  const response = await fetch(`${API_URL}/storefront/orders/track`, {
    signal,
    headers: { Accept: 'application/json', 'X-Order-Tracking-Token': token },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'Pesanan tidak ditemukan.')
  return result
}

export default function Storefront() {
  const [products, setProducts] = useState([])
  const [paymentEnabled, setPaymentEnabled] = useState(false)
  const [shippingEnabled, setShippingEnabled] = useState(false)
  const [shippingOptions, setShippingOptions] = useState([])
  const [shippingQuoteLoading, setShippingQuoteLoading] = useState(false)
  const [shippingQuoteError, setShippingQuoteError] = useState('')
  const [couponQuote, setCouponQuote] = useState(null)
  const [couponQuoteLoading, setCouponQuoteLoading] = useState(false)
  const [couponQuoteError, setCouponQuoteError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Semua')
  const [selectedVariants, setSelectedVariants] = useState({})
  const [cart, setCart] = useState([])
  const [checkout, setCheckout] = useState(initialCheckout)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [customerSessionToken, setCustomerSessionToken] = useState(() => window.localStorage.getItem('ifal-store-customer-token') || '')
  const [customerAccount, setCustomerAccount] = useState(null)
  const [customerOrders, setCustomerOrders] = useState([])
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerOtp, setCustomerOtp] = useState('')
  const [customerOtpRequested, setCustomerOtpRequested] = useState(false)
  const [customerAccountOpen, setCustomerAccountOpen] = useState(false)
  const [customerAccountError, setCustomerAccountError] = useState('')
  const [customerAccountMessage, setCustomerAccountMessage] = useState('')
  const [initialTrackingToken] = useState(() => (
    new URLSearchParams(window.location.hash.slice(1)).get('track')
    || window.localStorage.getItem('ifal-store-pending-tracking')
    || ''
  ))
  const [trackingToken, setTrackingToken] = useState(initialTrackingToken)
  const [trackingOrder, setTrackingOrder] = useState(null)
  const [trackingLoading, setTrackingLoading] = useState(Boolean(initialTrackingToken))
  const [trackingError, setTrackingError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_URL}/storefront/products`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.message || 'Katalog gagal dimuat.')
        if (!Array.isArray(result)) throw new Error('Data katalog tidak valid.')
        return result
      })
      .then((result) => { setProducts(result); setLoadError('') })
      .catch((error) => {
        if (error.name !== 'AbortError') setLoadError(error.message || 'Katalog gagal dimuat.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!customerSessionToken) return
    const controller = new AbortController()
    fetch(`${API_URL}/storefront/account/orders`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${customerSessionToken}` },
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw Object.assign(new Error(result.message || 'Riwayat pesanan gagal dimuat.'), { status: response.status })
        return result
      })
      .then((result) => {
        setCustomerAccount({ email: result.email, loyaltyPoints: Number(result.loyaltyPoints || 0) })
        setCustomerEmail(result.email)
        setCustomerOrders(Array.isArray(result.orders) ? result.orders : [])
        setCustomerAccountError('')
      })
      .catch((error) => {
        if (error.name === 'AbortError') return
        if (error.status === 401) {
          window.localStorage.removeItem('ifal-store-customer-token')
          setCustomerSessionToken('')
          setCustomerAccountError('Sesi akun berakhir. Silakan masuk kembali.')
        } else {
          setCustomerAccountError(error.message || 'Riwayat pesanan gagal dimuat.')
        }
      })
    return () => controller.abort()
  }, [customerSessionToken])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_URL}/storefront/config`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.message || 'Konfigurasi checkout gagal dimuat.')
        return result
      })
      .then((result) => {
        setPaymentEnabled(Boolean(result.paymentEnabled))
        setShippingEnabled(Boolean(result.shippingEnabled))
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setPaymentEnabled(false)
          setShippingEnabled(false)
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    let controller
    const fetchOrder = (token, signal) => requestTrackingOrder(token, signal)
      .then((order) => {
        setTrackingOrder(order)
        if (window.localStorage.getItem('ifal-store-pending-tracking') === token) {
          window.localStorage.removeItem('ifal-store-pending-tracking')
          window.history.replaceState(null, '', `${window.location.pathname}?shop=1#track=${encodeURIComponent(token)}`)
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setTrackingError(error.message || 'Pesanan tidak ditemukan.')
      })
      .finally(() => { if (!signal.aborted) setTrackingLoading(false) })
    if (initialTrackingToken) {
      controller = new AbortController()
      fetchOrder(initialTrackingToken, controller.signal)
      document.getElementById('lacak-pesanan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    const handleHashChange = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('track') || ''
      if (!token) return
      setTrackingToken(token)
      setTrackingOrder(null)
      setTrackingError('')
      setTrackingLoading(true)
      controller?.abort()
      controller = new AbortController()
      fetchOrder(token, controller.signal)
      document.getElementById('lacak-pesanan')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
      controller?.abort()
    }
  }, [initialTrackingToken])

  const catalogProducts = useMemo(() => {
    const standalone = products.filter((product) => !product.parentProductId)
    const groups = new Map()
    for (const product of products) {
      if (!product.parentProductId) continue
      const current = groups.get(product.parentProductId) || {
        id: product.parentProductId,
        name: product.parentName || product.name,
        category: product.category,
        media: product.media,
        variants: [],
      }
      current.variants.push(product)
      groups.set(product.parentProductId, current)
    }
    return [...standalone, ...groups.values()]
  }, [products])
  const categories = useMemo(() => ['Semua', ...new Set(catalogProducts.map((product) => product.category).filter(Boolean))], [catalogProducts])
  const visibleProducts = useMemo(() => catalogProducts.filter((product) => (
    (category === 'Semua' || product.category === category)
    && `${product.name} ${product.category} ${(product.variants || []).map((variant) => variant.variantLabel).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [catalogProducts, query, category])
  const cartItems = useMemo(() => cart.map((entry) => {
    const product = products.find((item) => item.id === entry.productId)
    return product ? { ...product, quantity: entry.quantity } : null
  }).filter(Boolean), [cart, products])
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const unavailableItems = cartItems.filter((item) => !item.available)

  const updateQuantity = (productId, amount) => {
    setConfirmation(null)
    setCouponQuote(null)
    setCouponQuoteError('')
    setShippingOptions([])
    setShippingQuoteError('')
    setCheckout((current) => ({ ...current, shippingOption: null }))
    setCart((current) => current
      .map((item) => item.productId === productId ? { ...item, quantity: item.quantity + amount } : item)
      .filter((item) => item.quantity > 0))
  }
  const addToCart = (product) => {
    setConfirmation(null)
    setCouponQuote(null)
    setCouponQuoteError('')
    setShippingOptions([])
    setShippingQuoteError('')
    setCheckout((current) => ({ ...current, shippingOption: null }))
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id)
      if (existing) return current.map((item) => item.productId === product.id ? { ...item, quantity: Math.min(10000, item.quantity + 1) } : item)
      return [...current, { productId: product.id, quantity: 1 }]
    })
  }
  const selectedProduct = (product) => product.variants
    ? product.variants.find((variant) => variant.id === selectedVariants[product.id]) || product.variants.find((variant) => variant.available) || product.variants[0]
    : product
  const submitOrder = async (event) => {
    event.preventDefault()
    if (shippingEnabled && checkout.fulfillmentMethod === 'delivery' && !checkout.shippingOption) {
      setCheckoutError('Pilih layanan kurir terlebih dahulu.')
      return
    }
    setSaving(true)
    setCheckoutError('')
    try {
      const response = await fetch(`${API_URL}/storefront/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(customerSessionToken ? { Authorization: `Bearer ${customerSessionToken}` } : {}),
        },
        body: JSON.stringify({
          ...checkout,
          paymentMethod: paymentEnabled ? checkout.paymentMethod : 'manual',
          shippingOption: checkout.fulfillmentMethod === 'delivery' ? checkout.shippingOption : null,
          items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Pesanan gagal dibuat.')
      if (result.redirectUrl) {
        window.localStorage.setItem('ifal-store-pending-tracking', result.trackingToken)
        setCart([])
        setCheckout(initialCheckout)
        setCheckoutOpen(false)
        window.location.assign(result.redirectUrl)
        return
      }
      setConfirmation(result)
      if (customerAccount && Number.isFinite(Number(result.loyaltyPointsBalance))) {
        setCustomerAccount((current) => ({ ...current, loyaltyPoints: Number(result.loyaltyPointsBalance) }))
      }
      setCart([])
      setCheckout(initialCheckout)
      setCheckoutOpen(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (error) {
      setCheckoutError(error.message || 'Pesanan gagal dibuat. Silakan coba lagi.')
    } finally {
      setSaving(false)
    }
  }
  const quoteShipping = async () => {
    setShippingQuoteLoading(true)
    setShippingQuoteError('')
    setShippingOptions([])
    setCheckout((current) => ({ ...current, shippingOption: null }))
    try {
      const response = await fetch(`${API_URL}/storefront/shipping/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          destinationPostalCode: checkout.destinationPostalCode,
          items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Tarif pengiriman gagal dimuat.')
      if (!Array.isArray(result)) throw new Error('Data tarif pengiriman tidak valid.')
      setShippingOptions(result)
      if (!result.length) setShippingQuoteError('Tidak ada layanan kurir untuk alamat ini.')
    } catch (error) {
      setShippingQuoteError(error.message || 'Tarif pengiriman gagal dimuat.')
    } finally {
      setShippingQuoteLoading(false)
    }
  }
  const quoteCoupon = async () => {
    setCouponQuoteLoading(true)
    setCouponQuoteError('')
    setCouponQuote(null)
    try {
      const response = await fetch(`${API_URL}/storefront/coupons/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code: checkout.couponCode, subtotal }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Kupon tidak berlaku.')
      setCouponQuote(result)
    } catch (error) {
      setCouponQuoteError(error.message || 'Kupon tidak berlaku.')
    } finally {
      setCouponQuoteLoading(false)
    }
  }
  const submitTracking = async (event) => {
    event.preventDefault()
    const token = trackingToken.trim()
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setTrackingError('Kode pelacakan tidak valid.')
      setTrackingOrder(null)
      return
    }
    window.history.replaceState(null, '', `${window.location.pathname}?shop=1#track=${encodeURIComponent(token)}`)
    setTrackingLoading(true)
    setTrackingError('')
    setTrackingOrder(null)
    try {
      setTrackingOrder(await requestTrackingOrder(token))
    } catch (error) {
      setTrackingError(error.message || 'Pesanan tidak ditemukan.')
    } finally {
      setTrackingLoading(false)
    }
  }
  const requestCustomerOtp = async (event) => {
    event.preventDefault()
    setCustomerAccountError('')
    setCustomerAccountMessage('')
    try {
      const response = await fetch(`${API_URL}/storefront/account/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: customerEmail }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Kode masuk gagal dikirim.')
      setCustomerOtpRequested(true)
      setCustomerAccountMessage(result.message || 'Kode masuk telah dikirim.')
    } catch (error) {
      setCustomerAccountError(error.message || 'Kode masuk gagal dikirim.')
    }
  }
  const verifyCustomerOtp = async (event) => {
    event.preventDefault()
    setCustomerAccountError('')
    try {
      const response = await fetch(`${API_URL}/storefront/account/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: customerEmail, otp: customerOtp }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Kode masuk tidak valid.')
      window.localStorage.setItem('ifal-store-customer-token', result.token)
      setCustomerEmail(result.email)
      setCustomerOtp('')
      setCustomerSessionToken(result.token)
      setCheckout((current) => ({ ...current, customerEmail: result.email }))
      setCustomerAccountMessage('Berhasil masuk. Riwayat pesanan Anda dimuat.')
    } catch (error) {
      setCustomerAccountError(error.message || 'Kode masuk tidak valid.')
    }
  }
  const logoutCustomer = async () => {
    let logoutError = ''
    try {
      const response = await fetch(`${API_URL}/storefront/account/session`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${customerSessionToken}` },
      })
      if (!response.ok && response.status !== 401) throw new Error('Sesi akun gagal ditutup di server.')
    } catch (error) {
      logoutError = error.message || 'Sesi akun gagal ditutup di server.'
    } finally {
      window.localStorage.removeItem('ifal-store-customer-token')
      setCustomerSessionToken('')
      setCustomerAccount(null)
      setCustomerOrders([])
      setCustomerOtpRequested(false)
      setCustomerAccountMessage('')
      setCustomerAccountError('')
    }
    if (logoutError) setCustomerAccountError(logoutError)
  }
  const trackingStatus = trackingOrder?.status === 'cancelled' ? 'cancelled' : trackingOrder?.fulfillmentStatus
  const orderTrackingSteps = trackingOrder ? trackingSteps[trackingOrder.fulfillmentMethod] || [] : []
  const currentStepIndex = orderTrackingSteps.indexOf(trackingStatus)
  const trackingStatusLabel = trackingOrder?.status === 'returned'
    ? 'Diretur'
    : trackingOrder?.status === 'partially_returned'
      ? `${fulfillmentLabels[trackingStatus] || 'Status belum tersedia'} · retur sebagian`
      : fulfillmentLabels[trackingStatus] || 'Status belum tersedia'

  return (
    <div className="storefront">
      <header className="storefront-header">
        <a className="storefront-brand" href="/?shop=1" aria-label="Ifal Store - beranda toko">
          <span className="storefront-brand-mark">IS</span>
          <span><strong>Ifal Store</strong><small>Belanja kebutuhan pilihan Anda</small></span>
        </a>
        <div className="storefront-header-actions">
          <a className="storefront-admin-link" href="/">Login admin</a>
          <button type="button" className="storefront-account-link" onClick={() => { setCustomerAccountError(''); setCustomerAccountMessage(''); setCustomerAccountOpen(true) }}><UserRound size={15} />{customerAccount ? 'Akun saya' : 'Akun pelanggan'}</button>
          <a className="storefront-track-link" href="#lacak-pesanan">Lacak pesanan</a>
          <a className="storefront-cart-link" href="#keranjang"><ShoppingBag size={18} /><span>Keranjang</span><strong>{cart.reduce((sum, item) => sum + item.quantity, 0)}</strong></a>
        </div>
      </header>

      <main className="storefront-main">
        {confirmation && <section className="storefront-confirmation" role="status">
          <CheckCircle2 size={24} />
          <div>
            <strong>Pesanan berhasil dibuat: {confirmation.orderNumber}</strong>
            <p>Total {formatIDR(confirmation.totalAmount)} · Belum dibayar.</p>
            {confirmation.trackingToken
              ? <><p>Simpan tautan pelacakan ini untuk melihat perkembangan pesanan.</p><a className="storefront-confirmation-link" href={`/?shop=1#track=${encodeURIComponent(confirmation.trackingToken)}`}>Lacak status pesanan</a></>
              : <p>Hubungi admin toko dengan nomor pesanan ini untuk mengetahui perkembangannya.</p>}
          </div>
          <button type="button" aria-label="Tutup pemberitahuan" onClick={() => setConfirmation(null)}><X size={18} /></button>
        </section>}

        <section className="storefront-hero">
          <div><span className="storefront-eyebrow"><Store size={15} /> TOKO ONLINE</span><h1>Temukan produk favorit Anda.</h1><p>Pilih produk, masukkan ke keranjang, lalu pesan dengan mudah tanpa perlu membuat akun.</p></div>
          <a href="#produk" className="storefront-hero-link">Lihat katalog <ArrowLeft size={16} /></a>
        </section>

        <section className="storefront-tracking" id="lacak-pesanan">
          <div className="storefront-tracking-heading"><div><p>STATUS PESANAN</p><h2>Lacak pesanan Anda</h2><span>Buka tautan pelacakan dari konfirmasi pesanan, atau masukkan kodenya di sini.</span></div></div>
          <form className="storefront-tracking-form" onSubmit={submitTracking}>
            <label htmlFor="storefront-tracking-token">Kode pelacakan<input id="storefront-tracking-token" required maxLength="43" value={trackingToken} onChange={(event) => setTrackingToken(event.target.value)} placeholder="Tempel kode pelacakan" autoComplete="off" disabled={trackingLoading} /></label>
            <button type="submit" className="storefront-checkout-button" disabled={trackingLoading}>{trackingLoading ? 'Memeriksa…' : 'Lacak pesanan'}</button>
          </form>
          {trackingError && <p className="storefront-form-error" role="alert">{trackingError}</p>}
          {trackingLoading && <p className="storefront-tracking-note" role="status">Memuat status pesanan…</p>}
          {trackingOrder && <article className="storefront-tracking-result" aria-live="polite">
            <div className="storefront-tracking-result-heading"><div><small>No. pesanan</small><strong>{trackingOrder.orderNumber}</strong></div><div><small>Status terkini</small><strong>{trackingStatusLabel}</strong></div></div>
            {trackingOrder.status === 'cancelled'
              ? <p className="storefront-tracking-cancelled">Pesanan ini telah dibatalkan.</p>
              : <ol className="storefront-tracking-steps">{orderTrackingSteps.map((step, index) => <li key={step} className={index <= currentStepIndex ? 'complete' : ''} aria-current={step === trackingStatus ? 'step' : undefined}><span>{index + 1}</span><strong>{fulfillmentLabels[step]}</strong></li>)}</ol>}
            <div className="storefront-tracking-order-details">
              <span>{trackingOrder.fulfillmentMethod === 'delivery' ? 'Pengiriman' : 'Ambil di toko'}</span>
              <div><strong>Total {formatIDR(trackingOrder.totalAmount)}{trackingOrder.shippingFee > 0 ? ` · Ongkir ${formatIDR(trackingOrder.shippingFee)}` : ''}</strong><small>Pembayaran: {gatewayStatusLabels[trackingOrder.gatewayStatus] || paymentStatusLabels[trackingOrder.paymentStatus] || 'Belum tersedia'}{trackingOrder.balanceDue > 0 ? ` · Sisa ${formatIDR(trackingOrder.balanceDue)}` : ''}</small></div>
            </div>
            {trackingOrder.shippingProvider && <p className="storefront-tracking-note">{trackingOrder.shippingCourierName} {trackingOrder.shippingServiceName}{trackingOrder.shippingStatus ? ` · ${trackingOrder.shippingStatus}` : ''}{trackingOrder.shippingWaybillId ? ` · Resi ${trackingOrder.shippingWaybillId}` : ''}</p>}
            <ul>{trackingOrder.items.map((item, index) => <li key={`${item.productName}-${index}`}>{item.productName} · {item.quantity} unit{item.returnedQuantity ? ` · retur ${item.returnedQuantity}` : ''}</li>)}</ul>
            <small className="storefront-tracking-note">Pembaruan terakhir: {new Date(trackingOrder.updatedAt).toLocaleString('id-ID')}</small>
          </article>}
        </section>

        <div className="storefront-layout">
          <section className="storefront-catalog" id="produk">
            <div className="storefront-catalog-heading"><div><h2>Katalog produk</h2><p>{loading ? 'Memuat produk…' : `${visibleProducts.length} produk`}</p></div></div>
            <div className="storefront-filters">
              <label className="storefront-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari produk…" aria-label="Cari produk" /></label>
              <div className="storefront-categories" aria-label="Filter kategori">
                {categories.map((item) => <button key={item} type="button" className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}
              </div>
            </div>
            {loadError && <div className="storefront-message" role="alert">{loadError}<button type="button" onClick={() => window.location.reload()}>Coba lagi</button></div>}
            {loading && <p className="storefront-empty">Sedang memuat katalog…</p>}
            {!loading && !loadError && visibleProducts.length === 0 && <p className="storefront-empty">{products.length ? 'Tidak ada produk yang cocok dengan pencarian.' : 'Belum ada produk di toko.'}</p>}
            <div className="storefront-product-grid">
              {visibleProducts.map((product) => {
                const choice = selectedProduct(product)
                return <article className="storefront-product-card" key={product.id}>
                  <div className="storefront-product-image">
                    {product.media ? <img src={product.media.url} alt={product.name} loading="lazy" /> : <span><ShoppingBag size={30} /></span>}
                    {!choice.available && <span className="storefront-unavailable">Stok habis</span>}
                  </div>
                  <div className="storefront-product-info"><small>{product.category}</small><h3>{product.name}</h3>
                    {product.variants && <label className="storefront-variant-select">Pilih varian<select value={choice.id} onChange={(event) => setSelectedVariants((current) => ({ ...current, [product.id]: Number(event.target.value) }))}>{product.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.variantLabel} · stok {variant.available ? 'tersedia' : 'habis'}</option>)}</select></label>}
                    <strong>{formatIDR(choice.price)}</strong>
                    <button type="button" onClick={() => addToCart(choice)} disabled={!choice.available}><Plus size={16} />{choice.available ? 'Tambah ke keranjang' : 'Tidak tersedia'}</button>
                  </div>
                </article>
              })}
            </div>
          </section>

          <aside className="storefront-cart" id="keranjang">
            <div className="storefront-cart-heading"><h2><ShoppingBag size={19} /> Keranjang</h2><span>{cartItems.length} item</span></div>
            {!cartItems.length ? <div className="storefront-cart-empty"><ShoppingBag size={25} /><p>Keranjang Anda masih kosong.</p></div> : <>
              <div className="storefront-cart-lines">{cartItems.map((item) => <div className="storefront-cart-line" key={item.id}>
                <div className="storefront-cart-line-info"><strong>{item.name}</strong><span>{formatIDR(item.price)}</span>{!item.available && <small>Stok saat ini habis</small>}</div>
                <div className="storefront-quantity"><button type="button" aria-label={`Kurangi ${item.name}`} onClick={() => updateQuantity(item.id, -1)}><Minus size={13} /></button><span>{item.quantity}</span><button type="button" aria-label={`Tambah ${item.name}`} onClick={() => updateQuantity(item.id, 1)}><Plus size={13} /></button></div>
              </div>)}</div>
              <div className="storefront-cart-total"><span>Subtotal produk</span><strong>{formatIDR(subtotal)}</strong></div>
              <p className="storefront-shipping-note">{shippingEnabled ? 'Tarif kurir akan dihitung saat checkout.' : 'Biaya pengiriman, jika ada, akan dikonfirmasi admin.'}</p>
              {unavailableItems.length > 0 && <p className="storefront-cart-error">Hapus produk yang stoknya habis untuk melanjutkan.</p>}
              <button type="button" className="storefront-checkout-button" onClick={() => { setCheckoutError(''); setCheckoutOpen(true) }} disabled={unavailableItems.length > 0}>Lanjut checkout</button>
            </>}
          </aside>
        </div>

        <footer className="storefront-footer"><span>Ifal Store</span><span>{paymentEnabled ? 'Pembayaran online tersedia melalui Midtrans.' : 'Pembayaran dicatat manual setelah konfirmasi admin.'}</span></footer>
      </main>

      {customerAccountOpen && <div className="storefront-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCustomerAccountOpen(false)}>
        <section className="storefront-checkout-modal storefront-account-modal" role="dialog" aria-modal="true" aria-labelledby="storefront-account-title">
          <div className="storefront-modal-heading"><div><p>AKUN PELANGGAN</p><h2 id="storefront-account-title">{customerAccount ? 'Riwayat pesanan' : 'Masuk dengan email'}</h2></div><button type="button" aria-label="Tutup akun pelanggan" onClick={() => setCustomerAccountOpen(false)}><X size={20} /></button></div>
          {customerAccount
            ? <div className="storefront-account-content">
              <div className="storefront-account-identity"><span>{customerAccount.email}</span><button type="button" onClick={logoutCustomer}><LogOut size={14} /> Keluar</button></div>
              <p className="storefront-account-points">Saldo loyalti: <strong>{customerAccount.loyaltyPoints || 0} poin</strong> · 100 poin = Rp1.000</p>
              {customerAccountError && <p className="storefront-form-error" role="alert">{customerAccountError}</p>}
              {customerAccountMessage && <p className="storefront-account-message" role="status">{customerAccountMessage}</p>}
              {customerOrders.length === 0
                ? <p className="storefront-empty">Belum ada pesanan online dengan email ini.</p>
                : <div className="storefront-account-orders">{customerOrders.map((order) => <article key={order.orderNumber}>
                  <div><strong>{order.orderNumber}</strong><span>{new Date(order.createdAt).toLocaleDateString('id-ID')} · {formatIDR(order.totalAmount)}</span></div>
                  <small>{fulfillmentLabels[order.fulfillmentStatus] || order.status} · {gatewayStatusLabels[order.gatewayStatus] || paymentStatusLabels[order.paymentStatus]}</small>
                  <ul>{order.items.map((item, index) => <li key={`${order.orderNumber}-${index}`}>{item.name} · {item.quantity} unit</li>)}</ul>
                </article>)}</div>}
            </div>
            : customerSessionToken
              ? <div className="storefront-account-content"><p>{customerAccountError || 'Memuat riwayat pesanan…'}</p><button type="button" className="storefront-cancel-button" onClick={() => window.location.reload()}>Muat ulang akun</button></div>
              : <form onSubmit={customerOtpRequested ? verifyCustomerOtp : requestCustomerOtp}>
              <p className="storefront-account-hint">Masuk tanpa password menggunakan kode OTP. Setelah masuk, pesanan online yang memakai email ini akan tampil di riwayat.</p>
              <label>Email<input required type="email" maxLength="255" autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} disabled={customerOtpRequested} /></label>
              {customerOtpRequested && <label>Kode OTP<input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="one-time-code" value={customerOtp} onChange={(event) => setCustomerOtp(event.target.value)} /></label>}
              {customerAccountError && <p className="storefront-form-error" role="alert">{customerAccountError}</p>}
              {customerAccountMessage && <p className="storefront-account-message" role="status">{customerAccountMessage}</p>}
              <div className="storefront-account-actions">
                <button type="submit" className="storefront-checkout-button">{customerOtpRequested ? 'Verifikasi dan masuk' : 'Kirim kode OTP'}</button>
                {customerOtpRequested && <button type="button" className="storefront-cancel-button" onClick={requestCustomerOtp}>Kirim ulang kode</button>}
              </div>
              </form>}
        </section>
      </div>}
      {checkoutOpen && <div className="storefront-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setCheckoutOpen(false)}>
        <section className="storefront-checkout-modal" role="dialog" aria-modal="true" aria-labelledby="storefront-checkout-title">
          <div className="storefront-modal-heading"><div><p>CHECKOUT</p><h2 id="storefront-checkout-title">Data pemesan</h2></div><button type="button" aria-label="Tutup checkout" onClick={() => setCheckoutOpen(false)} disabled={saving}><X size={20} /></button></div>
          <form onSubmit={submitOrder}>
            <label>Nama lengkap<input required maxLength="120" autoComplete="name" value={checkout.customerName} onChange={(event) => setCheckout({ ...checkout, customerName: event.target.value })} /></label>
            <div className="storefront-form-grid">
              <label>Nomor telepon<input required type="tel" maxLength="40" autoComplete="tel" value={checkout.customerPhone} onChange={(event) => setCheckout({ ...checkout, customerPhone: event.target.value })} placeholder="+62…" /></label>
              <label>{checkout.paymentMethod === 'midtrans' && paymentEnabled ? 'Email untuk pembayaran' : 'Email (opsional)'}<input required={checkout.paymentMethod === 'midtrans' && paymentEnabled} type="email" maxLength="255" autoComplete="email" value={checkout.customerEmail} onChange={(event) => setCheckout({ ...checkout, customerEmail: event.target.value })} /></label>
            </div>
            <div className="storefront-discount-fields">
              <label>Kode kupon<input maxLength="40" value={checkout.couponCode} onChange={(event) => { setCheckout({ ...checkout, couponCode: event.target.value.toUpperCase() }); setCouponQuote(null); setCouponQuoteError('') }} placeholder="Masukkan kode kupon" /></label>
              <button type="button" className="storefront-cancel-button" onClick={quoteCoupon} disabled={couponQuoteLoading || !checkout.couponCode.trim() || !cart.length}>{couponQuoteLoading ? 'Memeriksa kupon…' : 'Terapkan kupon'}</button>
              {couponQuote && <p className="storefront-account-message">Kupon {couponQuote.code} mengurangi {formatIDR(couponQuote.discountAmount)}.</p>}
              {couponQuoteError && <p className="storefront-form-error" role="alert">{couponQuoteError}</p>}
              <label>Tukar poin loyalti<input type="number" min="0" step="100" max={customerAccount?.loyaltyPoints || 0} value={checkout.loyaltyPointsRedeemed} onChange={(event) => setCheckout({ ...checkout, loyaltyPointsRedeemed: event.target.value })} disabled={!customerSessionToken} placeholder={customerSessionToken ? 'Kelipatan 100 poin' : 'Masuk akun terlebih dahulu'} /><small className="field-hint">Saldo {customerAccount?.loyaltyPoints || 0} poin. 100 poin = Rp1.000.</small></label>
            </div>
            <fieldset className="storefront-fulfillment"><legend>Cara menerima pesanan</legend><label><input type="radio" name="fulfillment" value="pickup" checked={checkout.fulfillmentMethod === 'pickup'} onChange={() => { setCheckout({ ...checkout, fulfillmentMethod: 'pickup', deliveryAddress: '', destinationPostalCode: '', shippingOption: null }); setShippingOptions([]); setShippingQuoteError('') }} /> Ambil di toko</label><label><input type="radio" name="fulfillment" value="delivery" checked={checkout.fulfillmentMethod === 'delivery'} onChange={() => setCheckout({ ...checkout, fulfillmentMethod: 'delivery' })} /> Pengiriman</label></fieldset>
            {checkout.fulfillmentMethod === 'delivery'
              ? <>
                <label>Alamat pengiriman<textarea required maxLength="1000" rows="3" autoComplete="street-address" value={checkout.deliveryAddress} onChange={(event) => setCheckout({ ...checkout, deliveryAddress: event.target.value })} /></label>
                {shippingEnabled && <>
                  <label>Kode pos tujuan<input required inputMode="numeric" pattern="[0-9]{5}" maxLength="5" value={checkout.destinationPostalCode} onChange={(event) => { setCheckout({ ...checkout, destinationPostalCode: event.target.value, shippingOption: null }); setShippingOptions([]); setShippingQuoteError('') }} placeholder="Contoh: 17610" /></label>
                  <button type="button" className="storefront-cancel-button" onClick={quoteShipping} disabled={shippingQuoteLoading || saving || !/^\d{5}$/.test(checkout.destinationPostalCode) || !cart.length}>{shippingQuoteLoading ? 'Menghitung ongkir…' : 'Hitung tarif kurir'}</button>
                  {shippingQuoteError && <p className="storefront-form-error" role="alert">{shippingQuoteError}</p>}
                  {shippingOptions.length > 0 && <fieldset className="storefront-fulfillment"><legend>Pilih layanan kurir</legend>{shippingOptions.map((option) => <label key={`${option.courierCode}-${option.serviceCode}`}><input type="radio" name="shipping-option" checked={checkout.shippingOption?.courierCode === option.courierCode && checkout.shippingOption?.serviceCode === option.serviceCode} onChange={() => setCheckout((current) => ({ ...current, shippingOption: option }))} /><span>{option.courierName} {option.serviceName} · {formatIDR(option.price)}{option.duration ? ` · ${option.duration}` : ''}</span></label>)}</fieldset>}
                </>}
              </>
              : <p className="storefront-checkout-hint"><Store size={15} /> Lokasi dan waktu pengambilan perlu dikonfirmasi dengan toko.</p>}
            {paymentEnabled && <fieldset className="storefront-fulfillment"><legend>Metode pembayaran</legend><label><input type="radio" name="payment" value="midtrans" checked={checkout.paymentMethod === 'midtrans'} onChange={() => setCheckout({ ...checkout, paymentMethod: 'midtrans' })} /> Bayar online dengan Midtrans</label><label><input type="radio" name="payment" value="manual" checked={checkout.paymentMethod === 'manual'} onChange={() => setCheckout({ ...checkout, paymentMethod: 'manual' })} /> Konfirmasi pembayaran manual</label></fieldset>}
            <label>Catatan (opsional)<textarea maxLength="500" rows="2" value={checkout.notes} onChange={(event) => setCheckout({ ...checkout, notes: event.target.value })} /></label>
            <div className="storefront-payment-notice"><Truck size={16} /><span>{checkout.paymentMethod === 'midtrans' && paymentEnabled ? 'Anda akan diarahkan ke halaman pembayaran Midtrans setelah pesanan disimpan.' : 'Pesanan dibuat belum lunas. Silakan hubungi admin toko untuk konfirmasi pembayaran.'}{checkout.fulfillmentMethod === 'delivery' && !shippingEnabled ? ' Ongkir akan dikonfirmasi admin.' : ''}</span></div>
            <div className="storefront-modal-total"><span>Total pesanan</span><strong>{formatIDR(Math.max(0, subtotal - (couponQuote?.discountAmount || 0) - (Number(checkout.loyaltyPointsRedeemed) || 0) * 10) + (checkout.shippingOption?.price || 0))}</strong></div>
            {checkoutError && <p className="storefront-form-error" role="alert">{checkoutError}</p>}
            <div className="storefront-modal-actions"><button type="button" className="storefront-cancel-button" onClick={() => setCheckoutOpen(false)} disabled={saving}>Kembali</button><button type="submit" className="storefront-checkout-button" disabled={saving || !cartItems.length || (shippingEnabled && checkout.fulfillmentMethod === 'delivery' && !checkout.shippingOption)}>{saving ? 'Mengirim pesanan…' : checkout.paymentMethod === 'midtrans' && paymentEnabled ? 'Lanjut ke pembayaran' : 'Buat pesanan'}</button></div>
          </form>
        </section>
      </div>}
    </div>
  )
}
