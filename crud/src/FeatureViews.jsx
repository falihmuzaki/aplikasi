import { useEffect, useState } from 'react'
import { CirclePlus, Printer, RefreshCw, Save, Truck } from 'lucide-react'

const API_URL = 'http://localhost:3001/api'
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('lumina-token') || ''}`, 'Content-Type': 'application/json', Accept: 'application/json' })
const idr = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0)

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { ...headers(), ...options.headers } })
  const result = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(result?.message || 'Permintaan gagal.')
  return result
}

function useLoad(path, refreshKey = 0) {
  const [data, setData] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    api(path).then((result) => { if (alive) { setData(result); setError('') } }).catch((cause) => { if (alive) setError(cause.message) })
    return () => { alive = false }
  }, [path, refreshKey])
  return [data, setData, error]
}

export function WarehousesView({ warehouses, onRefresh, onToast }) {
  const [selected, setSelected] = useState('')
  const [stock, setStock] = useState([])
  const [sourceStock, setSourceStock] = useState({ warehouseId: '', items: [] })
  const [transferRefresh, setTransferRefresh] = useState(0)
  const [form, setForm] = useState({ name: '', address: '' })
  const [transfer, setTransfer] = useState({ sourceWarehouseId: '', destinationWarehouseId: '', productId: '', quantity: '1', notes: '' })
  const [error, setError] = useState('')
  const selectedId = selected || String(warehouses[0]?.id || '')
  useEffect(() => { if (selectedId) api(`/warehouses/${selectedId}/stock`).then(setStock).catch((cause) => setError(cause.message)) }, [selectedId, warehouses])
  useEffect(() => {
    if (!transfer.sourceWarehouseId) return
    api(`/warehouses/${transfer.sourceWarehouseId}/stock`).then((items) => setSourceStock({ warehouseId: transfer.sourceWarehouseId, items })).catch((cause) => setError(cause.message))
  }, [transfer.sourceWarehouseId, transferRefresh])
  const sourceStockItems = sourceStock.warehouseId === transfer.sourceWarehouseId ? sourceStock.items : []
  const addWarehouse = async (event) => {
    event.preventDefault()
    try { await api('/warehouses', { method: 'POST', body: JSON.stringify(form) }); setForm({ name: '', address: '' }); onRefresh(); onToast('Gudang ditambahkan.') } catch (cause) { setError(cause.message) }
  }
  const doTransfer = async (event) => {
    event.preventDefault()
    try { await api('/stock-transfers', { method: 'POST', body: JSON.stringify({ ...transfer, sourceWarehouseId: Number(transfer.sourceWarehouseId), destinationWarehouseId: Number(transfer.destinationWarehouseId), productId: Number(transfer.productId), quantity: Number(transfer.quantity) }) }); setError(''); setTransferRefresh((value) => value + 1); onRefresh(); onToast('Transfer stok berhasil dicatat.') } catch (cause) { setError(cause.message) }
  }
  return <>
    <header className="topbar"><div><p className="breadcrumb">Inventory / <span>Warehouses</span></p><h1>Gudang & transfer stok</h1></div></header>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Daftar gudang</h2><p className="muted">Stok dipisahkan per gudang; transfer menjaga total stok tetap sama.</p></div></div>
      {error && <p className="login-error">{error}</p>}
      <form className="toolbar" onSubmit={addWarehouse}><input required maxLength="120" placeholder="Nama gudang baru" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input maxLength="2000" placeholder="Alamat" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /><button className="primary-button"><CirclePlus size={16} /> Tambah gudang</button></form>
      <div className="table-wrap"><table><thead><tr><th>Nama</th><th>Alamat</th><th>Status</th><th>Total unit</th></tr></thead><tbody>{warehouses.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.address || '—'}</td><td>{item.isDefault ? 'Gudang utama' : 'Gudang'}</td><td>{item.stockUnits}</td></tr>)}</tbody></table></div>
    </section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Transfer antar gudang</h2><p className="muted">Pindahkan stok tanpa mengubah total inventaris.</p></div></div>
      <form className="toolbar" onSubmit={doTransfer}><select required value={transfer.sourceWarehouseId} onChange={(event) => setTransfer({ ...transfer, sourceWarehouseId: event.target.value, productId: '' })}><option value="">Gudang asal</option>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select required value={transfer.destinationWarehouseId} onChange={(event) => setTransfer({ ...transfer, destinationWarehouseId: event.target.value })}><option value="">Gudang tujuan</option>{warehouses.filter((item) => String(item.id) !== transfer.sourceWarehouseId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select required value={transfer.productId} onChange={(event) => setTransfer({ ...transfer, productId: event.target.value })}><option value="">Produk</option>{sourceStockItems.map((item) => item.stock > 0 && <option key={item.productId} value={item.productId}>{item.name} · {item.stock} unit</option>)}</select><input required type="number" min="1" step="1" value={transfer.quantity} onChange={(event) => setTransfer({ ...transfer, quantity: event.target.value })} /><button className="primary-button"><Truck size={16} /> Transfer</button></form>
      <div className="toolbar"><label>Stok gudang<select value={selectedId} onChange={(event) => setSelected(event.target.value)}>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      <div className="table-wrap"><table><thead><tr><th>Produk</th><th>SKU</th><th>Barcode</th><th>Stok</th><th>Batas rendah</th></tr></thead><tbody>{stock.map((item) => <tr key={item.productId}><td>{item.name}</td><td>{item.sku || '—'}</td><td>{item.barcode || '—'}</td><td>{item.stock}</td><td>{item.lowStockThreshold}</td></tr>)}</tbody></table></div>
    </section>
  </>
}

export function StocktakeView({ warehouses, onToast, onRefresh }) {
  const [selected, setSelected] = useState('')
  const [stock, setStock] = useState([])
  const [counts, setCounts] = useState({})
  const [refresh, setRefresh] = useState(0)
  const [records, , error] = useLoad('/stocktakes', refresh)
  const [message, setMessage] = useState(error)
  const selectedId = selected || String(warehouses[0]?.id || '')
  useEffect(() => {
    if (!selectedId) return
    api(`/warehouses/${selectedId}/stock`).then((rows) => { setStock(rows); setCounts(Object.fromEntries(rows.map((row) => [row.productId, String(row.stock)]))) }).catch((cause) => setMessage(cause.message))
  }, [selectedId])
  const complete = async (id) => {
    try { await api(`/stocktakes/${id}/complete`, { method: 'POST', body: '{}' }); setRefresh((value) => value + 1); onRefresh(); onToast('Stok opname selesai dan selisih dicatat.') } catch (cause) { setMessage(cause.message) }
  }
  const submit = async (event) => {
    event.preventDefault()
    try {
      const record = await api('/stocktakes', { method: 'POST', body: JSON.stringify({ warehouseId: Number(selectedId), items: stock.map((item) => ({ productId: item.productId, countedQuantity: Number(counts[item.productId]) })) }) })
      await complete(record.id)
    } catch (cause) { setMessage(cause.message) }
  }
  return <>
    <header className="topbar"><div><p className="breadcrumb">Inventory / <span>Stocktaking</span></p><h1>Stok opname</h1></div></header>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Hitung fisik</h2><p className="muted">Catat hasil hitung; selisih akan masuk ke log stok saat diselesaikan.</p></div></div>
      {(message || error) && <p className="login-error">{message || error}</p>}
      <form onSubmit={submit}><label>Gudang<select required value={selectedId} onChange={(event) => setSelected(event.target.value)}>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="table-wrap"><table><thead><tr><th>Produk</th><th>SKU</th><th>Stok sistem</th><th>Hitung fisik</th></tr></thead><tbody>{stock.map((item) => <tr key={item.productId}><td>{item.name}</td><td>{item.sku || '—'}</td><td>{item.stock}</td><td><input aria-label={`Jumlah hitung ${item.name}`} type="number" min="0" step="1" value={counts[item.productId] ?? item.stock} onChange={(event) => setCounts({ ...counts, [item.productId]: event.target.value })} /></td></tr>)}</tbody></table></div><button className="primary-button" disabled={!stock.length}><Save size={16} /> Simpan hitung & sesuaikan stok</button></form>
    </section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Riwayat stok opname</h2></div><button className="filter-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /> Muat ulang</button></div><div className="table-wrap"><table><thead><tr><th>Tanggal</th><th>Gudang</th><th>Item</th><th>Selisih</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{new Date(record.createdAt).toLocaleString('id-ID')}</td><td>{record.warehouseName}</td><td>{record.itemCount}</td><td>{record.varianceCount}</td><td>{record.status}</td><td>{record.status === 'draft' && <button className="secondary-button" onClick={() => complete(record.id)}>Selesaikan</button>}</td></tr>)}{!records.length && <tr><td colSpan="6" className="empty-state">Belum ada stok opname.</td></tr>}</tbody></table></div></section>
  </>
}

export function ReportsView() {
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(today.slice(0, 8) + '01')
  const [to, setTo] = useState(today)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const load = async () => { try { setReport(await api(`/reports?from=${from}&to=${to}`)); setError('') } catch (cause) { setError(cause.message) } }
  useEffect(() => {
    let active = true
    api(`/reports?from=${from}&to=${to}`).then((result) => { if (active) { setReport(result); setError('') } }).catch((cause) => { if (active) setError(cause.message) })
    return () => { active = false }
  }, [from, to])
  const exportCsv = () => {
    if (!report) return
    const rows = [['Laporan', 'Jumlah'], ['Periode', `${report.from || ''} s.d. ${report.to || ''}`], ['Jumlah penjualan', report.sales.orderCount], ['Pendapatan penjualan', report.sales.revenue], ['Pembayaran diterima', report.sales.payments], ['Refund', report.sales.refunds], ['Jumlah pembelian', report.purchases.orderCount], ['Nilai pembelian', report.purchases.orderedAmount], ['Pembayaran pemasok', report.purchases.paidAmount], [], ['Produk terlaris', 'Unit', 'Pendapatan'], ...report.bestsellers.map((item) => [item.productName, item.unitsSold, item.revenue])]
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `laporan-${from}-${to}.csv`; link.click(); URL.revokeObjectURL(link.href)
  }
  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Reports</span></p><h1>Laporan usaha</h1></div><div className="panel-heading-actions"><button className="filter-button" onClick={exportCsv}>Export CSV</button><button className="primary-button" onClick={() => window.print()}><Printer size={16} /> Cetak / PDF</button></div></header>
    <section className="catalog-panel"><div className="toolbar"><label>Dari<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Sampai<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="primary-button" onClick={load}>Tampilkan</button></div>{error && <p className="login-error">{error}</p>}
      {report && <><div className="stats-grid"><div className="stat-card"><span>Penjualan</span><strong>{report.sales.orderCount}</strong><small>{idr(report.sales.revenue)}</small></div><div className="stat-card"><span>Margin kotor*</span><strong>{idr(report.sales.grossMargin)}</strong><small>* berdasarkan biaya beli tersimpan</small></div><div className="stat-card"><span>Pembayaran masuk</span><strong>{idr(report.sales.payments)}</strong><small>Refund {idr(report.sales.refunds)}</small></div><div className="stat-card"><span>Pembelian</span><strong>{report.purchases.orderCount}</strong><small>{idr(report.purchases.orderedAmount)}</small></div><div className="stat-card"><span>Dibayar ke pemasok</span><strong>{idr(report.purchases.paidAmount)}</strong></div></div><div className="table-wrap"><table><thead><tr><th>Produk terlaris</th><th>Unit terjual</th><th>Pendapatan</th><th>Margin kotor*</th></tr></thead><tbody>{report.bestsellers.map((item) => <tr key={item.productId}><td>{item.productName}</td><td>{item.unitsSold}</td><td>{idr(item.revenue)}</td><td>{idr(item.grossMargin)}</td></tr>)}</tbody></table></div></>}
    </section>
  </>
}

export function ReceivablesView({ _onToast }) {
  const [refresh, setRefresh] = useState(0)
  const [data, , error] = useLoad('/receivables', refresh)
  return <>
    <header className="topbar"><div><p className="breadcrumb">Sales / <span>Receivables</span></p><h1>Piutang pelanggan</h1></div><button className="filter-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /> Muat ulang</button></header>
    <section className="welcome-row"><div><p className="muted">Total tagihan belum lunas</p><h2>{idr(data.totalOutstanding)}</h2><p className="muted">Umur piutang dihitung sejak tanggal pesanan.</p></div></section>
    <section className="catalog-panel">{error && <p className="login-error">{error}</p>}<div className="table-wrap"><table><thead><tr><th>No. pesanan</th><th>Pelanggan</th><th>Tanggal</th><th>Umur</th><th>Total</th><th>Dibayar</th><th>Sisa</th></tr></thead><tbody>{(data.orders || []).map((order) => <tr key={order.orderNumber}><td>{order.orderNumber}</td><td>{order.customerName}</td><td>{new Date(order.createdAt).toLocaleDateString('id-ID')}</td><td>{order.agingDays} hari</td><td>{idr(order.totalAmount)}</td><td>{idr(order.paidAmount)}</td><td>{idr(order.balanceDue)}</td></tr>)}{!data.orders?.length && <tr><td colSpan="7" className="empty-state">Tidak ada piutang terbuka.</td></tr>}</tbody></table></div></section>
  </>
}

export function RestockView({ _onToast }) {
  const [refresh, setRefresh] = useState(0)
  const [items, , error] = useLoad('/restock-recommendations', refresh)
  return <>
    <header className="topbar"><div><p className="breadcrumb">Inventory / <span>Restock</span></p><h1>Peringatan stok & saran restock</h1></div><button className="filter-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /> Muat ulang</button></header>
    <section className="catalog-panel">{error && <p className="login-error">{error}</p>}<div className="table-wrap"><table><thead><tr><th>Produk</th><th>Gudang</th><th>SKU / barcode</th><th>Stok saat ini</th><th>Batas minimum</th><th>Saran pemesanan</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.productId}-${item.warehouseId}`}><td>{item.name}</td><td>{item.warehouseName}</td><td>{item.sku || item.barcode || '—'}</td><td>{item.stock}</td><td>{item.lowStockThreshold}</td><td>{item.suggestedQuantity}</td></tr>)}{!items.length && <tr><td colSpan="6" className="empty-state">Semua produk memiliki stok yang cukup.</td></tr>}</tbody></table></div></section>
  </>
}

export function BatchesView({ products, warehouses, onToast }) {
  const [refresh, setRefresh] = useState(0)
  const [batches, , error] = useLoad('/product-batches', refresh)
  const [form, setForm] = useState({ productId: '', warehouseId: '', batchNumber: '', serialNumber: '', expiresAt: '', quantity: '1' })
  const [message, setMessage] = useState(error)
  const submit = async (event) => {
    event.preventDefault()
    try { await api('/product-batches', { method: 'POST', body: JSON.stringify({ ...form, productId: Number(form.productId), warehouseId: Number(form.warehouseId), quantity: Number(form.quantity) }) }); setRefresh((value) => value + 1); setMessage(''); onToast('Batch berhasil ditautkan ke stok tersedia.') } catch (cause) { setMessage(cause.message) }
  }
  return <>
    <header className="topbar"><div><p className="breadcrumb">Inventory / <span>Batch tracking</span></p><h1>Batch, serial & kedaluwarsa</h1></div></header>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Catat batch pada stok tersedia</h2><p className="muted">Aktifkan pelacakan batch pada produk terlebih dahulu. Jumlah batch tidak boleh melebihi stok gudang.</p></div></div>{message && <p className="login-error">{message}</p>}
      <form className="toolbar" onSubmit={submit}><select required value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}><option value="">Produk terlacak</option>{products.filter((product) => product.trackBatches).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><select required value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}><option value="">Gudang</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select><input required maxLength="120" placeholder="Nomor batch" value={form.batchNumber} onChange={(event) => setForm({ ...form, batchNumber: event.target.value })} /><input maxLength="120" placeholder="Nomor seri (opsional, qty=1)" value={form.serialNumber} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} /><input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /><input required type="number" min="1" step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /><button className="primary-button">Tambah batch</button></form>
      <div className="table-wrap"><table><thead><tr><th>Produk</th><th>Gudang</th><th>Batch</th><th>Serial</th><th>Kedaluwarsa</th><th>Qty</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}><td>{batch.productName}</td><td>{batch.warehouseName}</td><td>{batch.batchNumber}</td><td>{batch.serialNumber || '—'}</td><td>{batch.expiresAt || '—'}</td><td>{batch.quantity}</td></tr>)}</tbody></table></div>
    </section>
  </>
}

export function BarcodeView({ products, onSave, onToast }) {
  const [code, setCode] = useState('')
  const [product, setProduct] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const [barcode, setBarcode] = useState('')
  const [trackBatches, setTrackBatches] = useState(false)
  const [saving, setSaving] = useState(false)
  const saveMetadata = async (event) => {
    event.preventDefault()
    setSaving(true)
    const ok = await onSave(Number(selected), { barcode, trackBatches })
    setSaving(false)
    if (ok) { setError(''); onToast('Barcode dan pelacakan batch diperbarui.') }
  }
  const submit = async (event) => {
    event.preventDefault()
    try { setProduct(await api(`/products/lookup/${encodeURIComponent(code.trim())}`)); setError('') } catch (cause) { setProduct(null); setError(cause.message) }
  }
  return <>
    <header className="topbar"><div><p className="breadcrumb">Inventory / <span>Barcode</span></p><h1>Pencarian barcode / SKU</h1></div></header>
    <section className="catalog-panel"><p className="muted">Fokuskan scanner USB pada kolom ini, atau ketik barcode/SKU lalu tekan Enter.</p><form className="toolbar" onSubmit={submit}><input autoFocus value={code} onChange={(event) => setCode(event.target.value)} placeholder="Scan barcode atau masukkan SKU" /><button className="primary-button">Cari produk</button></form>{error && <p className="login-error">{error}</p>}{product && <div className="stat-card"><strong>{product.name}</strong><span>{product.sku || '—'} · {product.barcode || '—'}</span><span>Stok: {product.stock} · Harga: {idr(product.price)}</span></div>}</section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Pengaturan barcode & batch produk</h2><p className="muted">Barcode harus unik; batch dapat diaktifkan sesuai kebutuhan produk.</p></div></div><form className="toolbar" onSubmit={saveMetadata}><select required value={selected} onChange={(event) => { setSelected(event.target.value); const item = products.find((entry) => entry.id === Number(event.target.value)); setBarcode(item?.barcode || ''); setTrackBatches(item?.trackBatches || false) }}><option value="">Pilih produk</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input maxLength="120" placeholder="Barcode (opsional)" value={barcode} onChange={(event) => setBarcode(event.target.value)} /><label className="toggle-row"><input type="checkbox" checked={trackBatches} onChange={(event) => setTrackBatches(event.target.checked)} /> Lacak batch</label><button className="primary-button" disabled={!selected || saving}>Simpan</button></form></section>
  </>
}

export function SupplierAccountingView({ onToast, onRefresh }) {
  const [refresh, setRefresh] = useState(0)
  const [orders, , error] = useLoad('/purchases', refresh)
  const [payment, setPayment] = useState(null)
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'bank_transfer', reference: '', notes: '' })
  const [returnForm, setReturnForm] = useState({ purchaseOrderId: '', productId: '', quantity: '1', reason: '' })
  const [message, setMessage] = useState(error)
  const savePayment = async (event) => {
    event.preventDefault()
    try {
      await api(`/purchases/${payment.id}/payments`, { method: 'POST', body: JSON.stringify({ ...paymentForm, amount: Number(paymentForm.amount) }) })
      setPayment(null); setRefresh((value) => value + 1); onRefresh(); onToast('Pembayaran utang pemasok dicatat.')
    } catch (cause) { setMessage(cause.message) }
  }
  const saveReturn = async (event) => {
    event.preventDefault()
    try {
      await api('/supplier-returns', { method: 'POST', body: JSON.stringify({ ...returnForm, purchaseOrderId: Number(returnForm.purchaseOrderId), items: [{ productId: Number(returnForm.productId), quantity: Number(returnForm.quantity) }] }) })
      setMessage(''); setRefresh((value) => value + 1); onRefresh(); onToast('Retur pemasok dicatat dan stok dikurangi.')
    } catch (cause) { setMessage(cause.message) }
  }
  const selectedOrder = orders.find((order) => String(order.id) === returnForm.purchaseOrderId)
  return <>
    <header className="topbar"><div><p className="breadcrumb">Procurement / <span>Payables</span></p><h1>Utang & retur pemasok</h1></div><button className="filter-button" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} /> Muat ulang</button></header>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Tagihan pembelian</h2><p className="muted">Catat pembayaran sebagian/lunas dan lihat saldo terutang.</p></div></div>{(error || message) && <p className="login-error">{message || error}</p>}<div className="table-wrap"><table><thead><tr><th>Pesanan</th><th>Pemasok</th><th>Jatuh tempo</th><th>Total</th><th>Dibayar</th><th>Saldo utang</th><th></th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td>{order.orderNumber}</td><td>{order.supplierName}</td><td>{order.dueDate || '—'}</td><td>{idr(order.totalAmount)}</td><td>{idr(order.paidAmount)}</td><td>{idr(order.balanceDue)}</td><td>{order.balanceDue > 0 && <button className="secondary-button" onClick={() => { setPayment(order); setPaymentForm({ amount: order.balanceDue.toFixed(2), method: 'bank_transfer', reference: '', notes: '' }) }}>Catat pembayaran</button>}</td></tr>)}{!orders.length && <tr><td colSpan="7" className="empty-state">Belum ada pesanan pembelian.</td></tr>}</tbody></table></div></section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Retur ke pemasok</h2><p className="muted">Pilih produk dari pesanan yang sudah diterima; retur mengurangi stok dan saldo utang.</p></div></div><form className="toolbar" onSubmit={saveReturn}><select required value={returnForm.purchaseOrderId} onChange={(event) => setReturnForm({ ...returnForm, purchaseOrderId: event.target.value, productId: '' })}><option value="">Pesanan pembelian</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.orderNumber} · {order.supplierName}</option>)}</select><select required value={returnForm.productId} onChange={(event) => setReturnForm({ ...returnForm, productId: event.target.value })}><option value="">Produk diterima</option>{(selectedOrder?.items || []).filter((item) => item.receivedQuantity > 0).map((item) => <option key={item.productId} value={item.productId}>{item.productName} · diterima {item.receivedQuantity}</option>)}</select><input required type="number" min="1" step="1" value={returnForm.quantity} onChange={(event) => setReturnForm({ ...returnForm, quantity: event.target.value })} /><input maxLength="500" placeholder="Alasan retur" value={returnForm.reason} onChange={(event) => setReturnForm({ ...returnForm, reason: event.target.value })} /><button className="primary-button">Catat retur</button></form></section>
    {payment && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPayment(null)}><form className="modal" onSubmit={savePayment}><div className="modal-heading"><div><h2>Pembayaran pemasok</h2><p className="muted">{payment.orderNumber} · sisa {idr(payment.balanceDue)}</p></div><button type="button" className="close-button" onClick={() => setPayment(null)}>×</button></div><label>Jumlah<input required min="0.01" max={payment.balanceDue} step="0.01" type="number" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label><label>Metode<select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}><option value="cash">Tunai</option><option value="bank_transfer">Transfer bank</option><option value="qris">QRIS</option><option value="card">Kartu</option><option value="other">Lainnya</option></select></label><label>Referensi<input value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPayment(null)}>Batal</button><button className="primary-button">Simpan pembayaran</button></div></form></div>}
  </>
}
