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
const blankForm = { name: '', category: 'Electronics', price: '', stock: '', status: 'Active', media: null }
const blankUser = { name: '', email: '', password: '', role: 'staff', isActive: true }
const API_URL = 'http://localhost:3001/api'
const getInitials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')

function UsersView({ users, onSave, onDelete }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankUser)
  const filteredUsers = users.filter((user) => `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(query.toLowerCase()))
  const openCreate = () => { setEditingId(null); setForm(blankUser); setIsOpen(true) }
  const openEdit = (user) => { setEditingId(user.id); setForm({ ...user, password: '' }); setIsOpen(true) }
  const submit = async (event) => { event.preventDefault(); await onSave(form, editingId); setIsOpen(false) }

  return <>
    <header className="topbar"><div><p className="breadcrumb">Workspace / <span>Users</span></p><h1>User management</h1></div><button className="primary-button" onClick={openCreate}><UserPlus size={18} /> Add user</button></header>
    <section className="welcome-row"><div><p className="muted">Access and permissions</p><h2>Workspace users</h2><p className="muted">Manage who can access your inventory workspace.</p></div><div className="sync-status"><span className="pulse"></span> PostgreSQL synced</div></section>
    <section className="catalog-panel"><div className="panel-heading"><div><h2>All users</h2><p className="muted">{users.length} registered account{users.length === 1 ? '' : 's'}.</p></div></div><div className="toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users..." /></label></div><div className="table-wrap"><table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td><div className="product-cell"><span className="user-avatar"><UserRound size={16} /></span><strong>{user.name}</strong></div></td><td>{user.email}</td><td><span className={`role-badge ${user.role}`}>{user.role}</span></td><td><span className={`status ${user.isActive ? 'active' : 'out-of-stock'}`}><span></span>{user.isActive ? 'Active' : 'Inactive'}</span></td><td><div className="actions"><button title="Edit user" onClick={() => openEdit(user)}><Pencil size={16} /></button><button title="Delete user" onClick={() => onDelete(user.id)}><Trash2 size={16} /></button></div></td></tr>)}{filteredUsers.length === 0 && <tr><td colSpan="5" className="empty-state">No users match your search.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{filteredUsers.length}</b> of <b>{users.length}</b> users</span></div></section>
    {isOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}><form className="modal" onSubmit={submit}><div className="modal-heading"><div><h2>{editingId ? 'Edit user' : 'Add user'}</h2><p className="muted">Set account access and permissions.</p></div><button type="button" className="close-button" onClick={() => setIsOpen(false)}><X size={19} /></button></div><label>Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Alex Rivera" /></label><label>Email address<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@company.com" /></label><label>Password{editingId && <small className="field-hint">Leave empty to keep the current password.</small>}<input required={!editingId} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingId ? 'Optional new password' : 'Create a password'} /></label><label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="admin">Admin</option><option value="staff">Staff</option></select></label><label className="toggle-row"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Active account</label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsOpen(false)}>Cancel</button><button type="submit" className="primary-button">{editingId ? 'Save changes' : 'Add user'}</button></div></form></div>}
  </>
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('lumina-auth') === 'true')
  const [currentUser, setCurrentUser] = useState(() => JSON.parse(localStorage.getItem('lumina-user') || 'null'))
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [loginError, setLoginError] = useState('')
  const [products, setProducts] = useState(() => JSON.parse(localStorage.getItem('lumina-products') || 'null') || seedProducts)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All status')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(blankForm)
  const [databaseOnline, setDatabaseOnline] = useState(false)
  const [users, setUsers] = useState([])
  const [activeView, setActiveView] = useState('products')
  useEffect(() => localStorage.setItem('lumina-products', JSON.stringify(products)), [products])
  useEffect(() => {
    if (!isAuthenticated) return
    fetch(`${API_URL}/products`).then((response) => { if (!response.ok) throw new Error('API unavailable'); return response.json() }).then((data) => { setProducts(data); setDatabaseOnline(true) }).catch(() => setDatabaseOnline(false))
  }, [isAuthenticated])
  useEffect(() => {
    if (!isAuthenticated) return
    fetch(`${API_URL}/users`).then((response) => { if (!response.ok) throw new Error('API unavailable'); return response.json() }).then((data) => { setUsers(data); setDatabaseOnline(true) }).catch(() => setDatabaseOnline(false))
  }, [isAuthenticated])
  const filteredProducts = useMemo(() => products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All status' || product.status === filter)), [products, query, filter])
  const totalValue = products.reduce((sum, product) => sum + product.price * product.stock, 0)
  const activeProducts = products.filter((product) => product.status === 'Active').length
  const lowStock = products.filter((product) => product.status === 'Low stock' || product.stock === 0).length
  const handleLogin = async (event) => {
    event.preventDefault()
    try {
      const response = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) })
      if (!response.ok) { const error = await response.json(); throw new Error(error.message) }
      const result = await response.json()
      localStorage.setItem('lumina-auth', 'true')
      localStorage.setItem('lumina-user', JSON.stringify(result.user))
      setCurrentUser(result.user)
      setIsAuthenticated(true)
      setLoginError('')
    } catch (error) { setLoginError(error.message || 'Login gagal. Pastikan API aktif.') }
  }
  const handleLogout = () => { localStorage.removeItem('lumina-auth'); localStorage.removeItem('lumina-user'); setCurrentUser(null); setIsAuthenticated(false); setLoginForm({ email: '', password: '' }) }
  const openCreateModal = () => { setEditingId(null); setForm(blankForm); setIsModalOpen(true) }
  const openEditModal = (product) => { setEditingId(product.id); setForm({ ...product, price: String(product.price), stock: String(product.stock) }); setIsModalOpen(true) }
  const handleMediaChange = (event) => {
    const file = event.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { window.alert('Ukuran file maksimal 5 MB.'); event.target.value = ''; return }
    const reader = new FileReader()
    reader.onload = () => setForm((current) => ({ ...current, media: { name: file.name, type: file.type, url: reader.result } }))
    reader.readAsDataURL(file)
  }
  const handleSubmit = async (event) => { event.preventDefault(); const stock = Number(form.stock) || 0; const product = { ...form, price: Number(form.price) || 0, stock, status: stock === 0 ? 'Out of stock' : form.status }; try { const response = await fetch(`${API_URL}/products${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(product) }); if (!response.ok) throw new Error('Save failed'); const savedProduct = await response.json(); setProducts((current) => editingId ? current.map((item) => item.id === editingId ? savedProduct : item) : [savedProduct, ...current]); setDatabaseOnline(true) } catch { setProducts((current) => editingId ? current.map((item) => item.id === editingId ? { ...product, id: editingId } : item) : [{ ...product, id: Date.now() }, ...current]); setDatabaseOnline(false) } setIsModalOpen(false) }
  const removeProduct = async (id) => { if (!window.confirm('Hapus produk ini dari katalog?')) return; try { const response = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' }); if (!response.ok) throw new Error('Delete failed'); setDatabaseOnline(true) } catch { setDatabaseOnline(false) } setProducts((current) => current.filter((product) => product.id !== id)) }
  const saveUser = async (user, editingId) => { try { const response = await fetch(`${API_URL}/users${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) }); if (!response.ok) { const error = await response.json(); throw new Error(error.message) } const savedUser = await response.json(); setUsers((current) => editingId ? current.map((item) => item.id === editingId ? savedUser : item) : [savedUser, ...current]); setDatabaseOnline(true) } catch (error) { window.alert(error.message || 'User gagal disimpan.') } }
  const removeUser = async (id) => { if (!window.confirm('Hapus user ini dari workspace?')) return; try { const response = await fetch(`${API_URL}/users/${id}`, { method: 'DELETE' }); if (!response.ok) throw new Error('Delete failed'); setUsers((current) => current.filter((user) => user.id !== id)); setDatabaseOnline(true) } catch { window.alert('User gagal dihapus. Pastikan API aktif.') } }

  if (!isAuthenticated) return <div className="login-page"><div className="login-decoration"><span className="decoration-grid"></span><span className="decoration-sun"></span></div><form className="login-card" onSubmit={handleLogin}><div className="login-brand"><span className="brand-mark"><Activity size={18} /></span><span>Lumina</span></div><p className="eyebrow">Welcome back</p><h1>Sign in to your workspace</h1><p className="login-subtitle">Manage your products and inventory in one calm place.</p><label>Email address<input autoFocus required type="email" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} placeholder="you@company.com" /></label><label>Password<input required type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="Enter your password" /></label>{loginError && <p className="login-error">{loginError}</p>}<button className="primary-button login-button" type="submit">Sign in <ChevronDown size={16} className="login-arrow" /></button><p className="demo-hint">Use an active account from the users table.</p></form></div>

  return (
    <div className="app-shell">
      <aside className="sidebar"><div className="brand"><span className="brand-mark"><Activity size={18} /></span><span>Lumina</span></div><p className="eyebrow">Workspace</p><nav><button className={`nav-item ${activeView === 'products' ? 'active' : ''}`} onClick={() => setActiveView('products')}><LayoutDashboard size={18} /> Overview</button><button className={`nav-item ${activeView === 'users' ? 'active' : ''}`} onClick={() => setActiveView('users')}><UserRound size={18} /> Users <span className="nav-count">{users.length}</span></button></nav><div className="sidebar-bottom"><div className="avatar">{getInitials(currentUser?.name || 'User')}</div><div><strong>{currentUser?.name || 'User'}</strong><span>{currentUser?.role || 'User'}</span></div><button className="logout-button" title="Log out" onClick={handleLogout}><LogOut size={15} /></button></div></aside>
      <main className="main-content">{activeView === 'users' ? <UsersView users={users} onSave={saveUser} onDelete={removeUser} /> : <><header className="topbar"><div><p className="breadcrumb">Workspace / <span>Products</span></p><h1>Product inventory</h1></div><button className="primary-button" onClick={openCreateModal}><CirclePlus size={18} /> Add product</button></header><section className="welcome-row"><div><p className="muted">Thursday, September 24, 2026</p><h2>Good morning, Alex <span className="spark">✦</span></h2><p className="muted">Here is what's happening with your inventory today.</p></div><div className="sync-status"><span className={`pulse ${databaseOnline ? '' : 'offline'}`}></span> {databaseOnline ? 'PostgreSQL synced' : 'Local mode'}</div></section>
          <section className="stats-grid"><div className="stat-card"><div className="stat-label"><span>Total products</span><span className="stat-icon blue"><Box size={17} /></span></div><strong>{products.length}</strong><small><b className="positive">+12.5%</b> vs last month</small></div><div className="stat-card"><div className="stat-label"><span>Inventory value</span><span className="stat-icon green">$</span></div><strong>${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong><small><b className="positive">+8.2%</b> vs last month</small></div><div className="stat-card"><div className="stat-label"><span>Active products</span><span className="stat-icon orange"><Check size={17} /></span></div><strong>{activeProducts}</strong><small><b className="positive">+4.1%</b> vs last month</small></div><div className="stat-card"><div className="stat-label"><span>Needs attention</span><span className="stat-icon red"><Activity size={17} /></span></div><strong>{lowStock}</strong><small><b className="negative">Requires review</b></small></div></section>
          <section className="catalog-panel"><div className="panel-heading"><div><h2>All products</h2><p className="muted">Manage your catalog and inventory levels.</p></div><button className="filter-button"><ArrowDownUp size={15} /> Export <ChevronDown size={14} /></button></div><div className="toolbar"><label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products..." /></label><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All status</option><option>Active</option><option>Low stock</option><option>Out of stock</option></select><button className="filter-button"><Settings2 size={15} /> Filters</button></div><div className="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filteredProducts.map((product) => <tr key={product.id}><td><div className="product-cell">{product.media ? <span className="media-thumb">{product.media.type.startsWith('video/') ? <video src={product.media.url} muted /> : <img src={product.media.url} alt="" />}<span className="media-type">{product.media.type.startsWith('video/') ? <Video size={10} /> : <ImageIcon size={10} />}</span></span> : <span className={`product-avatar avatar-${product.id % 4}`}><PackageSearch size={18} /></span>}<strong>{product.name}</strong></div></td><td>{product.category}</td><td className="price">${product.price.toFixed(2)}</td><td>{product.stock} units</td><td><span className={`status ${product.status.toLowerCase().replace(' ', '-')}`}><span></span>{product.status}</span></td><td><div className="actions"><button title="Edit product" onClick={() => openEditModal(product)}><Pencil size={16} /></button><button title="Delete product" onClick={() => removeProduct(product.id)}><Trash2 size={16} /></button></div></td></tr>)}{filteredProducts.length === 0 && <tr><td colSpan="6" className="empty-state">No products match your search.</td></tr>}</tbody></table></div><div className="table-footer"><span>Showing <b>{filteredProducts.length}</b> of <b>{products.length}</b> products</span><div><button disabled>Previous</button><button className="page-number">1</button><button disabled>Next</button></div></div></section></>}</main>
      {isModalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsModalOpen(false)}><form className="modal" onSubmit={handleSubmit}><div className="modal-heading"><div><h2>{editingId ? 'Edit product' : 'Add product'}</h2><p className="muted">Keep your catalog details up to date.</p></div><button type="button" className="close-button" onClick={() => setIsModalOpen(false)}><X size={19} /></button></div><label>Product name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Wireless Keyboard" /></label><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Electronics</option><option>Home & Living</option><option>Accessories</option><option>Fashion</option></select></label><div className="form-grid"><label>Price<input required min="0" step="0.01" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0.00" /></label><label>Stock<input required min="0" type="number" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="0" /></label></div><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option>Active</option><option>Low stock</option><option>Out of stock</option></select></label><label className="upload-field">Product photo / video<span className="upload-control"><Upload size={16} /><span>{form.media ? form.media.name : 'Choose an image or video'}</span><input type="file" accept="image/*,video/*" onChange={handleMediaChange} /></span><small>JPG, PNG, WEBP atau MP4. Maksimal 5 MB.</small></label>{form.media && <div className="media-preview">{form.media.type.startsWith('video/') ? <video src={form.media.url} controls /> : <img src={form.media.url} alt="Preview produk" />}<button type="button" className="remove-media" onClick={() => setForm({ ...form, media: null })}><X size={14} /> Remove media</button></div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsModalOpen(false)}>Cancel</button><button type="submit" className="primary-button">{editingId ? 'Save changes' : 'Add product'}</button></div></form></div>}
    </div>
  )
}

export default App
