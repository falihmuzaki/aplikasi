import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Minus, Plus, Search, ShoppingBag, Store, Truck, X } from 'lucide-react'
import { API_URL } from './api-url'
import './Storefront.css'

const formatIDR = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0)
const initialCheckout = { customerName: '', customerEmail: '', customerPhone: '', fulfillmentMethod: 'pickup', deliveryAddress: '', notes: '' }

export default function Storefront() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Semua')
  const [cart, setCart] = useState([])
  const [checkout, setCheckout] = useState(initialCheckout)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [confirmation, setConfirmation] = useState(null)

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

  const categories = useMemo(() => ['Semua', ...new Set(products.map((product) => product.category).filter(Boolean))], [products])
  const visibleProducts = useMemo(() => products.filter((product) => (
    (category === 'Semua' || product.category === category)
    && `${product.name} ${product.category}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [products, query, category])
  const cartItems = useMemo(() => cart.map((entry) => {
    const product = products.find((item) => item.id === entry.productId)
    return product ? { ...product, quantity: entry.quantity } : null
  }).filter(Boolean), [cart, products])
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const unavailableItems = cartItems.filter((item) => !item.available)

  const updateQuantity = (productId, amount) => {
    setConfirmation(null)
    setCart((current) => current
      .map((item) => item.productId === productId ? { ...item, quantity: item.quantity + amount } : item)
      .filter((item) => item.quantity > 0))
  }
  const addToCart = (product) => {
    setConfirmation(null)
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id)
      if (existing) return current.map((item) => item.productId === product.id ? { ...item, quantity: Math.min(10000, item.quantity + 1) } : item)
      return [...current, { productId: product.id, quantity: 1 }]
    })
  }
  const submitOrder = async (event) => {
    event.preventDefault()
    setSaving(true)
    setCheckoutError('')
    try {
      const response = await fetch(`${API_URL}/storefront/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...checkout,
          items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Pesanan gagal dibuat.')
      setConfirmation(result)
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

  return (
    <div className="storefront">
      <header className="storefront-header">
        <a className="storefront-brand" href="/?shop=1" aria-label="Ifal Store - beranda toko">
          <span className="storefront-brand-mark">IS</span>
          <span><strong>Ifal Store</strong><small>Belanja kebutuhan pilihan Anda</small></span>
        </a>
        <div className="storefront-header-actions">
          <a className="storefront-admin-link" href="/">Login admin</a>
          <a className="storefront-cart-link" href="#keranjang"><ShoppingBag size={18} /><span>Keranjang</span><strong>{cart.reduce((sum, item) => sum + item.quantity, 0)}</strong></a>
        </div>
      </header>

      <main className="storefront-main">
        {confirmation && <section className="storefront-confirmation" role="status">
          <CheckCircle2 size={24} />
          <div><strong>Pesanan berhasil dibuat: {confirmation.orderNumber}</strong><p>Total {formatIDR(confirmation.totalAmount)} · Belum dibayar. Simpan nomor pesanan ini untuk koordinasi pembayaran dan pengambilan/pengiriman dengan toko.</p></div>
          <button type="button" aria-label="Tutup pemberitahuan" onClick={() => setConfirmation(null)}><X size={18} /></button>
        </section>}

        <section className="storefront-hero">
          <div><span className="storefront-eyebrow"><Store size={15} /> TOKO ONLINE</span><h1>Temukan produk favorit Anda.</h1><p>Pilih produk, masukkan ke keranjang, lalu pesan dengan mudah tanpa perlu membuat akun.</p></div>
          <a href="#produk" className="storefront-hero-link">Lihat katalog <ArrowLeft size={16} /></a>
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
              {visibleProducts.map((product) => <article className="storefront-product-card" key={product.id}>
                <div className="storefront-product-image">
                  {product.media ? <img src={product.media.url} alt={product.name} loading="lazy" /> : <span><ShoppingBag size={30} /></span>}
                  {!product.available && <span className="storefront-unavailable">Stok habis</span>}
                </div>
                <div className="storefront-product-info"><small>{product.category}</small><h3>{product.name}</h3><strong>{formatIDR(product.price)}</strong>
                  <button type="button" onClick={() => addToCart(product)} disabled={!product.available}><Plus size={16} />{product.available ? 'Tambah ke keranjang' : 'Tidak tersedia'}</button>
                </div>
              </article>)}
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
              <p className="storefront-shipping-note">Biaya pengiriman, jika ada, akan dikonfirmasi admin dan belum termasuk subtotal.</p>
              {unavailableItems.length > 0 && <p className="storefront-cart-error">Hapus produk yang stoknya habis untuk melanjutkan.</p>}
              <button type="button" className="storefront-checkout-button" onClick={() => { setCheckoutError(''); setCheckoutOpen(true) }} disabled={unavailableItems.length > 0}>Lanjut checkout</button>
            </>}
          </aside>
        </div>

        <footer className="storefront-footer"><span>Ifal Store</span><span>Pembayaran dicatat manual setelah konfirmasi admin.</span></footer>
      </main>

      {checkoutOpen && <div className="storefront-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && setCheckoutOpen(false)}>
        <section className="storefront-checkout-modal" role="dialog" aria-modal="true" aria-labelledby="storefront-checkout-title">
          <div className="storefront-modal-heading"><div><p>CHECKOUT</p><h2 id="storefront-checkout-title">Data pemesan</h2></div><button type="button" aria-label="Tutup checkout" onClick={() => setCheckoutOpen(false)} disabled={saving}><X size={20} /></button></div>
          <form onSubmit={submitOrder}>
            <label>Nama lengkap<input required maxLength="120" autoComplete="name" value={checkout.customerName} onChange={(event) => setCheckout({ ...checkout, customerName: event.target.value })} /></label>
            <div className="storefront-form-grid"><label>Nomor telepon<input required type="tel" maxLength="40" autoComplete="tel" value={checkout.customerPhone} onChange={(event) => setCheckout({ ...checkout, customerPhone: event.target.value })} placeholder="+62…" /></label><label>Email (opsional)<input type="email" maxLength="255" autoComplete="email" value={checkout.customerEmail} onChange={(event) => setCheckout({ ...checkout, customerEmail: event.target.value })} /></label></div>
            <fieldset className="storefront-fulfillment"><legend>Cara menerima pesanan</legend><label><input type="radio" name="fulfillment" value="pickup" checked={checkout.fulfillmentMethod === 'pickup'} onChange={() => setCheckout({ ...checkout, fulfillmentMethod: 'pickup', deliveryAddress: '' })} /> Ambil di toko</label><label><input type="radio" name="fulfillment" value="delivery" checked={checkout.fulfillmentMethod === 'delivery'} onChange={() => setCheckout({ ...checkout, fulfillmentMethod: 'delivery' })} /> Pengiriman</label></fieldset>
            {checkout.fulfillmentMethod === 'delivery' ? <label>Alamat pengiriman<textarea required maxLength="1000" rows="3" autoComplete="street-address" value={checkout.deliveryAddress} onChange={(event) => setCheckout({ ...checkout, deliveryAddress: event.target.value })} /></label> : <p className="storefront-checkout-hint"><Store size={15} /> Lokasi dan waktu pengambilan perlu dikonfirmasi dengan toko.</p>}
            <label>Catatan (opsional)<textarea maxLength="500" rows="2" value={checkout.notes} onChange={(event) => setCheckout({ ...checkout, notes: event.target.value })} /></label>
            <div className="storefront-payment-notice"><Truck size={16} /><span>Pesanan dibuat belum lunas. Silakan hubungi admin toko untuk konfirmasi pembayaran. Ongkir belum termasuk total.</span></div>
            <div className="storefront-modal-total"><span>Total produk</span><strong>{formatIDR(subtotal)}</strong></div>
            {checkoutError && <p className="storefront-form-error" role="alert">{checkoutError}</p>}
            <div className="storefront-modal-actions"><button type="button" className="storefront-cancel-button" onClick={() => setCheckoutOpen(false)} disabled={saving}>Kembali</button><button type="submit" className="storefront-checkout-button" disabled={saving || !cartItems.length}>{saving ? 'Mengirim pesanan…' : 'Buat pesanan'}</button></div>
          </form>
        </section>
      </div>}
    </div>
  )
}
