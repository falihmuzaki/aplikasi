import { useEffect, useMemo, useState } from 'react'
import { Activity, Archive, ArrowDownUp, Bell, Box, Check, ChevronDown, CirclePlus, ClipboardList, CreditCard, FileUp, Image as ImageIcon, KeyRound, LayoutDashboard, LogOut, PackageSearch, Pencil, Printer, ReceiptText, RotateCcw, Save, Search, Settings2, ShieldCheck, ShoppingCart, Tag, Trash2, Truck, Upload, UserPlus, UserRound, UsersRound, Video, X } from 'lucide-react'
import { code128BarcodeSvg } from './barcode'
import { BackupView, BatchesView, BarcodeView, CashSessionView, ExpensesView, ReceivablesView, ReportsView, RestockView, StocktakeView, SupplierAccountingView, WarehousesView } from './FeatureViews'
import './App.css'

const seedProducts = [
  { id: 1, name: 'Wireless Headphones', category: 'Electronics', price: 1950000, stock: 24, status: 'Active' },
  { id: 2, name: 'Minimal Desk Lamp', category: 'Home & Living', price: 975000, stock: 8, status: 'Active' },
  { id: 3, name: 'Everyday Backpack', category: 'Accessories', price: 1340000, stock: 0, status: 'Out of stock' },
  { id: 4, name: 'Ceramic Coffee Set', category: 'Home & Living', price: 640000, stock: 16, status: 'Active' },
  { id: 5, name: 'Running Sneakers', category: 'Fashion', price: 1680000, stock: 3, status: 'Low stock' },
]
const defaultCategories = ['Electronics', 'Home & Living', 'Accessories', 'Fashion']
const blankForm = { name: '', category: 'Electronics', price: '', stock: '', status: 'Active', media: null, sku: '', barcode: '', trackBatches: false, lowStockThreshold: 5 }
const LOW_STOCK_THRESHOLD = 5
const blankUser = { name: '', email: '', password: '', role: 'staff', isActive: true, mfaEnabled: false }
const API_URL = 'http://localhost:3001/api'
const getInitials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')
const Avatar = ({ user, className = '' }) => user?.avatarUrl
  ? <span className={`avatar has-photo ${className}`}><img src={user.avatarUrl} alt={user?.name || 'User'} /></span>
  : <span className={`avatar ${className}`}>{getInitials(user?.name || 'User')}</span>
const Logo = () => (
  <span className="brand-mark" aria-hidden="true">
    <svg viewBox="0 0 64 64" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 26 h28 l-2.4 24.5 a4 4 0 0 1 -4 3.5 h-15.2 a4 4 0 0 1 -4 -3.5 Z" fill="#fff" opacity="0.97" />
      <path d="M25 26 v-3.5 a7 7 0 0 1 14 0 V26" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
      <text x="32" y="45" textAnchor="middle" fontFamily="'Manrope','DM Sans',sans-serif" fontSize="16" fontWeight="800" fill="#2a4d9b" letterSpacing="-0.5">IS</text>
      <path d="M49 14 l1.5 3.3 3.3 1.5 -3.3 1.5 -1.5 3.3 -1.5 -3.3 -3.3 -1.5 3.3 -1.5 Z" fill="#ffd27a" />
    </svg>
  </span>
)
const idrFormatter = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const formatIDR = (value) => idrFormatter.format(Math.round(Number(value) || 0))
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('lumina-token') || ''}`, Accept: 'application/json' })

function UsersView({ users, onSave, onDelete }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankUser)
  const [pendingUser, setPendingUser] = useState(null)
  const filteredUsers = users.filter((user) => `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(query.toLowerCase()))
  const openCreate = () => { setEditingId(null); setForm(blankUser); setIsOpen(true) }
  const openEdit = (user) => { setEditingId(user.id); setForm({ ...user, password: '' }); setIsOpen(true) }
  const submit = async (event) => { event.preventDefault(); await onSave(form, editingId); setIsOpen(false) }

  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Users</span></p><h1>User management</h1></div><button className="primary-button" onClick={openCreate}><UserPlus size={18} /> Add user</button></header>
    <section className="welcome-row"><div><p className="muted">Access and permissions</p><h2>Workspace users</h2><p className="muted">Manage who can access your inventory workspace.</p></div><div className="sync-status"><span className="pulse"></span> PostgreSQL synced</div></section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>All users</h2><p className="muted">{users.length} registered account{users.length === 1 ? '' : 's'}.</p></div></div><div className="toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users..." /></label></div><div className="table-wrap"><table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td><div className="product-cell"><span className="user-avatar"><UserRound size={16} /></span><strong>{user.name}</strong></div></td><td>{user.email}</td><td><span className={`role-badge ${user.role}`}>{user.role}</span></td><td><span className={`status ${user.isActive ? 'active' : 'out-of-stock'}`}><span></span>{user.isActive ? 'Active' : 'Inactive'}</span></td><td><div className="actions"><button title="Edit user" onClick={() => openEdit(user)}><Pencil size={16} /></button><button title="Delete user" onClick={() => setPendingUser(user)}><Trash2 size={16} /></button></div></td></tr>)}{filteredUsers.length === 0 && <tr><td colSpan="5" className="empty-state">No users match your search.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{filteredUsers.length}</b> of <b>{users.length}</b> users</span></div></section>
    {isOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}><form className="modal" onSubmit={submit}><div className="modal-heading"><div><h2>{editingId ? 'Edit user' : 'Add user'}</h2><p className="muted">Set account access and permissions.</p></div><button type="button" className="close-button" onClick={() => setIsOpen(false)}><X size={19} /></button></div><label>Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Alex Rivera" /></label><label>Email address<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@company.com" /></label><label>Password{editingId && <small className="field-hint">Leave empty to keep the current password.</small>}<input required={!editingId} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingId ? 'Optional new password' : 'Create a password'} /></label><label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="admin">Admin</option><option value="staff">Staff</option></select></label><label className="toggle-row"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Active account</label><label className="toggle-row"><input type="checkbox" checked={form.mfaEnabled} onChange={(event) => setForm({ ...form, mfaEnabled: event.target.checked })} /> Enable email OTP MFA</label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>Cancel</button><button type="submit" className="primary-button">{editingId ? 'Save changes' : 'Add user'}</button></div></form></div>}
    {pendingUser && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingUser(null)}><div className="modal"><div className="modal-heading"><div><h2>Delete user</h2><p className="muted">Hapus "{pendingUser.name}" dari workspace?</p></div><button type="button" className="close-button" onClick={() => setPendingUser(null)}><X size={19} /></button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPendingUser(null)}>Cancel</button><button type="button" className="danger-button" onClick={async () => { await onDelete(pendingUser.id); setPendingUser(null) }}><Trash2 size={15} /> Delete</button></div></div></div>}
  </>
}

function CategoriesView({ categories, canManage, onSave, onDelete }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(null)
  const [saving, setSaving] = useState(false)
  const filtered = categories.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
  const openCreate = () => { setEditingId(null); setName(''); setIsOpen(true) }
  const openEdit = (item) => { setEditingId(item.id); setName(item.name); setIsOpen(true) }
  const submit = async (event) => { event.preventDefault(); setSaving(true); const ok = await onSave({ name: name.trim() }, editingId); setSaving(false); if (ok) setIsOpen(false) }
  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Categories</span></p><h1>Category management</h1></div>{canManage && <button className="primary-button" onClick={openCreate}><CirclePlus size={18} /> Add category</button>}</header>
    <section className="welcome-row"><div><p className="muted">Catalog taxonomy</p><h2>Product categories</h2><p className="muted">{canManage ? 'Kelola daftar kategori untuk katalog produk.' : 'Daftar kategori produk (hanya admin yang dapat mengubah).'}</p></div><div className="sync-status"><span className="pulse"></span> PostgreSQL synced</div></section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>All categories</h2><p className="muted">{categories.length} kategori terdaftar.</p></div></div><div className="toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories..." /></label></div><div className="table-wrap"><table><thead><tr><th>Category</th><th>Products</th>{canManage && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><div className="product-cell"><span className="product-avatar avatar-0"><Tag size={16} /></span><strong>{item.name}</strong></div></td><td>{item.productCount} produk</td>{canManage && <td><div className="actions"><button title="Edit category" onClick={() => openEdit(item)}><Pencil size={16} /></button><button title="Delete category" onClick={() => setPending(item)}><Trash2 size={16} /></button></div></td>}</tr>)}{filtered.length === 0 && <tr><td colSpan={canManage ? 3 : 2} className="empty-state">No categories match your search.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{filtered.length}</b> of <b>{categories.length}</b> categories</span></div></section>
    {isOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}><form className="modal" onSubmit={submit}><div className="modal-heading"><div><h2>{editingId ? 'Edit category' : 'Add category'}</h2><p className="muted">{editingId ? 'Mengubah nama akan ikut memperbarui produk terkait.' : 'Tambahkan kategori baru ke katalog.'}</p></div><button type="button" className="close-button" onClick={() => setIsOpen(false)}><X size={19} /></button></div><label>Category name<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Electronics" /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !name.trim()}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Add category'}</button></div></form></div>}
    {pending && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPending(null)}><div className="modal"><div className="modal-heading"><div><h2>Delete category</h2><p className="muted">Hapus "{pending.name}"? {pending.productCount > 0 ? `Kategori ini dipakai ${pending.productCount} produk dan tidak dapat dihapus.` : 'Tindakan ini permanen.'}</p></div><button type="button" className="close-button" onClick={() => setPending(null)}><X size={19} /></button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPending(null)}>Cancel</button><button type="button" className="danger-button" disabled={pending.productCount > 0} onClick={async () => { const ok = await onDelete(pending.id); if (ok) setPending(null) }}><Trash2 size={15} /> Delete</button></div></div></div>}
  </>
}

function SuppliersView({ suppliers, canManage, onSave, onDelete }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [pending, setPending] = useState(null)
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '', notes: '' })
  const filtered = suppliers.filter((supplier) => `${supplier.name} ${supplier.contactName || ''} ${supplier.email || ''}`.toLowerCase().includes(query.toLowerCase()))
  const openCreate = () => { setEditingId(null); setForm({ name: '', contactName: '', email: '', phone: '', address: '', notes: '' }); setIsOpen(true) }
  const openEdit = (supplier) => { setEditingId(supplier.id); setForm({ ...supplier }); setIsOpen(true) }
  const submit = async (event) => { event.preventDefault(); const ok = await onSave(form, editingId); if (ok) setIsOpen(false) }

  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Suppliers</span></p><h1>Supplier management</h1></div>{canManage && <button className="primary-button" onClick={openCreate}><CirclePlus size={18} /> Add supplier</button>}</header>
    <section className="welcome-row"><div><p className="muted">Procurement directory</p><h2>Suppliers</h2><p className="muted">Kontak pemasok untuk pesanan pembelian dan penerimaan stok.</p></div><div className="sync-status"><span className="pulse"></span> PostgreSQL synced</div></section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>All suppliers</h2><p className="muted">{suppliers.length} pemasok terdaftar.</p></div></div><div className="toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari pemasok..." /></label></div><div className="table-wrap"><table><thead><tr><th>Pemasok</th><th>Kontak</th><th>Email</th><th>Telepon</th><th>Pesanan</th>{canManage && <th><span className="sr-only">Aksi</span></th>}</tr></thead><tbody>{filtered.map((supplier) => <tr key={supplier.id}><td><div className="product-cell"><span className="product-avatar avatar-0"><Truck size={16} /></span><strong>{supplier.name}</strong></div></td><td>{supplier.contactName || '—'}</td><td>{supplier.email || '—'}</td><td>{supplier.phone || '—'}</td><td>{supplier.purchaseCount || 0}</td>{canManage && <td><div className="actions"><button title="Edit pemasok" onClick={() => openEdit(supplier)}><Pencil size={16} /></button><button title="Hapus pemasok" onClick={() => setPending(supplier)}><Trash2 size={16} /></button></div></td>}</tr>)}{filtered.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="empty-state">Pemasok tidak ditemukan.</td></tr>}</tbody></table></div><div className="table-footer"><span>Menampilkan <b>{filtered.length}</b> dari <b>{suppliers.length}</b> pemasok</span></div></section>
    {isOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}><form className="modal" onSubmit={submit}><div className="modal-heading"><div><h2>{editingId ? 'Edit pemasok' : 'Tambah pemasok'}</h2><p className="muted">Informasi kontak pemasok.</p></div><button type="button" className="close-button" onClick={() => setIsOpen(false)}><X size={19} /></button></div><label>Nama pemasok<input required maxLength="160" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Nama kontak<input maxLength="120" value={form.contactName || ''} onChange={(event) => setForm({ ...form, contactName: event.target.value })} /></label><label>Email<input type="email" value={form.email || ''} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Telepon<input value={form.phone || ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Alamat<textarea rows="2" value={form.address || ''} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label><label>Catatan<textarea rows="2" value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>Batal</button><button type="submit" className="primary-button">{editingId ? 'Simpan perubahan' : 'Tambah pemasok'}</button></div></form></div>}
    {pending && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPending(null)}><div className="modal"><div className="modal-heading"><div><h2>Hapus pemasok?</h2><p className="muted">{pending.name} hanya dapat dihapus jika belum memiliki pesanan pembelian.</p></div><button type="button" className="close-button" onClick={() => setPending(null)}><X size={19} /></button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPending(null)}>Batal</button><button type="button" className="danger-button" onClick={async () => { const ok = await onDelete(pending.id); if (ok) setPending(null) }}><Trash2 size={15} /> Hapus</button></div></div></div>}
  </>
}

function PurchasesView({ purchases, suppliers, products, onCreate, onReceive }) {
  const [isOpen, setIsOpen] = useState(false)
  const [receiving, setReceiving] = useState(null)
  const [form, setForm] = useState({ supplierId: '', notes: '', items: [{ productId: '', quantity: '1', unitCost: '0' }] })
  const [receiveQuantities, setReceiveQuantities] = useState({})
  const [receiveInfo, setReceiveInfo] = useState({})
  const [saving, setSaving] = useState(false)
  const openCreate = () => { setForm({ supplierId: suppliers[0] ? String(suppliers[0].id) : '', notes: '', items: [{ productId: '', quantity: '1', unitCost: '0' }] }); setIsOpen(true) }
  const updateItem = (index, key, value) => setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }))
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    const ok = await onCreate({ ...form, supplierId: Number(form.supplierId), items: form.items.map((item) => ({ productId: Number(item.productId), quantity: Number(item.quantity), unitCost: Number(item.unitCost) })) })
    setSaving(false)
    if (ok) setIsOpen(false)
  }
  const openReceive = (order) => {
    setReceiving(order)
    setReceiveQuantities(Object.fromEntries(order.items.filter((item) => item.quantity > item.receivedQuantity).map((item) => [item.id, String(item.quantity - item.receivedQuantity)])))
    setReceiveInfo(Object.fromEntries(order.items.map((item) => [item.id, { batchNumber: '', serialNumber: '', expiresAt: '' }])))
  }
  const submitReceive = async (event) => {
    event.preventDefault()
    setSaving(true)
    const items = receiving.items.map((item) => ({ itemId: item.id, quantity: Number(receiveQuantities[item.id] || 0), ...(receiveInfo[item.id] || {}) })).filter((item) => item.quantity > 0)
    const ok = await onReceive(receiving.id, items)
    setSaving(false)
    if (ok) setReceiving(null)
  }
  const statusLabels = { ordered: 'Dipesan', partially_received: 'Diterima sebagian', received: 'Diterima' }

  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Purchases</span></p><h1>Purchase orders</h1></div><button className="primary-button" onClick={openCreate} disabled={suppliers.length === 0 || products.length === 0}><CirclePlus size={18} /> Buat pesanan</button></header>
    <section className="welcome-row"><div><p className="muted">Procurement & receiving</p><h2>Pesanan pembelian</h2><p className="muted">Buat pesanan ke pemasok dan catat barang yang diterima.</p></div><div className="sync-status"><span className="pulse"></span> PostgreSQL synced</div></section>
    {suppliers.length === 0 && <section className="catalog-panel empty-hint">Tambahkan pemasok terlebih dahulu sebelum membuat pesanan pembelian.</section>}
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Semua pesanan</h2><p className="muted">{purchases.length} pesanan tercatat.</p></div></div><div className="table-wrap"><table><thead><tr><th>No. pesanan</th><th>Pemasok</th><th>Produk</th><th>Total unit</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>{purchases.map((order) => <tr key={order.id}><td><strong>{order.orderNumber}</strong></td><td>{order.supplierName}</td><td>{order.items.map((item) => `${item.productName} (${item.receivedQuantity}/${item.quantity})`).join(', ')}</td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td><td><span className={`purchase-status ${order.status}`}>{statusLabels[order.status]}</span></td><td>{new Date(order.createdAt).toLocaleDateString('id-ID')}</td><td>{order.status !== 'received' && <button className="secondary-button" onClick={() => openReceive(order)}>Terima stok</button>}</td></tr>)}{purchases.length === 0 && <tr><td colSpan="7" className="empty-state">Belum ada pesanan pembelian.</td></tr>}</tbody></table></div></section>
    {isOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}><form className="modal purchase-modal" onSubmit={submit}><div className="modal-heading"><div><h2>Buat pesanan pembelian</h2><p className="muted">Pesanan langsung berstatus dipesan sampai barang diterima.</p></div><button type="button" className="close-button" onClick={() => setIsOpen(false)}><X size={19} /></button></div><label>Pemasok<select required value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}><option value="">Pilih pemasok</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>{form.items.map((item, index) => <div className="purchase-item-form" key={index}><label>Produk<select required value={item.productId} onChange={(event) => updateItem(index, 'productId', event.target.value)}><option value="">Pilih produk</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}</select></label><label>Jumlah<input required type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} /></label><label>Harga beli/unit<input required type="number" min="0" step="0.01" value={item.unitCost} onChange={(event) => updateItem(index, 'unitCost', event.target.value)} /></label>{form.items.length > 1 && <button type="button" className="remove-media" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}><X size={14} /> Hapus baris</button>}</div>)}<button type="button" className="secondary-button" onClick={() => setForm((current) => ({ ...current, items: [...current.items, { productId: '', quantity: '1', unitCost: '0' }] }))}>Tambah produk</button><label>Catatan<textarea rows="2" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>Batal</button><button type="submit" className="primary-button" disabled={saving || !form.supplierId || products.length === 0}>{saving ? 'Menyimpan...' : 'Buat pesanan'}</button></div></form></div>}
    {receiving && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setReceiving(null)}><form className="modal purchase-modal" onSubmit={submitReceive}><div className="modal-heading"><div><h2>Terima barang</h2><p className="muted">{receiving.orderNumber} · {receiving.supplierName}</p></div><button type="button" className="close-button" onClick={() => setReceiving(null)}><X size={19} /></button></div>{receiving.items.filter((item) => item.quantity > item.receivedQuantity).map((item) => <div key={item.id}><label>{item.productName} <small className="field-hint">Sisa {item.quantity - item.receivedQuantity} unit</small><input type="number" min="0" max={item.quantity - item.receivedQuantity} step="1" value={receiveQuantities[item.id] || ''} onChange={(event) => setReceiveQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></label>{item.trackBatches && Number(receiveQuantities[item.id]) > 0 && <><label>Nomor batch<input required maxLength="120" value={receiveInfo[item.id]?.batchNumber || ''} onChange={(event) => setReceiveInfo((current) => ({ ...current, [item.id]: { ...current[item.id], batchNumber: event.target.value } }))} /></label><label>Nomor seri (opsional)<input maxLength="120" value={receiveInfo[item.id]?.serialNumber || ''} onChange={(event) => setReceiveInfo((current) => ({ ...current, [item.id]: { ...current[item.id], serialNumber: event.target.value } }))} /></label><label>Tanggal kedaluwarsa<input type="date" value={receiveInfo[item.id]?.expiresAt || ''} onChange={(event) => setReceiveInfo((current) => ({ ...current, [item.id]: { ...current[item.id], expiresAt: event.target.value } }))} /></label></>}</div>)}<p className="muted">Jumlah 0 akan melewati produk tersebut. Stok bertambah saat penerimaan disimpan.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setReceiving(null)}>Batal</button><button type="submit" className="primary-button" disabled={saving || !Object.values(receiveQuantities).some((quantity) => Number(quantity) > 0)}>{saving ? 'Menyimpan...' : 'Catat penerimaan'}</button></div></form></div>}
  </>
}

function CustomersView({ customers, canManage, onSave, onDelete }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [pending, setPending] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', notes: '' })
  const filtered = customers.filter((customer) => `${customer.name} ${customer.email || ''} ${customer.phone || ''}`.toLowerCase().includes(query.toLowerCase()))
  const openCreate = () => { setEditingId(null); setForm({ name: '', email: '', phone: '', address: '', notes: '' }); setIsOpen(true) }
  const openEdit = (customer) => { setEditingId(customer.id); setForm({ ...customer }); setIsOpen(true) }
  const submit = async (event) => { event.preventDefault(); const ok = await onSave(form, editingId); if (ok) setIsOpen(false) }

  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Customers</span></p><h1>Customer management</h1></div>{canManage && <button className="primary-button" onClick={openCreate}><CirclePlus size={18} /> Tambah pelanggan</button>}</header>
    <section className="welcome-row"><div><p className="muted">Customer directory</p><h2>Pelanggan</h2><p className="muted">Data pelanggan untuk pesanan dan riwayat penjualan.</p></div><div className="sync-status"><span className="pulse"></span> PostgreSQL synced</div></section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Semua pelanggan</h2><p className="muted">{customers.length} pelanggan terdaftar.</p></div></div><div className="toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari pelanggan..." /></label></div><div className="table-wrap"><table><thead><tr><th>Pelanggan</th><th>Email</th><th>Telepon</th><th>Alamat</th><th>Pesanan</th>{canManage && <th><span className="sr-only">Aksi</span></th>}</tr></thead><tbody>{filtered.map((customer) => <tr key={customer.id}><td><div className="product-cell"><span className="user-avatar"><UserRound size={16} /></span><strong>{customer.name}</strong></div></td><td>{customer.email || '—'}</td><td>{customer.phone || '—'}</td><td>{customer.address || '—'}</td><td>{customer.orderCount || 0}</td>{canManage && <td><div className="actions"><button title="Edit pelanggan" onClick={() => openEdit(customer)}><Pencil size={16} /></button><button title="Hapus pelanggan" onClick={() => setPending(customer)}><Trash2 size={16} /></button></div></td>}</tr>)}{filtered.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="empty-state">Pelanggan tidak ditemukan.</td></tr>}</tbody></table></div><div className="table-footer"><span>Menampilkan <b>{filtered.length}</b> dari <b>{customers.length}</b> pelanggan</span></div></section>
    {isOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}><form className="modal" onSubmit={submit}><div className="modal-heading"><div><h2>{editingId ? 'Edit pelanggan' : 'Tambah pelanggan'}</h2><p className="muted">Informasi kontak dan pengiriman pelanggan.</p></div><button type="button" className="close-button" onClick={() => setIsOpen(false)}><X size={19} /></button></div><label>Nama pelanggan<input required maxLength="160" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Email<input type="email" value={form.email || ''} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Telepon<input value={form.phone || ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Alamat<textarea rows="2" value={form.address || ''} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label><label>Catatan<textarea rows="2" value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>Batal</button><button type="submit" className="primary-button">{editingId ? 'Simpan perubahan' : 'Tambah pelanggan'}</button></div></form></div>}
    {pending && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPending(null)}><div className="modal"><div className="modal-heading"><div><h2>Hapus pelanggan?</h2><p className="muted">Pesanan lama akan tetap menyimpan nama pelanggan.</p></div><button type="button" className="close-button" onClick={() => setPending(null)}><X size={19} /></button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPending(null)}>Batal</button><button type="button" className="danger-button" onClick={async () => { const ok = await onDelete(pending.id); if (ok) setPending(null) }}><Trash2 size={15} /> Hapus</button></div></div></div>}
  </>
}

function SalesView({ sales, customers, products, onCreate, onCancel, onReturn, onPayment }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPos, setIsPos] = useState(false)
  const [barcodeCode, setBarcodeCode] = useState('')
  const [scanError, setScanError] = useState('')
  const [receiving, setReceiving] = useState(null)
  const [invoice, setInvoice] = useState(null)
  const [paying, setPaying] = useState(null)
  const [form, setForm] = useState({ customerId: '', notes: '', items: [{ productId: '', quantity: '1' }] })
  const [returnQuantities, setReturnQuantities] = useState({})
  const [saving, setSaving] = useState(false)
  const [pendingCancel, setPendingCancel] = useState(null)
  const [paymentForm, setPaymentForm] = useState({ kind: 'payment', amount: '', method: 'cash', reference: '', notes: '' })
  const [cashSessionIsOpen, setCashSessionIsOpen] = useState(false)
  useEffect(() => {
    let active = true
    const refreshCash = () => fetch(`${API_URL}/cash-sessions`, { headers: authHeaders() }).then((response) => response.json()).then((result) => { if (active) setCashSessionIsOpen(Boolean(result.activeSession)) }).catch(() => { if (active) setCashSessionIsOpen(false) })
    refreshCash()
    window.addEventListener('cash-session-updated', refreshCash)
    return () => { active = false; window.removeEventListener('cash-session-updated', refreshCash) }
  }, [])
  const cashSessionOpen = cashSessionIsOpen
  const openCreate = (pos = false) => { if (pos && !cashSessionIsOpen) return; setIsPos(pos); setBarcodeCode(''); setScanError(''); setForm({ customerId: customers[0] ? String(customers[0].id) : '', notes: '', items: [{ productId: '', quantity: '1' }] }); setIsOpen(true) }
  const updateItem = (index, key, value) => setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }))
  const getProduct = (id) => products.find((product) => product.id === Number(id))
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    const result = await onCreate({ ...form, customerId: form.customerId ? Number(form.customerId) : null, items: form.items.map((item) => ({ productId: Number(item.productId), quantity: Number(item.quantity) })), ...(isPos ? { checkoutPaymentMethod: 'cash' } : {}) })
    setSaving(false)
    if (result) {
      setIsOpen(false)
    }
  }
  const scanProduct = async () => {
    const code = barcodeCode.trim()
    if (!code) return
    try {
      const response = await fetch(`${API_URL}/products/lookup/${encodeURIComponent(code)}`, { headers: authHeaders() })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Produk tidak ditemukan.')
      setForm((current) => {
        const index = current.items.findIndex((item) => Number(item.productId) === result.id)
        if (index < 0) return { ...current, items: [...current.items.filter((item) => item.productId), { productId: String(result.id), quantity: '1' }] }
        return { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: String(Number(item.quantity) + 1) } : item) }
      })
      setScanError('')
      setBarcodeCode('')
    } catch (error) { setScanError(error.message || 'Produk tidak ditemukan.') }
  }
  const openReturn = (order) => {
    setReceiving(order)
    setReturnQuantities(Object.fromEntries(order.items.filter((item) => item.quantity > item.returnedQuantity).map((item) => [item.id, String(item.quantity - item.returnedQuantity)])))
  }
  const submitReturn = async (event) => {
    event.preventDefault()
    setSaving(true)
    const items = receiving.items.map((item) => ({ itemId: item.id, quantity: Number(returnQuantities[item.id] || 0) })).filter((item) => item.quantity > 0)
    const ok = await onReturn(receiving.id, items)
    setSaving(false)
    if (ok) setReceiving(null)
  }
  const openPayment = (order) => {
    const kind = order.refundDue > 0 ? 'refund' : 'payment'
    const remaining = kind === 'refund' ? order.refundDue : order.balanceDue
    setPaymentForm({ kind, amount: remaining > 0 ? remaining.toFixed(2) : '', method: cashSessionIsOpen ? 'cash' : 'bank_transfer', reference: '', notes: '' })
    setPaying(order)
  }
  const submitPayment = async (event) => {
    event.preventDefault()
    setSaving(true)
    const ok = await onPayment(paying.id, paymentForm)
    setSaving(false)
    if (ok) setPaying(null)
  }
  const statusLabels = { confirmed: 'Dikonfirmasi', partially_returned: 'Retur sebagian', returned: 'Diretur', cancelled: 'Dibatalkan' }
  const paymentLabels = { unpaid: 'Belum dibayar', partial: 'Sebagian', paid: 'Lunas', refund_due: 'Perlu refund', partially_refunded: 'Refund sebagian', refunded: 'Dikembalikan' }
  const paymentStatusClass = { unpaid: 'cancelled', partial: 'partially_received', paid: 'received', refund_due: 'cancelled', partially_refunded: 'partially_received', refunded: 'received' }
  const total = (order) => order.status === 'cancelled' ? 0 : order.items.reduce((sum, item) => sum + (item.quantity - item.returnedQuantity) * item.unitPrice, 0)

  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Sales</span></p><h1>Sales orders</h1></div><div className="panel-heading-actions"><button className="secondary-button" onClick={() => openCreate(true)} disabled={products.length === 0 || !cashSessionIsOpen}><ShoppingCart size={16} /> POS cepat</button><button className="primary-button" onClick={() => openCreate()} disabled={customers.length === 0 || products.length === 0}><CirclePlus size={18} /> Buat pesanan</button></div></header>
    {!cashSessionIsOpen && <section className="catalog-panel empty-hint">Buka sesi kas harian dari toolbar Fitur sebelum menggunakan POS atau mencatat pembayaran tunai.</section>}
    <section className="welcome-row"><div><p className="muted">Orders & customers</p><h2>Penjualan</h2><p className="muted">Stok berkurang saat pesanan dibuat; retur dan pembatalan tercatat pada stock log.</p></div><div className="sync-status"><span className="pulse"></span> PostgreSQL synced</div></section>
    {customers.length === 0 && <section className="catalog-panel empty-hint">Tambahkan pelanggan terlebih dahulu sebelum membuat pesanan.</section>}
    {invoice && <div className="modal-backdrop invoice-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setInvoice(null)}><section className="modal invoice-print"><header className="invoice-heading"><div><p className="eyebrow">Ifal Store</p><h2>INVOICE</h2><strong>{invoice.invoiceNumber}</strong></div><button type="button" className="close-button no-print" onClick={() => setInvoice(null)}><X size={19} /></button></header><div className="invoice-meta"><div><span>Tagihan kepada</span><strong>{invoice.customerName}</strong>{invoice.customerEmail && <span>{invoice.customerEmail}</span>}{invoice.customerPhone && <span>{invoice.customerPhone}</span>}</div><div><span>Nomor invoice</span><strong>{invoice.invoiceNumber}</strong><span>Tanggal: {new Date(invoice.createdAt).toLocaleDateString('id-ID')}</span><span>Status: {statusLabels[invoice.status]}</span></div></div><div className="table-wrap"><table><thead><tr><th>Produk</th><th>SKU</th><th>Qty</th><th>Harga</th><th>Subtotal</th></tr></thead><tbody>{invoice.items.map((item) => <tr key={item.id}><td>{item.productName}{item.returnedQuantity > 0 && <small className="field-hint">Retur {item.returnedQuantity} unit</small>}</td><td>{item.sku || '—'}</td><td>{item.quantity - item.returnedQuantity}</td><td>{formatIDR(item.unitPrice)}</td><td>{formatIDR((item.quantity - item.returnedQuantity) * item.unitPrice)}</td></tr>)}</tbody></table></div><div className="invoice-totals"><p><span>Total invoice</span><strong>{formatIDR(invoice.totalAmount)}</strong></p><p><span>Pembayaran bersih</span><strong>{formatIDR(invoice.paidAmount - invoice.refundedAmount)}</strong></p><p><span>Sisa tagihan</span><strong>{formatIDR(invoice.balanceDue)}</strong></p><p><span>Status pembayaran</span><strong>{paymentLabels[invoice.paymentStatus]}</strong></p></div><div className="invoice-payments"><h3>Riwayat pembayaran</h3>{invoice.payments.length ? invoice.payments.map((payment) => <p key={payment.id}><span>{payment.kind === 'refund' ? 'Refund' : 'Pembayaran'} · {new Date(payment.createdAt).toLocaleString('id-ID')} · {payment.method.replace('_', ' ')}</span><strong>{payment.kind === 'refund' ? '−' : ''}{formatIDR(payment.amount)}</strong></p>) : <p>Belum ada pembayaran.</p>}</div>{invoice.notes && <p className="invoice-note">Catatan: {invoice.notes}</p>}<div className="modal-actions no-print"><button type="button" className="secondary-button" onClick={() => setInvoice(null)}>Tutup</button><button type="button" className="primary-button" onClick={() => window.print()}><Printer size={16} /> Cetak / Simpan PDF</button></div></section></div>}
    <section className="catalog-panel"><div className="panel-heading"><div><h2>Semua pesanan</h2><p className="muted">{sales.length} pesanan tercatat.</p></div></div><div className="table-wrap"><table><thead><tr><th>No. pesanan</th><th>Pelanggan</th><th>Produk</th><th>Total</th><th>Status</th><th>Pembayaran</th><th>Tanggal</th><th>Aksi</th></tr></thead><tbody>{sales.map((order) => <tr key={order.id}><td><strong>{order.orderNumber}</strong></td><td>{order.customerName}</td><td>{order.items.map((item) => `${item.productName} (${item.quantity - item.returnedQuantity}/${item.quantity})`).join(', ')}</td><td className="price">{formatIDR(total(order))}</td><td><span className={`purchase-status ${order.status}`}>{statusLabels[order.status]}</span></td><td><span className={`purchase-status ${paymentStatusClass[order.paymentStatus]}`}>{paymentLabels[order.paymentStatus]}</span><small className="field-hint">Dibayar {formatIDR(order.paidAmount - order.refundedAmount)}</small></td><td>{new Date(order.createdAt).toLocaleDateString('id-ID')}</td><td><div className="actions"><button title="Lihat / cetak invoice" onClick={() => setInvoice(order)}><Printer size={16} /></button>{(order.balanceDue > 0 && !['cancelled', 'returned'].includes(order.status) || order.refundDue > 0) && <button title="Catat pembayaran atau refund" onClick={() => openPayment(order)}><CreditCard size={16} /></button>}{!['cancelled', 'returned'].includes(order.status) && <><button title="Catat retur" onClick={() => openReturn(order)}><RotateCcw size={16} /></button><button title="Batalkan pesanan" onClick={() => setPendingCancel(order)}><X size={16} /></button></>}</div></td></tr>)}{sales.length === 0 && <tr><td colSpan="8" className="empty-state">Belum ada pesanan penjualan.</td></tr>}</tbody></table></div></section>
    {isOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}><form className="modal purchase-modal" onSubmit={submit}><div className="modal-heading"><div><h2>{isPos ? 'Kasir POS cepat' : 'Buat pesanan penjualan'}</h2><p className="muted">{isPos ? 'Scan barcode untuk menambahkan produk. Pembayaran dicatat tunai saat checkout.' : 'Stok akan dikurangi setelah pesanan disimpan.'}</p></div><button type="button" className="close-button" onClick={() => setIsOpen(false)}><X size={19} /></button></div>{isPos && <><label>Scan barcode / SKU<div className="pos-scan-form"><input autoFocus value={barcodeCode} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); scanProduct() } }} onChange={(event) => setBarcodeCode(event.target.value)} placeholder="Scan lalu tekan Enter" /><button type="button" className="secondary-button" onClick={scanProduct}>Tambah</button></div></label>{scanError && <p className="login-error">{scanError}</p>}</>}<label>Pelanggan<select required={!isPos} value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}><option value="">{isPos ? 'Pelanggan umum' : 'Pilih pelanggan'}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>{form.items.map((item, index) => { const product = getProduct(item.productId); return <div className="purchase-item-form" key={index}><label>Produk<select required value={item.productId} onChange={(event) => updateItem(index, 'productId', event.target.value)}><option value="">Pilih produk</option>{products.map((productOption) => <option key={productOption.id} value={productOption.id} disabled={productOption.stock < 1 || form.items.some((candidate, candidateIndex) => candidateIndex !== index && Number(candidate.productId) === productOption.id)}>{productOption.name} · stok {productOption.stock}</option>)}</select></label><label>Jumlah<input required type="number" min="1" max={product?.stock || 1} step="1" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} /></label><label>Harga/unit<input readOnly value={product ? formatIDR(product.price) : 'Pilih produk'} /></label>{form.items.length > 1 && <button type="button" className="remove-media" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}><X size={14} /> Hapus baris</button>}</div>})}<button type="button" className="secondary-button" onClick={() => setForm((current) => ({ ...current, items: [...current.items, { productId: '', quantity: '1' }] }))}>Tambah produk</button>{isPos && <div className="pos-total"><span>Total</span><strong>{formatIDR(form.items.reduce((sum, item) => sum + (getProduct(item.productId)?.price || 0) * Number(item.quantity || 0), 0))}</strong></div>}<label>Catatan<textarea rows="2" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>Batal</button><button type="submit" className="primary-button" disabled={saving || (!isPos && !form.customerId) || form.items.some((item) => !getProduct(item.productId) || Number(item.quantity) < 1 || Number(item.quantity) > getProduct(item.productId).stock)}>{saving ? 'Menyimpan...' : isPos ? 'Checkout & bayar tunai' : 'Simpan pesanan'}</button></div></form></div>}
    {receiving && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setReceiving(null)}><form className="modal purchase-modal" onSubmit={submitReturn}><div className="modal-heading"><div><h2>Retur pesanan</h2><p className="muted">{receiving.orderNumber} · {receiving.customerName}</p></div><button type="button" className="close-button" onClick={() => setReceiving(null)}><X size={19} /></button></div>{receiving.items.filter((item) => item.quantity > item.returnedQuantity).map((item) => <label key={item.id}>{item.productName}<small className="field-hint">Belum diretur {item.quantity - item.returnedQuantity} unit</small><input type="number" min="0" max={item.quantity - item.returnedQuantity} step="1" value={returnQuantities[item.id] || ''} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></label>)}<p className="muted">Barang retur akan dikembalikan ke stok.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setReceiving(null)}>Batal</button><button type="submit" className="primary-button" disabled={saving || !Object.values(returnQuantities).some((quantity) => Number(quantity) > 0)}>{saving ? 'Menyimpan...' : 'Catat retur'}</button></div></form></div>}
    {paying && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPaying(null)}><form className="modal purchase-modal" onSubmit={submitPayment}><div className="modal-heading"><div><h2>{paymentForm.kind === 'refund' ? 'Catat refund' : 'Catat pembayaran'}</h2><p className="muted">{paying.invoiceNumber} · Total {formatIDR(paying.totalAmount)} · {paymentForm.kind === 'refund' ? `Dana berlebih ${formatIDR(paying.refundDue)}` : `Sisa ${formatIDR(paying.balanceDue)}`}</p></div><button type="button" className="close-button" onClick={() => setPaying(null)}><X size={19} /></button></div><label>Jenis<select value={paymentForm.kind} onChange={(event) => setPaymentForm({ ...paymentForm, kind: event.target.value, amount: '' })}><option value="payment" disabled={['cancelled', 'returned'].includes(paying.status)}>Pembayaran masuk</option>{paying.refundDue > 0 && <option value="refund">Pengembalian dana</option>}</select></label><label>Jumlah (Rp)<input required type="number" min="0.01" max={paymentForm.kind === 'refund' ? paying.refundDue : paying.balanceDue} step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label><label>Metode<select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}><option value="cash" disabled={!cashSessionOpen}>Tunai{cashSessionOpen ? '' : ' (buka sesi kas)'}</option><option value="bank_transfer">Transfer bank</option><option value="qris">QRIS</option><option value="card">Kartu</option><option value="other">Lainnya</option></select></label><label>Referensi transaksi<input maxLength="120" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} placeholder="Opsional" /></label><label>Catatan<textarea rows="2" maxLength="500" value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPaying(null)}>Batal</button><button type="submit" className="primary-button" disabled={saving || Number(paymentForm.amount) <= 0 || Number(paymentForm.amount) > (paymentForm.kind === 'refund' ? paying.refundDue : paying.balanceDue)}>{saving ? 'Menyimpan...' : 'Simpan'}</button></div></form></div>}
    {pendingCancel && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingCancel(null)}><div className="modal"><div className="modal-heading"><div><h2>Batalkan pesanan?</h2><p className="muted">Stok yang belum diretur akan dikembalikan. Aksi ini tercatat pada stock log. Dana yang sudah diterima perlu direfund secara terpisah.</p></div><button type="button" className="close-button" onClick={() => setPendingCancel(null)}><X size={19} /></button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPendingCancel(null)}>Kembali</button><button type="button" className="danger-button" onClick={async () => { const ok = await onCancel(pendingCancel.id); if (ok) setPendingCancel(null) }}>Batalkan pesanan</button></div></div></div>}
  </>
}

function ProfileView({ user, onSaveProfile, onChangePassword, onAvatarError }) {
  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', newPasswordConfirmation: '' })
  const [savingPassword, setSavingPassword] = useState(false)
  const [savingAvatar, setSavingAvatar] = useState(false)
  useEffect(() => { setProfile({ name: user?.name || '', email: user?.email || '' }) }, [user?.name, user?.email])
  const profileDirty = profile.name !== (user?.name || '') || profile.email.toLowerCase() !== (user?.email || '').toLowerCase()
  const submitProfile = async (event) => {
    event.preventDefault()
    setSavingProfile(true)
    await onSaveProfile({ name: profile.name.trim(), email: profile.email.trim() })
    setSavingProfile(false)
  }
  const submitPassword = async (event) => {
    event.preventDefault()
    setSavingPassword(true)
    const ok = await onChangePassword(passwords)
    setSavingPassword(false)
    if (ok) setPasswords({ currentPassword: '', newPassword: '', newPasswordConfirmation: '' })
  }
  const handleAvatarChange = (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { onAvatarError('Avatar harus berupa gambar.'); return }
    if (file.size > 2 * 1024 * 1024) { onAvatarError('Ukuran gambar maksimal 2 MB.'); return }
    const reader = new FileReader()
    reader.onload = async () => { setSavingAvatar(true); await onSaveProfile({ name: user.name, email: user.email, avatarUrl: reader.result }); setSavingAvatar(false) }
    reader.readAsDataURL(file)
  }
  const removeAvatar = async () => { setSavingAvatar(true); await onSaveProfile({ name: user.name, email: user.email, avatarUrl: null }); setSavingAvatar(false) }
  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Profile</span></p><h1>My profile</h1></div></header>
    <section className="welcome-row"><div className="profile-headline"><Avatar user={user} className="xl" /><div><p className="muted">Account</p><h2>{user?.name || 'User'}</h2><div className="avatar-actions"><label className="secondary-button avatar-upload">{savingAvatar ? 'Uploading...' : <><Upload size={14} /> {user?.avatarUrl ? 'Change photo' : 'Upload photo'}</>}<input type="file" accept="image/*" onChange={handleAvatarChange} disabled={savingAvatar} /></label>{user?.avatarUrl && <button type="button" className="secondary-button" onClick={removeAvatar} disabled={savingAvatar}><X size={14} /> Remove</button>}</div></div></div><div className="profile-identity"><span className={`role-badge ${user?.role}`}><ShieldCheck size={13} /> {user?.role}</span></div></section>
    <div className="profile-grid">
      <section className="catalog-panel"><div className="panel-heading"><div><h2>Account details</h2><p className="muted">Perbarui nama dan email akun Anda.</p></div></div><form className="profile-form" onSubmit={submitProfile}><label>Full name<input required value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="Nama lengkap" /></label><label>Email address<input required type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} placeholder="you@company.com" /></label><div className="field-static"><span className="muted">Role</span><strong className="role-static"><ShieldCheck size={14} /> {user?.role} <small className="muted">(diatur oleh admin)</small></strong></div><div className="modal-actions"><button type="submit" className="primary-button" disabled={!profileDirty || savingProfile}><Save size={16} /> {savingProfile ? 'Saving...' : 'Save changes'}</button></div></form></section>
      <section className="catalog-panel"><div className="panel-heading"><div><h2>Change password</h2><p className="muted">Verifikasi password lama untuk menetapkan yang baru.</p></div></div><form className="profile-form" onSubmit={submitPassword}><label>Current password<input required type="password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} placeholder="Password saat ini" /></label><label>New password<input required minLength="8" type="password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} placeholder="Minimal 8 karakter" /></label><label>Confirm new password<input required minLength="8" type="password" value={passwords.newPasswordConfirmation} onChange={(event) => setPasswords({ ...passwords, newPasswordConfirmation: event.target.value })} placeholder="Ulangi password baru" /></label><div className="modal-actions"><button type="submit" className="primary-button" disabled={savingPassword}><KeyRound size={16} /> {savingPassword ? 'Saving...' : 'Update password'}</button></div></form></section>
    </div>
  </>
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('lumina-auth') === 'true' && Boolean(localStorage.getItem('lumina-token')))
  const [currentUser, setCurrentUser] = useState(() => JSON.parse(localStorage.getItem('lumina-user') || 'null'))
  const isAdmin = currentUser?.role === 'admin'
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [otpStep, setOtpStep] = useState(false)
  const [otp, setOtp] = useState('')
  const [resetStep, setResetStep] = useState(false)
  const [resetOtp, setResetOtp] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState('')
  const [registerStep, setRegisterStep] = useState(false)
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '', passwordConfirmation: '' })
  const [registerOtp, setRegisterOtp] = useState('')
  const [products, setProducts] = useState(() => JSON.parse(localStorage.getItem('lumina-products') || 'null') || seedProducts)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All status')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [category, setCategory] = useState('All categories')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 8
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankForm)
  const [databaseOnline, setDatabaseOnline] = useState(false)
  const [stats, setStats] = useState(null)
  const [navigationCounts, setNavigationCounts] = useState(null)
  const [navigationCountsRefresh, setNavigationCountsRefresh] = useState(0)
  const [users, setUsers] = useState([])
  const [categoryList, setCategoryList] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [warehouseRefresh, setWarehouseRefresh] = useState(0)
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')
  const [cashSession, setCashSession] = useState(null)
  const [cashSessionRefresh, setCashSessionRefresh] = useState(0)
  const [purchases, setPurchases] = useState([])
  const [customers, setCustomers] = useState([])
  const [sales, setSales] = useState([])
  const [toasts, setToasts] = useState([])
  const [pendingProduct, setPendingProduct] = useState(null)
  const [activeView, setActiveView] = useState('dashboard')
  const [archivedProducts, setArchivedProducts] = useState([])
  const [pendingPermanent, setPendingPermanent] = useState(null)
  const [movements, setMovements] = useState([])
  const [stockLog, setStockLog] = useState([])
  const [bellOpen, setBellOpen] = useState(false)
  const [importRows, setImportRows] = useState(null)
  const [featureView, setFeatureView] = useState('')
  const pushToast = (type, message) => { const id = Date.now() + Math.random(); setToasts((list) => [...list, { id, type, message }]); setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 4000) }
  useEffect(() => { if (!isAdmin && (activeView === 'users' || activeView === 'stock-log')) setActiveView('products') }, [isAdmin, activeView])
  useEffect(() => localStorage.setItem('lumina-products', JSON.stringify(products)), [products])
  useEffect(() => {
    if (!isAuthenticated) return
    fetch(`${API_URL}/products`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('API unavailable'); return response.json() }).then((data) => { setProducts(data); setDatabaseOnline(true) }).catch(() => setDatabaseOnline(false))
  }, [isAuthenticated])
  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return
    fetch(`${API_URL}/users`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('API unavailable'); return response.json() }).then((data) => { setUsers(data); setDatabaseOnline(true) }).catch(() => setDatabaseOnline(false))
  }, [isAuthenticated, isAdmin])
  useEffect(() => {
    if (!isAuthenticated) return
    fetch(`${API_URL}/categories`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('API unavailable'); return response.json() }).then((data) => { setCategoryList(data); setDatabaseOnline(true) }).catch(() => setDatabaseOnline(false))
  }, [isAuthenticated])
  useEffect(() => {
    if (!isAuthenticated) return
    fetch(`${API_URL}/warehouses`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('API unavailable'); return response.json() }).then((data) => { setWarehouses(data); setSelectedWarehouseId((current) => current || String(data.find((item) => item.isDefault)?.id || data[0]?.id || '')) }).catch((error) => pushToast('error', error.message || 'Gagal memuat gudang.'))
  }, [isAuthenticated, warehouseRefresh])
  useEffect(() => {
    if (!isAuthenticated) return
    let active = true
    fetch(`${API_URL}/cash-sessions`, { headers: authHeaders() })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Gagal memuat sesi kas.'); return result })
      .then((result) => { if (active) setCashSession(result.activeSession) })
      .catch((error) => { if (active) pushToast('error', error.message || 'Gagal memuat sesi kas.') })
    return () => { active = false }
  }, [isAuthenticated, cashSessionRefresh])
  useEffect(() => {
    if (!isAuthenticated || activeView !== 'archive') return
    fetch(`${API_URL}/products/archived`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : []).then((data) => { setArchivedProducts(Array.isArray(data) ? data : []); setDatabaseOnline(true) }).catch(() => { setArchivedProducts([]); setDatabaseOnline(false) })
  }, [isAuthenticated, activeView])
  useEffect(() => {
    if (!isAuthenticated || !isAdmin || activeView !== 'stock-log') return
    fetch(`${API_URL}/stock-movements`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : []).then((data) => { setStockLog(Array.isArray(data) ? data : []); setDatabaseOnline(true) }).catch(() => { setStockLog([]); setDatabaseOnline(false) })
  }, [isAuthenticated, isAdmin, activeView])
  useEffect(() => {
    if (!isAuthenticated) return
    let active = true
    fetch(`${API_URL}/navigation-counts`, { headers: authHeaders() })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.message || 'Gagal memuat jumlah data menu.')
        return result
      })
      .then((result) => { if (active) setNavigationCounts(result) })
      .catch((error) => { if (active) pushToast('error', error.message || 'Gagal memuat jumlah data menu.') })
    return () => { active = false }
  }, [isAuthenticated, navigationCountsRefresh])
  useEffect(() => {
    if (!isAuthenticated || activeView !== 'dashboard') return
    fetch(`${API_URL}/stats`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((data) => { if (data) { setStats(data); setDatabaseOnline(true) } }).catch(() => setDatabaseOnline(false))
  }, [isAuthenticated, activeView])
  const categories = useMemo(() => ['All categories', ...new Set(products.map((product) => product.category))], [products])
  // Form options come from the Categories module when available; fall back to defaults + in-use
  // values when the API is offline so the product form still works in local mode.
  const formCategories = useMemo(() => {
    const base = categoryList.length ? categoryList.map((item) => item.name) : defaultCategories
    return [...new Set([...base, ...products.map((product) => product.category)])].filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [categoryList, products])
  const filteredProducts = useMemo(() => products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All status' || product.status === filter) && (category === 'All categories' || product.category === category) && (priceMin === '' || product.price >= Number(priceMin)) && (priceMax === '' || product.price <= Number(priceMax))), [products, query, filter, category, priceMin, priceMax])
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize))
  const pagedProducts = useMemo(() => filteredProducts.slice((page - 1) * pageSize, page * pageSize), [filteredProducts, page])
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])
  const totalValue = products.reduce((sum, product) => sum + product.price * product.stock, 0)
  const activeProducts = products.filter((product) => product.status === 'Active').length
  const lowStock = products.filter((product) => product.status === 'Low stock' || product.stock === 0).length
  const lowOrOut = useMemo(() => products.filter((product) => product.stock === 0 || product.stock <= (product.lowStockThreshold ?? LOW_STOCK_THRESHOLD) || product.status === 'Low stock'), [products])
  const categoryCount = new Set(products.map((product) => product.category)).size
  const avgPrice = products.length ? products.reduce((sum, product) => sum + product.price, 0) / products.length : 0
  const now = new Date()
  const todayLabel = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = (currentUser?.name || 'there').split(' ')[0]
  useEffect(() => {
    if (!isAuthenticated || !['suppliers', 'purchases'].includes(activeView)) return
    fetch(`${API_URL}/suppliers`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('Gagal memuat pemasok.'); return response.json() }).then((data) => { setSuppliers(data); setDatabaseOnline(true) }).catch((error) => { setDatabaseOnline(false); pushToast('error', error.message || 'Gagal memuat pemasok.') })
  }, [isAuthenticated, activeView])
  useEffect(() => {
    if (!isAuthenticated || activeView !== 'purchases') return
    fetch(`${API_URL}/purchases`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('Gagal memuat pesanan pembelian.'); return response.json() }).then((data) => { setPurchases(data); setDatabaseOnline(true) }).catch((error) => { setDatabaseOnline(false); pushToast('error', error.message || 'Gagal memuat pesanan pembelian.') })
  }, [isAuthenticated, activeView])
  useEffect(() => {
    if (!isAuthenticated || !['customers', 'sales'].includes(activeView)) return
    fetch(`${API_URL}/customers`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('Gagal memuat pelanggan.'); return response.json() }).then((data) => { setCustomers(data); setDatabaseOnline(true) }).catch((error) => { setDatabaseOnline(false); pushToast('error', error.message || 'Gagal memuat pelanggan.') })
  }, [isAuthenticated, activeView])
  useEffect(() => {
    if (!isAuthenticated || activeView !== 'sales') return
    fetch(`${API_URL}/sales`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('Gagal memuat pesanan penjualan.'); return response.json() }).then((data) => { setSales(data); setDatabaseOnline(true) }).catch((error) => { setDatabaseOnline(false); pushToast('error', error.message || 'Gagal memuat pesanan penjualan.') })
  }, [isAuthenticated, activeView])
  const completeLogin = (user, token) => {
    localStorage.setItem('lumina-auth', 'true')
    localStorage.setItem('lumina-user', JSON.stringify(user))
    localStorage.setItem('lumina-token', token)
    setCurrentUser(user)
    setIsAuthenticated(true)
    setLoginError('')
  }
  const handleLogin = async (event) => {
    event.preventDefault()
    try {
      const response = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(loginForm) })
      if (!response.ok) { const error = await response.json(); throw new Error(error.message) }
      const result = await response.json()
      if (result.requiresOtp) { setOtpStep(true); setLoginError(''); return }
      completeLogin(result.user, result.token)
    } catch (error) { setLoginError(error.message || 'Login gagal. Pastikan API aktif.') }
  }
  const handleVerifyOtp = async (event) => {
    event.preventDefault()
    try {
      const response = await fetch(`${API_URL}/auth/otp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: loginForm.email, otp }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      completeLogin(result.user, result.token)
    } catch (error) { setLoginError(error.message || 'Verifikasi OTP gagal.') }
  }
  const resendOtp = async () => {
    const response = await fetch(`${API_URL}/auth/otp/resend`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: loginForm.email }) })
    const result = await response.json()
    setLoginError(response.ok ? result.message : result.message || 'OTP gagal dikirim ulang.')
  }
  const requestPasswordReset = async (event) => {
    event.preventDefault()
    const response = await fetch(`${API_URL}/auth/password/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: loginForm.email }) })
    const result = await response.json()
    if (response.ok) setResetStep(true)
    setLoginError(result.message || 'Permintaan reset password gagal.')
  }
  const resetPasswordWithOtp = async (event) => {
    event.preventDefault()
    const response = await fetch(`${API_URL}/auth/password/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: loginForm.email, otp: resetOtp, password: resetPassword, password_confirmation: resetPasswordConfirmation }) })
    const result = await response.json()
    if (!response.ok) { setLoginError(result.message || 'Reset password gagal.'); return }
    setResetStep(false)
    setResetOtp('')
    setResetPassword('')
    setResetPasswordConfirmation('')
    setLoginError(result.message)
  }
  const handleRegister = async (event) => {
    event.preventDefault()
    const response = await fetch(`${API_URL}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ name: registerForm.name, email: registerForm.email, password: registerForm.password, password_confirmation: registerForm.passwordConfirmation }) })
    const result = await response.json()
    if (!response.ok) { setLoginError(result.message || 'Pendaftaran gagal. Pastikan API aktif.'); return }
    setRegisterStep('otp')
    setLoginError('')
  }
  const verifyRegisterOtp = async (event) => {
    event.preventDefault()
    try {
      const response = await fetch(`${API_URL}/auth/register/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: registerForm.email, otp: registerOtp }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      completeLogin(result.user, result.token)
    } catch (error) { setLoginError(error.message || 'Verifikasi OTP gagal.') }
  }
  const resendRegisterOtp = async () => {
    const response = await fetch(`${API_URL}/auth/register/resend`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: registerForm.email }) })
    const result = await response.json()
    setLoginError(response.ok ? result.message : result.message || 'OTP gagal dikirim ulang.')
  }
  const handleLogout = () => { localStorage.removeItem('lumina-auth'); localStorage.removeItem('lumina-user'); localStorage.removeItem('lumina-token'); setCurrentUser(null); setIsAuthenticated(false); setCashSession(null); setLoginForm({ email: '', password: '' }); setOtp(''); setOtpStep(false); setRegisterStep(false); setRegisterForm({ name: '', email: '', password: '', passwordConfirmation: '' }); setRegisterOtp('') }
  const openCreateModal = () => { setEditingId(null); setForm(blankForm); setMovements([]); setIsModalOpen(true) }
  const openEditModal = (product) => { setEditingId(product.id); setForm({ ...product, price: String(product.price), stock: String(product.stock), sku: product.sku || '', lowStockThreshold: product.lowStockThreshold ?? 5 }); setMovements([]); setIsModalOpen(true); fetch(`${API_URL}/products/${product.id}/movements`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : []).then((data) => setMovements(Array.isArray(data) ? data : [])).catch(() => setMovements([])) }
  const buildProductsCsv = (list) => { const esc = (value) => `"${String(value).replace(/"/g, '""')}"`; const rows = [['Name', 'Category', 'Price', 'Stock', 'Status', 'SKU', 'Low Stock Threshold', 'Created At', 'Updated At'], ...list.map((product) => [product.name, product.category, product.price, product.stock, product.status, product.sku || '', product.lowStockThreshold ?? '', product.createdAt ?? '', product.updatedAt ?? ''])]; return rows.map((row) => row.map(esc).join(',')).join('\n') }
  const downloadCsv = (csv, filename) => { const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url) }
  const exportCsv = () => downloadCsv(buildProductsCsv(filteredProducts), `products-${new Date().toISOString().slice(0, 10)}.csv`)
  const exportAllCsv = () => downloadCsv(buildProductsCsv(products), `products-all-${new Date().toISOString().slice(0, 10)}.csv`)
  const handleMediaChange = (event) => {
    const file = event.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { pushToast('error', 'Ukuran file maksimal 5 MB.'); event.target.value = ''; return }
    const reader = new FileReader()
    reader.onload = () => setForm((current) => ({ ...current, media: { name: file.name, type: file.type, url: reader.result } }))
    reader.readAsDataURL(file)
  }
  const handleSubmit = async (event) => {
    event.preventDefault()
    const stock = Number(form.stock) || 0
    const product = { ...form, price: Number(form.price) || 0, stock, status: stock === 0 ? 'Out of stock' : form.status, lowStockThreshold: Number(form.lowStockThreshold) || 5 }
    let response
    try {
      response = await fetch(`${API_URL}/products${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(product) })
    } catch {
      setProducts((current) => editingId ? current.map((item) => item.id === editingId ? { ...product, id: editingId } : item) : [{ ...product, id: Date.now() }, ...current])
      setDatabaseOnline(false)
      setIsModalOpen(false)
      pushToast('error', 'Server tidak tersedia. Produk disimpan sementara di sesi lokal.')
      return
    }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      pushToast('error', result.message || 'Produk gagal disimpan.')
      return
    }
    setProducts((current) => editingId ? current.map((item) => item.id === editingId ? result : item) : [result, ...current])
    setDatabaseOnline(true)
    setIsModalOpen(false)
    pushToast('success', editingId ? 'Produk diperbarui.' : 'Produk ditambahkan.')
  }
  const confirmDeleteProduct = async () => {
    const id = pendingProduct.id
    let response
    try {
      response = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE', headers: authHeaders() })
    } catch {
      setProducts((current) => current.filter((product) => product.id !== id))
      setDatabaseOnline(false)
      setPendingProduct(null)
      pushToast('error', 'Server tidak tersedia. Produk dihapus sementara dari sesi lokal.')
      return
    }
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      pushToast('error', result.message || 'Produk gagal dihapus.')
      return
    }
    setProducts((current) => current.filter((product) => product.id !== id))
    setDatabaseOnline(true)
    setPendingProduct(null)
    pushToast('success', 'Produk diarsipkan.')
  }
  const loadArchived = () => fetch(`${API_URL}/products/archived`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : []).then((data) => { setArchivedProducts(Array.isArray(data) ? data : []); setDatabaseOnline(true) }).catch(() => { setArchivedProducts([]); setDatabaseOnline(false) })
  const restoreProduct = async (id) => { try { const response = await fetch(`${API_URL}/products/${id}/restore`, { method: 'POST', headers: authHeaders() }); if (!response.ok) throw new Error('Restore failed'); setDatabaseOnline(true); pushToast('success', 'Produk dipulihkan.'); await loadArchived(); await refreshProducts() } catch { pushToast('error', 'Gagal memulihkan produk.') } }
  const confirmPermanentDelete = async () => { const id = pendingPermanent.id; try { const response = await fetch(`${API_URL}/products/${id}/permanent`, { method: 'DELETE', headers: authHeaders() }); if (!response.ok) throw new Error('Delete failed'); setDatabaseOnline(true); pushToast('success', 'Produk dihapus permanen.'); setArchivedProducts((current) => current.filter((product) => product.id !== id)) } catch { pushToast('error', 'Gagal menghapus permanen.') } setPendingPermanent(null) }
  const handleImportFile = (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const lines = text.split('\n').filter((line) => line.trim() !== '')
      if (lines.length < 2) { pushToast('error', 'CSV kosong atau tanpa data.'); return }
      const parseLine = (line) => { const cells = []; let value = ''; let quoted = false; for (let i = 0; i < line.length; i += 1) { const char = line[i]; if (quoted) { if (char === '"') { if (line[i + 1] === '"') { value += '"'; i += 1 } else quoted = false } else value += char } else if (char === '"') quoted = true; else if (char === ',') { cells.push(value); value = '' } else value += char } cells.push(value); return cells }
      const header = parseLine(lines[0]).map((cell) => cell.trim().toLowerCase())
      const col = (name) => header.indexOf(name)
      const idx = { name: col('name'), category: col('category'), price: col('price'), stock: col('stock'), status: col('status'), sku: col('sku') }
      const seenSku = new Map()
      const rows = lines.slice(1).map((line, rowIndex) => {
        const cells = parseLine(line)
        const at = (position) => position >= 0 ? (cells[position] ?? '').trim() : ''
        const name = at(idx.name)
        const category = at(idx.category)
        const priceRaw = at(idx.price)
        const stockRaw = at(idx.stock)
        const status = at(idx.status) || 'Active'
        const sku = at(idx.sku)
        const price = Number(priceRaw)
        const stock = Number(stockRaw)
        const errors = []
        if (!name) errors.push('Name wajib diisi')
        if (priceRaw === '' || Number.isNaN(price) || price < 0) errors.push('Price tidak valid')
        if (stockRaw === '' || Number.isNaN(stock) || !Number.isInteger(stock) || stock < 0) errors.push('Stock tidak valid')
        if (sku) { if (seenSku.has(sku)) errors.push('SKU duplikat dalam file'); else seenSku.set(sku, rowIndex) }
        return { name, category, price, stock, status: stock === 0 ? 'Out of stock' : status, sku, errors, valid: errors.length === 0 }
      })
      setImportRows(rows)
    }
    reader.readAsText(file)
  }
  const confirmImport = async () => {
    const valid = (importRows || []).filter((row) => row.valid)
    if (valid.length === 0) { pushToast('error', 'Tidak ada baris valid untuk diimpor.'); return }
    const payload = { products: valid.map((row) => ({ name: row.name, category: row.category, price: row.price, stock: row.stock, status: row.status, sku: row.sku || '' })) }
    try {
      const response = await fetch(`${API_URL}/products/bulk`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Import gagal.')
      setDatabaseOnline(true)
      pushToast('success', `${result.created?.length ?? valid.length} produk diimpor.`)
      await refreshProducts()
      setImportRows(null)
    } catch (error) { pushToast('error', error.message || 'Import gagal.') }
  }
  const saveUser = async (user, editingId) => { try { const response = await fetch(`${API_URL}/users${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(user) }); if (!response.ok) { const error = await response.json(); throw new Error(error.message) } const savedUser = await response.json(); setUsers((current) => editingId ? current.map((item) => item.id === editingId ? savedUser : item) : [savedUser, ...current]); setDatabaseOnline(true); pushToast('success', editingId ? 'User diperbarui.' : 'User ditambahkan.') } catch (error) { pushToast('error', error.message || 'User gagal disimpan.') } }
  const removeUser = async (id) => { try { const response = await fetch(`${API_URL}/users/${id}`, { method: 'DELETE', headers: authHeaders() }); if (!response.ok) throw new Error('Delete failed'); setUsers((current) => current.filter((user) => user.id !== id)); setDatabaseOnline(true); pushToast('success', 'User dihapus.') } catch { pushToast('error', 'User gagal dihapus. Pastikan API aktif.') } }
  const saveProfile = async (payload) => {
    try {
      const response = await fetch(`${API_URL}/auth/profile`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setCurrentUser(result)
      localStorage.setItem('lumina-user', JSON.stringify(result))
      setUsers((current) => current.map((item) => item.id === result.id ? { ...item, ...result } : item))
      pushToast('success', 'Profil diperbarui.')
      return true
    } catch (error) { pushToast('error', error.message || 'Profil gagal disimpan.'); return false }
  }
  const changePassword = async (payload) => {
    try {
      const response = await fetch(`${API_URL}/auth/password/change`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      pushToast('success', result.message || 'Password berhasil diperbarui.')
      return true
    } catch (error) { pushToast('error', error.message || 'Password gagal diperbarui.'); return false }
  }
  const refreshProducts = () => fetch(`${API_URL}/products`, { headers: authHeaders() }).then((response) => response.ok ? response.json() : null).then((data) => { if (data) setProducts(data) }).catch(() => {})
  const refreshWarehouses = () => setWarehouseRefresh((value) => value + 1)
  const refreshCashSession = () => setCashSessionRefresh((value) => value + 1)
  const refreshNavigationCounts = () => setNavigationCountsRefresh((value) => value + 1)
  const refreshInventory = () => { refreshProducts(); refreshWarehouses() }
  const saveProductMetadata = async (id, payload) => {
    try {
      const response = await fetch(`${API_URL}/products/${id}/metadata`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Metadata produk gagal disimpan.')
      setProducts((current) => current.map((product) => product.id === id ? result : product))
      setDatabaseOnline(true)
      return true
    } catch (error) { pushToast('error', error.message || 'Metadata produk gagal disimpan.'); return false }
  }
  const saveCategory = async (payload, editingId) => {
    try {
      const response = await fetch(`${API_URL}/categories${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setCategoryList((current) => editingId ? current.map((item) => item.id === editingId ? { ...item, ...result } : item) : [...current, result].sort((a, b) => a.name.localeCompare(b.name)))
      setDatabaseOnline(true)
      if (editingId && result.renamedProducts > 0) refreshProducts()
      pushToast('success', editingId ? 'Kategori diperbarui.' : 'Kategori ditambahkan.')
      return true
    } catch (error) { pushToast('error', error.message || 'Kategori gagal disimpan.'); return false }
  }
  const removeCategory = async (id) => {
    try {
      const response = await fetch(`${API_URL}/categories/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!response.ok) { const error = await response.json(); throw new Error(error.message) }
      setCategoryList((current) => current.filter((item) => item.id !== id))
      setDatabaseOnline(true)
      pushToast('success', 'Kategori dihapus.')
      return true
    } catch (error) { pushToast('error', error.message || 'Kategori gagal dihapus.'); return false }
  }
  const saveSupplier = async (payload, editingId) => {
    try {
      const response = await fetch(`${API_URL}/suppliers${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Pemasok gagal disimpan.')
      setSuppliers((current) => editingId ? current.map((supplier) => supplier.id === editingId ? { ...supplier, ...result, purchaseCount: supplier.purchaseCount } : supplier) : [...current, result].sort((a, b) => a.name.localeCompare(b.name)))
      if (!editingId) refreshNavigationCounts()
      setDatabaseOnline(true)
      pushToast('success', editingId ? 'Pemasok diperbarui.' : 'Pemasok ditambahkan.')
      return true
    } catch (error) { pushToast('error', error.message || 'Pemasok gagal disimpan.'); return false }
  }
  const removeSupplier = async (id) => {
    try {
      const response = await fetch(`${API_URL}/suppliers/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Pemasok gagal dihapus.') }
      setSuppliers((current) => current.filter((supplier) => supplier.id !== id))
      refreshNavigationCounts()
      setDatabaseOnline(true)
      pushToast('success', 'Pemasok dihapus.')
      return true
    } catch (error) { pushToast('error', error.message || 'Pemasok gagal dihapus.'); return false }
  }
  const createPurchase = async (payload) => {
    try {
      const defaultDueDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
      const response = await fetch(`${API_URL}/purchases`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, warehouseId: Number(selectedWarehouseId) || undefined, dueDate: payload.dueDate || defaultDueDate }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Pesanan gagal dibuat.')
      setPurchases((current) => [result, ...current])
      setSuppliers((current) => current.map((supplier) => supplier.id === result.supplierId ? { ...supplier, purchaseCount: (supplier.purchaseCount || 0) + 1 } : supplier))
      refreshNavigationCounts()
      setDatabaseOnline(true)
      pushToast('success', `Pesanan ${result.orderNumber} dibuat.`)
      return true
    } catch (error) { pushToast('error', error.message || 'Pesanan gagal dibuat.'); return false }
  }
  const receivePurchase = async (id, items) => {
    try {
      const response = await fetch(`${API_URL}/purchases/${id}/receive`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Penerimaan barang gagal dicatat.')
      setPurchases((current) => current.map((order) => order.id === id ? result : order))
      await refreshProducts()
      setDatabaseOnline(true)
      pushToast('success', `Penerimaan ${result.orderNumber} berhasil dicatat.`)
      return true
    } catch (error) { pushToast('error', error.message || 'Penerimaan barang gagal dicatat.'); return false }
  }
  const saveCustomer = async (payload, editingId) => {
    try {
      const response = await fetch(`${API_URL}/customers${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Pelanggan gagal disimpan.')
      setCustomers((current) => editingId ? current.map((customer) => customer.id === editingId ? { ...customer, ...result, orderCount: customer.orderCount } : customer) : [...current, result].sort((a, b) => a.name.localeCompare(b.name)))
      if (!editingId) refreshNavigationCounts()
      setDatabaseOnline(true)
      pushToast('success', editingId ? 'Pelanggan diperbarui.' : 'Pelanggan ditambahkan.')
      return true
    } catch (error) { pushToast('error', error.message || 'Pelanggan gagal disimpan.'); return false }
  }
  const removeCustomer = async (id) => {
    try {
      const response = await fetch(`${API_URL}/customers/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Pelanggan gagal dihapus.') }
      setCustomers((current) => current.filter((customer) => customer.id !== id))
      refreshNavigationCounts()
      setDatabaseOnline(true)
      pushToast('success', 'Pelanggan dihapus.')
      return true
    } catch (error) { pushToast('error', error.message || 'Pelanggan gagal dihapus.'); return false }
  }
  const createSale = async (payload) => {
    try {
      const response = await fetch(`${API_URL}/sales`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, warehouseId: Number(selectedWarehouseId) || undefined }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Pesanan penjualan gagal dibuat.')
      setSales((current) => [result, ...current])
      setCustomers((current) => current.map((customer) => customer.id === result.customerId ? { ...customer, orderCount: (customer.orderCount || 0) + 1 } : customer))
      refreshNavigationCounts()
      if (payload.checkoutPaymentMethod === 'cash') refreshCashSession()
      await refreshProducts()
      setDatabaseOnline(true)
      pushToast('success', `Pesanan ${result.orderNumber} dibuat.`)
      return result
    } catch (error) { pushToast('error', error.message || 'Pesanan penjualan gagal dibuat.'); return false }
  }
  const updateSale = async (id, action, items) => {
    try {
      const response = await fetch(`${API_URL}/sales/${id}/${action}`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(items ? { items } : {}) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Pesanan gagal diperbarui.')
      setSales((current) => current.map((order) => order.id === id ? result : order))
      await refreshProducts()
      setDatabaseOnline(true)
      pushToast('success', action === 'return' ? `Retur ${result.orderNumber} dicatat.` : `Pesanan ${result.orderNumber} dibatalkan.`)
      return true
    } catch (error) { pushToast('error', error.message || 'Pesanan gagal diperbarui.'); return false }
  }
  const recordPayment = async (id, payload) => {
    try {
      const response = await fetch(`${API_URL}/sales/${id}/payments`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Pembayaran gagal dicatat.')
      setSales((current) => current.map((order) => order.id === id ? result : order))
      if (payload.method === 'cash') refreshCashSession()
      setDatabaseOnline(true)
      pushToast('success', payload.kind === 'refund' ? 'Refund dicatat.' : 'Pembayaran dicatat.')
      return true
    } catch (error) { pushToast('error', error.message || 'Pembayaran gagal dicatat.'); return false }
  }

  if (!isAuthenticated) return <div className="login-page"><div className="login-decoration"><span className="decoration-grid"></span><span className="decoration-sun"></span></div><form className="login-card" onSubmit={registerStep === 'form' ? handleRegister : registerStep === 'otp' ? verifyRegisterOtp : resetStep ? resetPasswordWithOtp : otpStep ? handleVerifyOtp : handleLogin}><div className="login-brand"><Logo /><span>Ifal Store</span></div><p className="eyebrow">{registerStep === 'form' ? 'Create account' : registerStep === 'otp' ? 'Email verification' : resetStep ? 'Password reset' : otpStep ? 'MFA verification' : 'Welcome back'}</p><h1>{registerStep === 'form' ? 'Daftar akun baru' : registerStep === 'otp' ? 'Enter your OTP code' : resetStep ? 'Create a new password' : otpStep ? 'Enter your OTP code' : 'Sign in to your workspace'}</h1><p className="login-subtitle">{registerStep === 'form' ? 'Buat akun staff untuk mengelola produk dan inventaris.' : registerStep === 'otp' ? `A 6-digit code was sent to ${registerForm.email}.` : resetStep ? `Enter the reset code sent to ${loginForm.email}.` : otpStep ? `A 6-digit code was sent to ${loginForm.email}.` : 'Manage your products and inventory in one calm place.'}</p>{registerStep === 'form' && <label>Name<input autoFocus required type="text" value={registerForm.name} onChange={(event) => setRegisterForm({ ...registerForm, name: event.target.value })} placeholder="Your full name" /></label>}{registerStep === 'form' ? <label>Email address<input required type="email" value={registerForm.email} onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })} placeholder="you@company.com" /></label> : registerStep === 'otp' ? null : <label>Email address<input autoFocus={!otpStep && !resetStep} required disabled={otpStep || resetStep} type="email" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} placeholder="you@company.com" /></label>}{registerStep === 'form' && <><label>Password<input required minLength="8" type="password" value={registerForm.password} onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })} placeholder="At least 8 characters" /></label><label>Confirm password<input required minLength="8" type="password" value={registerForm.passwordConfirmation} onChange={(event) => setRegisterForm({ ...registerForm, passwordConfirmation: event.target.value })} placeholder="Repeat your password" /></label></>}{registerStep === 'otp' && <label>OTP code<input autoFocus required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={registerOtp} onChange={(event) => setRegisterOtp(event.target.value.replace(/\D/g, ''))} placeholder="Enter 6-digit code" /></label>}{!registerStep && (otpStep || resetStep) && <label>OTP code<input autoFocus required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={resetStep ? resetOtp : otp} onChange={(event) => (resetStep ? setResetOtp : setOtp)(event.target.value.replace(/\D/g, ''))} placeholder="Enter 6-digit code" /></label>}{!registerStep && !otpStep && !resetStep && <label>Password<input required type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="Enter your password" /></label>}{!registerStep && resetStep && <><label>New password<input required minLength="8" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="At least 8 characters" /></label><label>Confirm password<input required minLength="8" type="password" value={resetPasswordConfirmation} onChange={(event) => setResetPasswordConfirmation(event.target.value)} placeholder="Repeat new password" /></label></>}{loginError && <p className="login-error">{loginError}</p>}<button className="primary-button login-button" type="submit">{registerStep === 'form' ? 'Daftar' : registerStep === 'otp' ? 'Verify OTP' : resetStep ? 'Reset password' : otpStep ? 'Verify OTP' : 'Sign in'} <ChevronDown size={16} className="login-arrow" /></button>{registerStep === 'otp' && <button type="button" className="secondary-button" onClick={resendRegisterOtp}>Kirim ulang kode</button>}{registerStep && <button type="button" className="secondary-button" onClick={() => { setRegisterStep(false); setRegisterOtp(''); setLoginError('') }}>Kembali ke masuk</button>}{!registerStep && otpStep && <button type="button" className="secondary-button" onClick={resendOtp}>Resend OTP</button>}{!registerStep && !otpStep && !resetStep && <button type="button" className="secondary-button" onClick={requestPasswordReset}>Forgot password?</button>}{!registerStep && !otpStep && !resetStep && <button type="button" className="secondary-button" onClick={() => { setRegisterStep('form'); setLoginError('') }}>Daftar</button>}{!registerStep && resetStep && <button type="button" className="secondary-button" onClick={() => setResetStep(false)}>Back to sign in</button>}<p className="demo-hint">{registerStep === 'form' ? 'Akun baru dibuat sebagai staff dan perlu verifikasi email.' : registerStep === 'otp' || resetStep || otpStep ? 'The code expires in 10 minutes.' : 'Use an active account from the users table.'}</p></form></div>

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Logo /><span>Ifal Store</span></div>
        <nav>
          <div className="nav-group">
            <p className="nav-group-label">Inventory</p>
            <button className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveView('dashboard')}><LayoutDashboard size={18} /> Dashboard</button>
            <button className={`nav-item ${activeView === 'products' ? 'active' : ''}`} onClick={() => setActiveView('products')}><Box size={18} /> Products <span className="nav-count">{products.length}</span></button>
            <button className={`nav-item ${activeView === 'categories' ? 'active' : ''}`} onClick={() => setActiveView('categories')}><Tag size={18} /> Categories <span className="nav-count">{categoryList.length}</span></button>
            <button className={`nav-item ${activeView === 'suppliers' ? 'active' : ''}`} onClick={() => setActiveView('suppliers')}><Truck size={18} /> Suppliers <span className="nav-count">{navigationCounts?.suppliers ?? '…'}</span></button>
            <button className={`nav-item ${activeView === 'purchases' ? 'active' : ''}`} onClick={() => setActiveView('purchases')}><ShoppingCart size={18} /> Purchases <span className="nav-count">{navigationCounts?.purchases ?? '…'}</span></button>
            <button className={`nav-item ${activeView === 'customers' ? 'active' : ''}`} onClick={() => setActiveView('customers')}><UsersRound size={18} /> Customers <span className="nav-count">{navigationCounts?.customers ?? '…'}</span></button>
            <button className={`nav-item ${activeView === 'sales' ? 'active' : ''}`} onClick={() => setActiveView('sales')}><ReceiptText size={18} /> Sales <span className="nav-count">{navigationCounts?.sales ?? '…'}</span></button>
            <button className={`nav-item ${activeView === 'archive' ? 'active' : ''}`} onClick={() => setActiveView('archive')}><Archive size={18} /> Archive</button>
          </div>
          {isAdmin && <div className="nav-group"><p className="nav-group-label">Administration</p><button className={`nav-item ${activeView === 'users' ? 'active' : ''}`} onClick={() => setActiveView('users')}><UserRound size={18} /> Users <span className="nav-count">{users.length}</span></button><button className={`nav-item ${activeView === 'stock-log' ? 'active' : ''}`} onClick={() => setActiveView('stock-log')}><ClipboardList size={18} /> Stock log</button></div>}
          <div className="nav-group"><p className="nav-group-label">Account</p><button className={`nav-item ${activeView === 'profile' ? 'active' : ''}`} onClick={() => setActiveView('profile')}><ShieldCheck size={18} /> Profile</button></div>
        </nav>
        <div className="sidebar-bottom"><button className="profile-trigger" title="Open profile" onClick={() => setActiveView('profile')}><Avatar user={currentUser} /><div><strong>{currentUser?.name || 'User'}</strong><span>{currentUser?.role || 'User'}</span></div></button><button className="logout-button" title="Log out" onClick={handleLogout}><LogOut size={15} /></button></div>
      </aside>
      <main className="main-content">{activeView === 'dashboard' ? <><header className="topbar"><div><p className="breadcrumb">Workspace / <span>Dashboard</span></p><h1>Analytics dashboard</h1></div><button className="primary-button" onClick={exportAllCsv}><ArrowDownUp size={18} /> Export CSV</button></header><section className="welcome-row"><div><p className="muted">{todayLabel}</p><h2>{greeting}, {firstName} <span className="spark">✦</span></h2><p className="muted">Ringkasan inventaris dan sebaran per kategori.</p></div><div className="sync-status"><span className={`pulse ${databaseOnline ? '' : 'offline'}`}></span> {databaseOnline ? 'PostgreSQL synced' : 'Local mode'}</div></section><section className="stats-grid dashboard-grid"><div className="stat-card"><div className="stat-label"><span>Total products</span><span className="stat-icon blue"><Box size={17} /></span></div><strong>{stats?.totalProducts ?? 0}</strong><small><b className="positive">{stats?.categoryCount ?? 0}</b> kategori</small></div><div className="stat-card"><div className="stat-label"><span>Total stock units</span><span className="stat-icon green"><Check size={17} /></span></div><strong>{stats?.totalStockUnits ?? 0}</strong><small>unit di seluruh katalog</small></div><div className="stat-card"><div className="stat-label"><span>Inventory value</span><span className="stat-icon green">Rp</span></div><strong>{formatIDR(stats?.inventoryValue)}</strong><small>nilai persediaan aktif</small></div><div className="stat-card"><div className="stat-label"><span>Out of stock</span><span className="stat-icon red"><Activity size={17} /></span></div><strong>{stats?.outOfStockCount ?? 0}</strong><small><b className="negative">Perlu restock segera</b></small></div><div className="stat-card"><div className="stat-label"><span>Low stock</span><span className="stat-icon orange"><Activity size={17} /></span></div><strong>{stats?.lowStockCount ?? 0}</strong><small><b className="negative">Mendekati batas</b></small></div></section><section className="catalog-panel"><div className="panel-heading"><div><h2>Per-category breakdown</h2><p className="muted">{stats?.byCategory?.length ?? 0} kategori terdaftar.</p></div></div><div className="table-wrap"><table><thead><tr><th>Category</th><th>Products</th><th>Stock units</th><th>Value</th></tr></thead><tbody>{(stats?.byCategory ?? []).map((row) => <tr key={row.category}><td><div className="product-cell"><span className="product-avatar avatar-0"><Tag size={16} /></span><strong>{row.category}</strong></div></td><td>{row.productCount ?? 0} produk</td><td>{row.stockUnits ?? 0} units</td><td className="price">{formatIDR(row.value)}</td></tr>)}{(stats?.byCategory?.length ?? 0) === 0 && <tr><td colSpan="4" className="empty-state">Belum ada data kategori.</td></tr>}</tbody></table></div></section></> : activeView === 'profile' ? <ProfileView user={currentUser} onSaveProfile={saveProfile} onChangePassword={changePassword} onAvatarError={(message) => pushToast('error', message)} /> : activeView === 'categories' ? <CategoriesView categories={categoryList} canManage={isAdmin} onSave={saveCategory} onDelete={removeCategory} /> : activeView === 'archive' ? <><header className="topbar"><div><p className="breadcrumb">Workspace / <span>Archive</span></p><h1>Archived products</h1></div></header><section className="welcome-row"><div><p className="muted">Soft-deleted catalog</p><h2>Recoverable products</h2><p className="muted">Pulihkan produk atau hapus permanen (admin).</p></div><div className="sync-status"><span className={`pulse ${databaseOnline ? '' : 'offline'}`}></span> {databaseOnline ? 'PostgreSQL synced' : 'Local mode'}</div></section><section className="catalog-panel"><div className="panel-heading"><div><h2>Archive</h2><p className="muted">{archivedProducts.length} produk diarsipkan.</p></div></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>SKU</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{archivedProducts.map((product) => <tr key={product.id}><td><div className="product-cell"><span className={`product-avatar avatar-${product.id % 4}`}><PackageSearch size={18} /></span><strong>{product.name}</strong></div></td><td>{product.category}</td><td className="price">{formatIDR(product.price)}</td><td>{product.stock} units</td><td>{product.sku || '—'}</td><td><div className="actions"><button title="Restore product" onClick={() => restoreProduct(product.id)}><RotateCcw size={16} /></button>{isAdmin && <button title="Delete permanently" onClick={() => setPendingPermanent(product)}><Trash2 size={16} /></button>}</div></td></tr>)}{archivedProducts.length === 0 && <tr><td colSpan="6" className="empty-state">Tidak ada produk yang diarsipkan.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{archivedProducts.length}</b> archived products</span></div></section></> : activeView === 'customers' ? <CustomersView customers={customers} canManage={isAdmin} onSave={saveCustomer} onDelete={removeCustomer} /> : activeView === 'sales' ? <SalesView sales={sales} customers={customers} products={products} onCreate={createSale} onCancel={(id) => updateSale(id, 'cancel')} onReturn={(id, items) => updateSale(id, 'return', items)} onPayment={recordPayment} /> : activeView === 'suppliers' ? <SuppliersView suppliers={suppliers} canManage={isAdmin} onSave={saveSupplier} onDelete={removeSupplier} /> : activeView === 'purchases' ? <PurchasesView purchases={purchases} suppliers={suppliers} products={products} onCreate={createPurchase} onReceive={receivePurchase} /> : isAdmin && activeView === 'stock-log' ? <><header className="topbar"><div><p className="breadcrumb">Workspace / <span>Stock log</span></p><h1>Stock movements</h1></div></header><section className="welcome-row"><div><p className="muted">Audit trail</p><h2>Recent stock changes</h2><p className="muted">200 pergerakan stok terbaru di seluruh produk.</p></div><div className="sync-status"><span className={`pulse ${databaseOnline ? '' : 'offline'}`}></span> {databaseOnline ? 'PostgreSQL synced' : 'Local mode'}</div></section><section className="catalog-panel"><div className="panel-heading"><div><h2>Stock log</h2><p className="muted">{stockLog.length} movement{stockLog.length === 1 ? '' : 's'}.</p></div></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Delta</th><th>Before → After</th><th>User</th><th>Reason</th><th>Time</th></tr></thead><tbody>{stockLog.map((movement) => <tr key={movement.id}><td><strong>{movement.productName || '—'}</strong></td><td><span className={movement.delta >= 0 ? 'delta-up' : 'delta-down'}>{movement.delta >= 0 ? '+' : ''}{movement.delta}</span></td><td>{movement.stockBefore} → {movement.stockAfter}</td><td>{movement.userName || '—'}</td><td>{movement.reason || '—'}</td><td>{movement.createdAt ? new Date(movement.createdAt).toLocaleString('id-ID') : '—'}</td></tr>)}{stockLog.length === 0 && <tr><td colSpan="6" className="empty-state">Belum ada pergerakan stok.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{stockLog.length}</b> movements</span></div></section></> : isAdmin && activeView === 'users' ? <UsersView users={users} onSave={saveUser} onDelete={removeUser} /> : <><header className="topbar"><div><p className="breadcrumb">Workspace / <span>Products</span></p><h1>Product inventory</h1></div><div className="topbar-actions"><div className="notif-wrap"><button className="notif-bell" title="Low stock alerts" onClick={() => setBellOpen((open) => !open)}><Bell size={18} />{lowOrOut.length > 0 && <span className="notif-badge">{lowOrOut.length}</span>}</button>{bellOpen && <div className="notif-panel"><div className="notif-panel-head"><strong>Low / out of stock</strong><span className="muted">{lowOrOut.length} produk</span></div>{lowOrOut.length === 0 ? <p className="notif-empty">Semua stok aman.</p> : <ul className="notif-list">{lowOrOut.map((product) => <li key={product.id}><div><strong>{product.name}</strong><span className={`status ${product.status.toLowerCase().replace(' ', '-')}`}><span></span>{product.stock} units · {product.status}</span></div><button className="notif-edit" onClick={() => { setBellOpen(false); openEditModal(product) }}><Pencil size={13} /> Edit</button></li>)}</ul>}</div>}</div><button className="primary-button" onClick={openCreateModal}><CirclePlus size={18} /> Add product</button></div></header><section className="welcome-row"><div><p className="muted">{todayLabel}</p><h2>{greeting}, {firstName} <span className="spark">✦</span></h2><p className="muted">Here is what's happening with your inventory today.</p></div><div className="sync-status"><span className={`pulse ${databaseOnline ? '' : 'offline'}`}></span> {databaseOnline ? 'PostgreSQL synced' : 'Local mode'}</div></section>
          <section className="stats-grid"><div className="stat-card"><div className="stat-label"><span>Total products</span><span className="stat-icon blue"><Box size={17} /></span></div><strong>{products.length}</strong><small><b className="positive">{categoryCount}</b> kategori</small></div><div className="stat-card"><div className="stat-label"><span>Inventory value</span><span className="stat-icon green">Rp</span></div><strong>{formatIDR(totalValue)}</strong><small>Rata-rata {formatIDR(avgPrice)} per produk</small></div><div className="stat-card"><div className="stat-label"><span>Active products</span><span className="stat-icon orange"><Check size={17} /></span></div><strong>{activeProducts}</strong><small><b className="positive">{activeProducts}</b> dari {products.length} produk</small></div><div className="stat-card"><div className="stat-label"><span>Needs attention</span><span className="stat-icon red"><Activity size={17} /></span></div><strong>{lowStock}</strong><small><b className="negative">Perlu restock</b> · {lowStock} produk</small></div></section>
          <section className="catalog-panel"><div className="panel-heading"><div><h2>All products</h2><p className="muted">Manage your catalog and inventory levels.</p></div><div className="panel-heading-actions"><label className="filter-button import-button"><FileUp size={15} /> Import<input type="file" accept=".csv" onChange={handleImportFile} /></label><button className="filter-button" onClick={exportCsv}><ArrowDownUp size={15} /> Export <ChevronDown size={14} /></button><button className="filter-button" onClick={exportAllCsv}><ArrowDownUp size={15} /> Export all</button></div></div><div className="toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Search products..." /></label><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option>All status</option><option>Active</option><option>Low stock</option><option>Out of stock</option></select><button className={`filter-button ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen((open) => !open)}><Settings2 size={15} /> Filters</button></div>{filtersOpen && <div className="toolbar filter-panel"><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}>{categories.map((item) => <option key={item}>{item}</option>)}</select><input type="number" min="0" value={priceMin} onChange={(event) => { setPriceMin(event.target.value); setPage(1) }} placeholder="Min Rp" /><input type="number" min="0" value={priceMax} onChange={(event) => { setPriceMax(event.target.value); setPage(1) }} placeholder="Max Rp" /><button className="secondary-button" onClick={() => { setCategory('All categories'); setPriceMin(''); setPriceMax(''); setPage(1) }}>Clear filters</button></div>}<div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>SKU</th><th>Price</th><th>Stock</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{pagedProducts.map((product) => <tr key={product.id}><td><div className="product-cell">{product.media ? <span className="media-thumb">{product.media.type.startsWith('video/') ? <video src={product.media.url} muted /> : <img src={product.media.url} alt="" />}<span className="media-type">{product.media.type.startsWith('video/') ? <Video size={10} /> : <ImageIcon size={10} />}</span></span> : <span className={`product-avatar avatar-${product.id % 4}`}><PackageSearch size={18} /></span>}<strong>{product.name}</strong></div></td><td>{product.category}</td><td>{product.sku || '—'}</td><td className="price">{formatIDR(product.price)}</td><td>{product.stock} units</td><td><span className={`status ${product.status.toLowerCase().replace(' ', '-')}`}><span></span>{product.status}</span>{product.stock > 0 && product.stock <= (product.lowStockThreshold ?? LOW_STOCK_THRESHOLD) && <span className="status low-stock"><span></span>Low</span>}</td><td><div className="actions"><button title="Edit product" onClick={() => openEditModal(product)}><Pencil size={16} /></button><button title="Delete product" onClick={() => setPendingProduct(product)}><Trash2 size={16} /></button></div></td></tr>)}{filteredProducts.length === 0 && <tr><td colSpan="7" className="empty-state">No products match your search.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{filteredProducts.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredProducts.length)}</b> of <b>{filteredProducts.length}</b> products</span><div><button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</button>{Array.from({ length: totalPages }, (unused, index) => index + 1).filter((number) => Math.abs(number - page) <= 2 || number === 1 || number === totalPages).map((number, index, visible) => <span key={number} style={{ display: 'flex', gap: 3 }}>{index > 0 && number - visible[index - 1] > 1 && <button disabled>…</button>}<button className={number === page ? 'page-number' : ''} onClick={() => setPage(number)}>{number}</button></span>)}<button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>Next</button></div></div></section></>}</main>
      {isModalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsModalOpen(false)}><form className="modal" onSubmit={handleSubmit}><div className="modal-heading"><div><h2>{editingId ? 'Edit product' : 'Add product'}</h2><p className="muted">Keep your catalog details up to date.</p></div><button type="button" className="close-button" onClick={() => setIsModalOpen(false)}><X size={19} /></button></div><label>Product name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Wireless Keyboard" /></label><label>Category<select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="" disabled>Pilih kategori</option>{[...new Set([...(form.category ? [form.category] : []), ...formCategories])].map((item) => <option key={item} value={item}>{item}</option>)}</select><small className="field-hint">Kelola daftar di menu Categories.</small></label><div className="form-grid"><label>Price (Rp)<input required min="0" step="1" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0" /></label><label>Stock<input required min="0" type="number" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="0" /></label><label>Low stock threshold<input min="0" type="number" value={form.lowStockThreshold} onChange={(event) => setForm({ ...form, lowStockThreshold: event.target.value })} placeholder="5" /></label></div><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option>Active</option><option>Low stock</option><option>Out of stock</option></select></label><label>SKU<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="auto-generate if empty" /></label>{editingId && form.sku && <div className="barcode-box" dangerouslySetInnerHTML={{ __html: code128BarcodeSvg(form.sku) }} />}{editingId && <div className="movement-history"><p className="movement-title">Stock history</p>{movements.length === 0 ? <p className="movement-empty">Belum ada pergerakan stok.</p> : <div className="table-wrap"><table><thead><tr><th>Delta</th><th>Before → After</th><th>User</th><th>Reason</th><th>Time</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td><span className={movement.delta >= 0 ? 'delta-up' : 'delta-down'}>{movement.delta >= 0 ? '+' : ''}{movement.delta}</span></td><td>{movement.stockBefore} → {movement.stockAfter}</td><td>{movement.userName || '—'}</td><td>{movement.reason || '—'}</td><td>{movement.createdAt ? new Date(movement.createdAt).toLocaleString('id-ID') : '—'}</td></tr>)}</tbody></table></div>}</div>}<label className="upload-field">Product photo / video<span className="upload-control"><Upload size={16} /><span>{form.media ? form.media.name : 'Choose an image or video'}</span><input type="file" accept="image/*,video/*" onChange={handleMediaChange} /></span><small>JPG, PNG, WEBP atau MP4. Maksimal 5 MB.</small></label>{form.media && <div className="media-preview">{form.media.type.startsWith('video/') ? <video src={form.media.url} controls /> : <img src={form.media.url} alt="Preview produk" />}<button type="button" className="remove-media" onClick={() => setForm({ ...form, media: null })}><X size={14} /> Remove media</button></div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsModalOpen(false)}>Cancel</button><button type="submit" className="primary-button">{editingId ? 'Save changes' : 'Add product'}</button></div></form></div>}
      {pendingProduct && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingProduct(null)}><div className="modal"><div className="modal-heading"><div><h2>Delete product</h2><p className="muted">Arsipkan "{pendingProduct.name}"? Produk dipindahkan ke Archive dan masih bisa dipulihkan.</p></div><button type="button" className="close-button" onClick={() => setPendingProduct(null)}><X size={19} /></button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPendingProduct(null)}>Cancel</button><button type="button" className="danger-button" onClick={confirmDeleteProduct}><Trash2 size={15} /> Delete</button></div></div></div>}
      {pendingPermanent && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingPermanent(null)}><div className="modal"><div className="modal-heading"><div><h2>Delete permanently</h2><p className="muted">Hapus "{pendingPermanent.name}" secara permanen? Tindakan ini tidak dapat dibatalkan.</p></div><button type="button" className="close-button" onClick={() => setPendingPermanent(null)}><X size={19} /></button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPendingPermanent(null)}>Cancel</button><button type="button" className="danger-button" onClick={confirmPermanentDelete}><Trash2 size={15} /> Delete permanently</button></div></div></div>}
      {importRows && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setImportRows(null)}><div className="modal import-modal"><div className="modal-heading"><div><h2>Import preview</h2><p className="muted">{importRows.filter((row) => row.valid).length} valid · {importRows.filter((row) => !row.valid).length} invalid dari {importRows.length} baris.</p></div><button type="button" className="close-button" onClick={() => setImportRows(null)}><X size={19} /></button></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>SKU</th><th>Issue</th></tr></thead><tbody>{importRows.map((row, index) => <tr key={index} className={row.valid ? '' : 'row-invalid'}><td>{row.name || '—'}</td><td>{row.category || '—'}</td><td>{Number.isNaN(row.price) ? '—' : row.price}</td><td>{Number.isNaN(row.stock) ? '—' : row.stock}</td><td>{row.sku || '—'}</td><td>{row.valid ? <span className="status active"><span></span>OK</span> : <span className="import-error">{row.errors.join(', ')}</span>}</td></tr>)}</tbody></table></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setImportRows(null)}>Cancel</button><button type="button" className="primary-button" disabled={importRows.every((row) => !row.valid)} onClick={confirmImport}><FileUp size={15} /> Import {importRows.filter((row) => row.valid).length} produk</button></div></div></div>}
      <div className="feature-launcher" aria-label="Fitur operasional"><span>Gudang transaksi</span><select aria-label="Pilih gudang untuk transaksi baru" value={selectedWarehouseId} onChange={(event) => setSelectedWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select><span>Fitur:</span>{[['warehouses', 'Gudang'], ['stocktake', 'Stok opname'], ['cash', `Kas${cashSession ? ' (aktif)' : ''}`], ['payables', 'Utang pemasok'], ...(isAdmin ? [['reports', 'Laporan'], ['expenses', 'Biaya'], ['backup', 'Backup']] : []), ['receivables', 'Piutang'], ['restock', 'Restock'], ['barcode', 'Barcode'], ['batches', 'Batch']].map(([id, label]) => <button key={id} className={featureView === id ? 'active' : ''} onClick={() => setFeatureView(id)}>{label}</button>)}</div>
      {featureView && <div className={`feature-overlay ${featureView === 'reports' ? 'report-print' : ''}`}><div className="feature-overlay-content"><button className="feature-close secondary-button" onClick={() => setFeatureView('')}>Tutup fitur</button>{featureView === 'warehouses' && <WarehousesView warehouses={warehouses} onRefresh={refreshInventory} onToast={(message) => pushToast('success', message)} />}{featureView === 'stocktake' && <StocktakeView warehouses={warehouses} onRefresh={refreshInventory} onToast={(message) => pushToast('success', message)} />}{featureView === 'cash' && <CashSessionView onRefresh={refreshCashSession} onToast={(message) => pushToast('success', message)} />}{featureView === 'payables' && <SupplierAccountingView onRefresh={refreshInventory} onToast={(message) => pushToast('success', message)} />}{featureView === 'reports' && isAdmin && <ReportsView />}{featureView === 'expenses' && isAdmin && <ExpensesView />}{featureView === 'backup' && isAdmin && <BackupView onRestored={handleLogout} />}{featureView === 'receivables' && <ReceivablesView />}{featureView === 'restock' && <RestockView />}{featureView === 'barcode' && <BarcodeView products={products} onSave={saveProductMetadata} onToast={(message) => pushToast('success', message)} />}{featureView === 'batches' && <BatchesView products={products} warehouses={warehouses} onToast={(message) => pushToast('success', message)} />}</div></div>}
      <div className="toast-container" role="status" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast ${toast.type}`}>{toast.type === 'success' ? <Check size={15} /> : <X size={15} />}<span>{toast.message}</span></div>)}</div>
    </div>
  )
}

export default App
