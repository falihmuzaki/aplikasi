import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownUp, Box, Check, ChevronDown, CirclePlus, Image as ImageIcon, LayoutDashboard, LogOut, PackageSearch, Pencil, Search, Settings2, Trash2, Upload, UserPlus, UserRound, Video, X } from 'lucide-react'
import './App.css'

const seedProducts = [
  { id: 1, name: 'Wireless Headphones', category: 'Electronics', price: 129.99, stock: 24, status: 'Active' },
  { id: 2, name: 'Minimal Desk Lamp', category: 'Home & Living', price: 64.5, stock: 8, status: 'Active' },
  { id: 3, name: 'Everyday Backpack', category: 'Accessories', price: 89, stock: 0, status: 'Out of stock' },
  { id: 4, name: 'Ceramic Coffee Set', category: 'Home & Living', price: 42.75, stock: 16, status: 'Active' },
  { id: 5, name: 'Running Sneakers', category: 'Fashion', price: 112, stock: 3, status: 'Low stock' },
]
const defaultCategories = ['Electronics', 'Home & Living', 'Accessories', 'Fashion']
const blankForm = { name: '', category: 'Electronics', price: '', stock: '', status: 'Active', media: null }
const blankUser = { name: '', email: '', password: '', role: 'staff', isActive: true, mfaEnabled: false }
const API_URL = 'http://localhost:3001/api'
const getInitials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')
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
  const [users, setUsers] = useState([])
  const [toasts, setToasts] = useState([])
  const [pendingProduct, setPendingProduct] = useState(null)
  const [activeView, setActiveView] = useState(isAdmin ? 'users' : 'products')
  useEffect(() => { if (!isAdmin && activeView === 'users') setActiveView('products') }, [isAdmin, activeView])
  useEffect(() => localStorage.setItem('lumina-products', JSON.stringify(products)), [products])
  useEffect(() => {
    if (!isAuthenticated) return
    fetch(`${API_URL}/products`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('API unavailable'); return response.json() }).then((data) => { setProducts(data); setDatabaseOnline(true) }).catch(() => setDatabaseOnline(false))
  }, [isAuthenticated])
  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return
    fetch(`${API_URL}/users`, { headers: authHeaders() }).then((response) => { if (!response.ok) throw new Error('API unavailable'); return response.json() }).then((data) => { setUsers(data); setDatabaseOnline(true) }).catch(() => setDatabaseOnline(false))
  }, [isAuthenticated, isAdmin])
  const categories = useMemo(() => ['All categories', ...new Set(products.map((product) => product.category))], [products])
  const formCategories = useMemo(() => [...new Set([...defaultCategories, ...products.map((product) => product.category)])].filter(Boolean).sort((a, b) => a.localeCompare(b)), [products])
  const filteredProducts = useMemo(() => products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All status' || product.status === filter) && (category === 'All categories' || product.category === category) && (priceMin === '' || product.price >= Number(priceMin)) && (priceMax === '' || product.price <= Number(priceMax))), [products, query, filter, category, priceMin, priceMax])
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize))
  const pagedProducts = useMemo(() => filteredProducts.slice((page - 1) * pageSize, page * pageSize), [filteredProducts, page])
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])
  const totalValue = products.reduce((sum, product) => sum + product.price * product.stock, 0)
  const activeProducts = products.filter((product) => product.status === 'Active').length
  const lowStock = products.filter((product) => product.status === 'Low stock' || product.stock === 0).length
  const categoryCount = new Set(products.map((product) => product.category)).size
  const avgPrice = products.length ? products.reduce((sum, product) => sum + product.price, 0) / products.length : 0
  const now = new Date()
  const todayLabel = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = (currentUser?.name || 'there').split(' ')[0]
  const pushToast = (type, message) => { const id = Date.now() + Math.random(); setToasts((list) => [...list, { id, type, message }]); setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 4000) }
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
  const handleLogout = () => { localStorage.removeItem('lumina-auth'); localStorage.removeItem('lumina-user'); localStorage.removeItem('lumina-token'); setCurrentUser(null); setIsAuthenticated(false); setLoginForm({ email: '', password: '' }); setOtp(''); setOtpStep(false) }
  const openCreateModal = () => { setEditingId(null); setForm(blankForm); setIsModalOpen(true) }
  const openEditModal = (product) => { setEditingId(product.id); setForm({ ...product, price: String(product.price), stock: String(product.stock) }); setIsModalOpen(true) }
  const exportCsv = () => { const esc = (value) => `"${String(value).replace(/"/g, '""')}"`; const rows = [['Name', 'Category', 'Price', 'Stock', 'Status'], ...filteredProducts.map((product) => [product.name, product.category, product.price, product.stock, product.status])]; const csv = rows.map((row) => row.map(esc).join(',')).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = `products-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url) }
  const handleMediaChange = (event) => {
    const file = event.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { pushToast('error', 'Ukuran file maksimal 5 MB.'); event.target.value = ''; return }
    const reader = new FileReader()
    reader.onload = () => setForm((current) => ({ ...current, media: { name: file.name, type: file.type, url: reader.result } }))
    reader.readAsDataURL(file)
  }
  const handleSubmit = async (event) => { event.preventDefault(); const stock = Number(form.stock) || 0; const product = { ...form, price: Number(form.price) || 0, stock, status: stock === 0 ? 'Out of stock' : form.status }; try { const response = await fetch(`${API_URL}/products${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(product) }); if (!response.ok) throw new Error('Save failed'); const savedProduct = await response.json(); setProducts((current) => editingId ? current.map((item) => item.id === editingId ? savedProduct : item) : [savedProduct, ...current]); setDatabaseOnline(true); pushToast('success', editingId ? 'Produk diperbarui.' : 'Produk ditambahkan.') } catch { setProducts((current) => editingId ? current.map((item) => item.id === editingId ? { ...product, id: editingId } : item) : [{ ...product, id: Date.now() }, ...current]); setDatabaseOnline(false); pushToast('error', 'Gagal menyimpan ke server. Disimpan lokal.') } setIsModalOpen(false) }
  const confirmDeleteProduct = async () => { const id = pendingProduct.id; try { const response = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE', headers: authHeaders() }); if (!response.ok) throw new Error('Delete failed'); setDatabaseOnline(true); pushToast('success', 'Produk dihapus.') } catch { setDatabaseOnline(false); pushToast('error', 'Gagal hapus di server. Dihapus lokal.') } setProducts((current) => current.filter((product) => product.id !== id)); setPendingProduct(null) }
  const saveUser = async (user, editingId) => { try { const response = await fetch(`${API_URL}/users${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(user) }); if (!response.ok) { const error = await response.json(); throw new Error(error.message) } const savedUser = await response.json(); setUsers((current) => editingId ? current.map((item) => item.id === editingId ? savedUser : item) : [savedUser, ...current]); setDatabaseOnline(true); pushToast('success', editingId ? 'User diperbarui.' : 'User ditambahkan.') } catch (error) { pushToast('error', error.message || 'User gagal disimpan.') } }
  const removeUser = async (id) => { try { const response = await fetch(`${API_URL}/users/${id}`, { method: 'DELETE', headers: authHeaders() }); if (!response.ok) throw new Error('Delete failed'); setUsers((current) => current.filter((user) => user.id !== id)); setDatabaseOnline(true); pushToast('success', 'User dihapus.') } catch { pushToast('error', 'User gagal dihapus. Pastikan API aktif.') } }

  if (!isAuthenticated) return <div className="login-page"><div className="login-decoration"><span className="decoration-grid"></span><span className="decoration-sun"></span></div><form className="login-card" onSubmit={resetStep ? resetPasswordWithOtp : otpStep ? handleVerifyOtp : handleLogin}><div className="login-brand"><span className="brand-mark"><Activity size={18} /></span><span>Lumina</span></div><p className="eyebrow">{resetStep ? 'Password reset' : otpStep ? 'MFA verification' : 'Welcome back'}</p><h1>{resetStep ? 'Create a new password' : otpStep ? 'Enter your OTP code' : 'Sign in to your workspace'}</h1><p className="login-subtitle">{resetStep ? `Enter the reset code sent to ${loginForm.email}.` : otpStep ? `A 6-digit code was sent to ${loginForm.email}.` : 'Manage your products and inventory in one calm place.'}</p><label>Email address<input autoFocus={!otpStep && !resetStep} required disabled={otpStep || resetStep} type="email" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} placeholder="you@company.com" /></label>{!otpStep && !resetStep && <label>Password<input required type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="Enter your password" /></label>}{(otpStep || resetStep) && <label>OTP code<input autoFocus required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={resetStep ? resetOtp : otp} onChange={(event) => (resetStep ? setResetOtp : setOtp)(event.target.value.replace(/\D/g, ''))} placeholder="Enter 6-digit code" /></label>}{resetStep && <><label>New password<input required minLength="8" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="At least 8 characters" /></label><label>Confirm password<input required minLength="8" type="password" value={resetPasswordConfirmation} onChange={(event) => setResetPasswordConfirmation(event.target.value)} placeholder="Repeat new password" /></label></>}{loginError && <p className="login-error">{loginError}</p>}<button className="primary-button login-button" type="submit">{resetStep ? 'Reset password' : otpStep ? 'Verify OTP' : 'Sign in'} <ChevronDown size={16} className="login-arrow" /></button>{otpStep && <button type="button" className="secondary-button" onClick={resendOtp}>Resend OTP</button>}{!otpStep && !resetStep && <button type="button" className="secondary-button" onClick={requestPasswordReset}>Forgot password?</button>}{resetStep && <button type="button" className="secondary-button" onClick={() => setResetStep(false)}>Back to sign in</button>}<p className="demo-hint">{resetStep || otpStep ? 'The code expires in 10 minutes.' : 'Use an active account from the users table.'}</p></form></div>

  return (
    <div className="app-shell">
      <aside className="sidebar"><div className="brand"><span className="brand-mark"><Activity size={18} /></span><span>Lumina</span></div><p className="eyebrow">Workspace</p><nav><button className={`nav-item ${activeView === 'products' ? 'active' : ''}`} onClick={() => setActiveView('products')}><Box size={18} /> Products <span className="nav-count">{products.length}</span></button>{isAdmin && <button className={`nav-item ${activeView === 'users' ? 'active' : ''}`} onClick={() => setActiveView('users')}><UserRound size={18} /> Users <span className="nav-count">{users.length}</span></button>}</nav><div className="sidebar-bottom"><div className="avatar">{getInitials(currentUser?.name || 'User')}</div><div><strong>{currentUser?.name || 'User'}</strong><span>{currentUser?.role || 'User'}</span></div><button className="logout-button" title="Log out" onClick={handleLogout}><LogOut size={15} /></button></div></aside>
      <main className="main-content">{isAdmin && activeView === 'users' ? <UsersView users={users} onSave={saveUser} onDelete={removeUser} /> : <><header className="topbar"><div><p className="breadcrumb">Workspace / <span>Products</span></p><h1>Product inventory</h1></div><button className="primary-button" onClick={openCreateModal}><CirclePlus size={18} /> Add product</button></header><section className="welcome-row"><div><p className="muted">{todayLabel}</p><h2>{greeting}, {firstName} <span className="spark">✦</span></h2><p className="muted">Here is what's happening with your inventory today.</p></div><div className="sync-status"><span className={`pulse ${databaseOnline ? '' : 'offline'}`}></span> {databaseOnline ? 'PostgreSQL synced' : 'Local mode'}</div></section>
          <section className="stats-grid"><div className="stat-card"><div className="stat-label"><span>Total products</span><span className="stat-icon blue"><Box size={17} /></span></div><strong>{products.length}</strong><small><b className="positive">{categoryCount}</b> kategori</small></div><div className="stat-card"><div className="stat-label"><span>Inventory value</span><span className="stat-icon green">$</span></div><strong>${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong><small>Rata-rata ${avgPrice.toFixed(2)} per produk</small></div><div className="stat-card"><div className="stat-label"><span>Active products</span><span className="stat-icon orange"><Check size={17} /></span></div><strong>{activeProducts}</strong><small><b className="positive">{activeProducts}</b> dari {products.length} produk</small></div><div className="stat-card"><div className="stat-label"><span>Needs attention</span><span className="stat-icon red"><Activity size={17} /></span></div><strong>{lowStock}</strong><small><b className="negative">Perlu restock</b> · {lowStock} produk</small></div></section>
          <section className="catalog-panel"><div className="panel-heading"><div><h2>All products</h2><p className="muted">Manage your catalog and inventory levels.</p></div><button className="filter-button" onClick={exportCsv}><ArrowDownUp size={15} /> Export <ChevronDown size={14} /></button></div><div className="toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Search products..." /></label><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option>All status</option><option>Active</option><option>Low stock</option><option>Out of stock</option></select><button className={`filter-button ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen((open) => !open)}><Settings2 size={15} /> Filters</button></div>{filtersOpen && <div className="toolbar filter-panel"><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}>{categories.map((item) => <option key={item}>{item}</option>)}</select><input type="number" min="0" value={priceMin} onChange={(event) => { setPriceMin(event.target.value); setPage(1) }} placeholder="Min $" /><input type="number" min="0" value={priceMax} onChange={(event) => { setPriceMax(event.target.value); setPage(1) }} placeholder="Max $" /><button className="secondary-button" onClick={() => { setCategory('All categories'); setPriceMin(''); setPriceMax(''); setPage(1) }}>Clear filters</button></div>}<div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{pagedProducts.map((product) => <tr key={product.id}><td><div className="product-cell">{product.media ? <span className="media-thumb">{product.media.type.startsWith('video/') ? <video src={product.media.url} muted /> : <img src={product.media.url} alt="" />}<span className="media-type">{product.media.type.startsWith('video/') ? <Video size={10} /> : <ImageIcon size={10} />}</span></span> : <span className={`product-avatar avatar-${product.id % 4}`}><PackageSearch size={18} /></span>}<strong>{product.name}</strong></div></td><td>{product.category}</td><td className="price">${product.price.toFixed(2)}</td><td>{product.stock} units</td><td><span className={`status ${product.status.toLowerCase().replace(' ', '-')}`}><span></span>{product.status}</span></td><td><div className="actions"><button title="Edit product" onClick={() => openEditModal(product)}><Pencil size={16} /></button><button title="Delete product" onClick={() => setPendingProduct(product)}><Trash2 size={16} /></button></div></td></tr>)}{filteredProducts.length === 0 && <tr><td colSpan="6" className="empty-state">No products match your search.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{filteredProducts.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, filteredProducts.length)}</b> of <b>{filteredProducts.length}</b> products</span><div><button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</button>{Array.from({ length: totalPages }, (unused, index) => index + 1).filter((number) => Math.abs(number - page) <= 2 || number === 1 || number === totalPages).map((number, index, visible) => <span key={number} style={{ display: 'flex', gap: 3 }}>{index > 0 && number - visible[index - 1] > 1 && <button disabled>…</button>}<button className={number === page ? 'page-number' : ''} onClick={() => setPage(number)}>{number}</button></span>)}<button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>Next</button></div></div></section></>}</main>
      {isModalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsModalOpen(false)}><form className="modal" onSubmit={handleSubmit}><div className="modal-heading"><div><h2>{editingId ? 'Edit product' : 'Add product'}</h2><p className="muted">Keep your catalog details up to date.</p></div><button type="button" className="close-button" onClick={() => setIsModalOpen(false)}><X size={19} /></button></div><label>Product name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Wireless Keyboard" /></label><label>Category<input required list="category-options" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Pilih atau ketik kategori baru" /><datalist id="category-options">{formCategories.map((item) => <option key={item} value={item} />)}</datalist><small className="field-hint">Pilih dari daftar atau ketik kategori baru.</small></label><div className="form-grid"><label>Price<input required min="0" step="0.01" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0.00" /></label><label>Stock<input required min="0" type="number" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="0" /></label></div><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option>Active</option><option>Low stock</option><option>Out of stock</option></select></label><label className="upload-field">Product photo / video<span className="upload-control"><Upload size={16} /><span>{form.media ? form.media.name : 'Choose an image or video'}</span><input type="file" accept="image/*,video/*" onChange={handleMediaChange} /></span><small>JPG, PNG, WEBP atau MP4. Maksimal 5 MB.</small></label>{form.media && <div className="media-preview">{form.media.type.startsWith('video/') ? <video src={form.media.url} controls /> : <img src={form.media.url} alt="Preview produk" />}<button type="button" className="remove-media" onClick={() => setForm({ ...form, media: null })}><X size={14} /> Remove media</button></div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsModalOpen(false)}>Cancel</button><button type="submit" className="primary-button">{editingId ? 'Save changes' : 'Add product'}</button></div></form></div>}
      {pendingProduct && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPendingProduct(null)}><div className="modal"><div className="modal-heading"><div><h2>Delete product</h2><p className="muted">Hapus "{pendingProduct.name}" dari katalog? Tindakan ini permanen.</p></div><button type="button" className="close-button" onClick={() => setPendingProduct(null)}><X size={19} /></button></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPendingProduct(null)}>Cancel</button><button type="button" className="danger-button" onClick={confirmDeleteProduct}><Trash2 size={15} /> Delete</button></div></div></div>}
      <div className="toast-container" role="status" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast ${toast.type}`}>{toast.type === 'success' ? <Check size={15} /> : <X size={15} />}<span>{toast.message}</span></div>)}</div>
    </div>
  )
}

export default App
