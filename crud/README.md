# Lumina CRUD

Aplikasi inventory CRUD dengan React, Vite, Express, dan PostgreSQL.

## Setup PostgreSQL

1. Di pgAdmin, buat database bernama `apps`.
2. Salin `.env.example` menjadi `.env`.
3. Isi password PostgreSQL langsung di `.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/apps
PORT=3001
AUTH_TOKEN_SECRET=isi-dengan-nilai-acak-panjang
```

`AUTH_TOKEN_SECRET` dipakai untuk menandatangani token login. Di development boleh dikosongkan karena ada fallback di kode, tapi di production wajib diisi nilai acak yang panjang.

Saat server API dijalankan, tabel `products`, `users`, `categories`, `suppliers`, pesanan pembelian, kolom auth/MFA, dan index dibuat otomatis dari `server/schema.sql`.

## Menjalankan aplikasi

Terminal pertama:

```bash
npm run server
```

Terminal kedua:

```bash
npm run dev
```

Buka http://localhost:5173 dan login dengan akun demo:

- Email: `admin@lumina.test`
- Password: `lumina123`

Jika PostgreSQL belum aktif, dashboard tetap berjalan dalam local mode. Jika API aktif, operasi tambah, edit, hapus, dan pemuatan data menggunakan PostgreSQL.

## Pemasok dan pesanan pembelian

Menu **Suppliers** menyimpan nama pemasok dan informasi kontak; admin dapat menambah, mengubah, dan menghapus pemasok. Pemasok yang sudah dipakai di pesanan pembelian tidak dapat dihapus.

Menu **Purchases** membuat pesanan pembelian berisi pemasok, produk, jumlah, dan harga beli per unit. Pesanan dapat diterima sekaligus atau sebagian. Setiap penerimaan menambah stok produk dan membuat catatan pada **Stock log**; status pesanan berubah dari *Dipesan* ke *Diterima sebagian* lalu *Diterima*. Admin maupun staff yang sudah login dapat membuat pesanan dan mencatat penerimaan.

Tabel `suppliers`, `purchase_orders`, `purchase_order_items`, `customers`, `sales_orders`, dan `sales_order_items` dibuat otomatis saat server API dijalankan. Endpoint API menggunakan token login:

- `GET /api/suppliers`, `POST /api/suppliers`, `PUT /api/suppliers/:id`, `DELETE /api/suppliers/:id`
- `GET /api/purchases`, `POST /api/purchases`, `POST /api/purchases/:id/receive`

## Pelanggan dan pesanan penjualan

Menu **Customers** menyimpan nama dan kontak pelanggan. Admin dapat menambah, mengubah, dan menghapus data; staff dapat melihatnya. Menu **Sales** digunakan admin maupun staff untuk membuat pesanan atas nama pelanggan terdaftar. Harga jual disalin dari harga produk saat transaksi, stok diperiksa dan dikurangi saat pesanan disimpan, serta setiap pengurangan masuk ke **Stock log**.

Pesanan berstatus *Dikonfirmasi* setelah dibuat. Pesanan dapat dibatalkan untuk mengembalikan stok yang belum diretur, atau diproses sebagai retur penuh/sebagian yang menambah stok. Perubahan stok akibat penjualan, retur, dan pembatalan dicatat dalam transaksi database agar pesanan, stok, dan stock log tetap sinkron.

Endpoint penjualan ber-token: `GET /api/customers`, `POST /api/customers`, `PUT /api/customers/:id`, `DELETE /api/customers/:id`, `GET /api/sales`, `POST /api/sales`, `POST /api/sales/:id/return`, dan `POST /api/sales/:id/cancel`.

## Autentikasi, MFA, dan reset password

Alur auth bawaan:

- **Login** (`POST /api/auth/login`): jika akun tidak mengaktifkan MFA, server langsung mengembalikan `user` dan `token`. Jika MFA aktif, server membuat kode OTP 6 digit (berlaku 10 menit) dan mengembalikan `requiresOtp` tanpa token.
- **Verifikasi OTP** (`POST /api/auth/otp/verify`) dan **kirim ulang OTP** (`POST /api/auth/otp/resend`): untuk menyelesaikan login MFA.
- **Lupa password** (`POST /api/auth/password/forgot`) dan **reset password** (`POST /api/auth/password/reset`): memakai kode OTP reset terpisah (berlaku 10 menit) untuk mengganti password.

MFA per user bisa dinyalakan lewat opsi **Enable email OTP MFA** di form Add/Edit user.

### Di mana melihat kode OTP

Ada dua mode, tergantung konfigurasi `MAIL_*` di `.env`:

- **Tanpa konfigurasi `MAIL_*`** (default development): kode OTP tetap **dicetak ke console server API** — yaitu terminal tempat Anda menjalankan `npm run server`. Cari baris berawalan `[DEV OTP]`.
- **Dengan `MAIL_*` terisi**: kode OTP **dikirim ke email user via SMTP** dan **tidak lagi dicetak** ke console. Lihat `.env.example` untuk daftar variabel (`MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_ENCRYPTION`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`).

Untuk Gmail, isi `MAIL_USERNAME`/`MAIL_PASSWORD` dengan App Password (bukan password akun biasa).

Token login dikirim frontend sebagai header `Authorization: Bearer <token>`. Endpoint produk, pemasok, dan pembelian serta perubahan users membutuhkan token tersebut.

## Hak akses (privilege)

Model privilege bawaan berbasis kolom `role` pada tabel `users` (`admin` atau `staff`):

- **Admin**: dapat mengelola **users**, **suppliers**, dan **customers** (lihat/tambah/edit/hapus).
- **Staff**: dapat mengakses **products**, melihat **suppliers**/**customers**, membuat pesanan pembelian/penjualan, dan mencatat penerimaan/retur stok. Staff **tidak bisa** mengelola users atau mengubah data pemasok/pelanggan.

Penegakan di dua lapis:

- **Backend**: seluruh route `/api/users` (GET, POST, PUT, DELETE) kini butuh `requireAuth` **dan** `requireAdmin`. Role tidak diambil dari token (token hanya memuat `{uid, exp}`) melainkan diverifikasi langsung dari database. User yang bukan admin aktif ditolak dengan `403` dan pesan `Akses ditolak. Hanya admin yang diizinkan.`.
- **Frontend**: menu dan tampilan **Users** disembunyikan untuk staff, dan aplikasi tidak memanggil `GET /api/users` untuk staff. Staff diarahkan ke tampilan products secara default.

Admin dan staff sama-sama dapat melihat/mengubah products serta mengelola alur purchase orders dan sales orders. Penerimaan pembelian dan retur/pembatalan penjualan menambah stok; penjualan menguranginya. Semua dicatat pada stock log.
