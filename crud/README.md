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

`AUTH_TOKEN_SECRET` dipakai untuk menandatangani token login. Di development boleh dikosongkan karena ada fallback lokal; di production server akan menolak start jika secret tidak diisi dengan nilai unik minimal 32 karakter.

Rate limit login dan OTP menggunakan Upstash Redis dengan jendela geser bersama. Buat database Redis di Upstash, lalu isi `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`; keduanya boleh kosong untuk development lokal, tetapi wajib di production. Jika Redis tidak tersedia, endpoint autentikasi menolak permintaan dengan `503` agar pembatasan tidak diam-diam dilewati.

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

## Deploy ke Vercel dengan PostgreSQL Neon

Deploy frontend dan API sebagai dua proyek Vercel dari repository yang sama, dengan root directory `crud`.

1. Proyek frontend: pilih preset Vite, install command `npm ci`, build command `npm run build`, dan output directory `dist`.
2. Proyek API: pilih preset Express. Entry point `index.js` meneruskan request ke API Express.
3. Pada proyek API, tambahkan environment variables:
   - `DATABASE_URL`: connection string PostgreSQL Neon. Jangan gunakan prefix `VITE_`.
   - `AUTH_TOKEN_SECRET`: secret acak yang panjang.
   - `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`: kredensial REST database Upstash Redis untuk rate limit login/OTP.
4. Deploy proyek API, lalu atur `VITE_API_URL` pada proyek frontend ke URL API lengkap, termasuk `/api`, misalnya `https://if-store-api.vercel.app/api`. Deploy ulang frontend setelah mengubah variable ini.
5. Skema database dibuat saat API pertama kali dipanggil. Setelah itu, jalankan `npm run db:admin` satu kali dengan `DATABASE_URL`, `ADMIN_EMAIL`, dan `ADMIN_PASSWORD` tersedia di environment lokal untuk membuat akun admin. Jangan commit nilai rahasia atau file `.env`.

Untuk API lokal, frontend tetap memakai `http://localhost:3001/api`. Jika API di-host pada domain terpisah, atur `VITE_API_URL` ke URL API lengkap, termasuk `/api`.

## Pemasok dan pesanan pembelian

Menu **Suppliers** menyimpan nama pemasok dan informasi kontak; admin dapat menambah, mengubah, dan menghapus pemasok. Pemasok yang sudah dipakai di pesanan pembelian tidak dapat dihapus.

Menu **Purchases** membuat pesanan pembelian berisi pemasok, produk, jumlah, dan harga beli per unit. Pesanan dapat diterima sekaligus atau sebagian. Setiap penerimaan menambah stok produk dan membuat catatan pada **Stock log**; status pesanan berubah dari *Dipesan* ke *Diterima sebagian* lalu *Diterima*. Admin maupun staff yang sudah login dapat membuat pesanan dan mencatat penerimaan.

Daftar produk dapat diimpor dari CSV dengan kolom wajib `Name`, `Category`, `Price`, dan `Stock`; `Status` dan `SKU` opsional. Impor menampilkan pratinjau dan validasi sebelum menyimpan, serta mendukung koma, tanda kutip, dan baris baru di dalam nilai CSV yang dikutip.

Tabel `suppliers`, `purchase_orders`, `purchase_order_items`, `customers`, `sales_orders`, dan `sales_order_items` dibuat otomatis saat server API dijalankan. Endpoint API menggunakan token login:

- `GET /api/suppliers`, `POST /api/suppliers`, `PUT /api/suppliers/:id`, `DELETE /api/suppliers/:id`
- `GET /api/purchases`, `POST /api/purchases`, `POST /api/purchases/:id/receive`

## Pelanggan dan pesanan penjualan

Menu **Customers** menyimpan nama dan kontak pelanggan. Admin dapat menambah, mengubah, dan menghapus data; staff dapat melihatnya. Menu **Sales** digunakan admin maupun staff untuk membuat pesanan atas nama pelanggan terdaftar. Harga jual disalin dari harga produk saat transaksi, stok diperiksa dan dikurangi saat pesanan disimpan, serta setiap pengurangan masuk ke **Stock log**.

Toko online publik tersedia di URL frontend dengan query `?shop=1` (contoh `https://ifal-store.vercel.app/?shop=1`). Pelanggan dapat melihat katalog, mencari produk, membuat keranjang, lalu checkout sebagai tamu untuk pengambilan di toko atau pengiriman. Pesanan online memeriksa dan mengurangi stok dalam transaksi database, tetapi dibuat belum lunas; admin memverifikasi dan mencatat transfer/QRIS secara manual melalui menu **Sales**. Ongkir belum termasuk total dan perlu dikonfirmasi terpisah. Tidak ada payment gateway atau integrasi kurir pada versi ini. Endpoint publik: `GET /api/storefront/products` dan `POST /api/storefront/orders`.

Pesanan berstatus *Dikonfirmasi* setelah dibuat. Pesanan dapat dibatalkan untuk mengembalikan stok yang belum diretur, atau diproses sebagai retur penuh/sebagian yang menambah stok. Perubahan stok akibat penjualan, retur, dan pembatalan dicatat dalam transaksi database agar pesanan, stok, dan stock log tetap sinkron.

Pesanan juga memiliki nomor invoice permanen. Diskon persentase berlaku untuk subtotal pesanan; pajak persentase dihitung atas subtotal setelah diskon. Keduanya dapat ditentukan per transaksi dan default pajak/diskon adalah 0%, sehingga tidak ada pungutan yang diterapkan otomatis. Tarif dan jumlah tersimpan pada pesanan, tampil di POS dan invoice, serta ikut dihitung ulang secara proporsional saat retur sebagian. Dari daftar penjualan, invoice dapat ditinjau dan dicetak atau disimpan sebagai PDF melalui dialog cetak browser. Pembayaran dapat dicatat sebagian maupun lunas, dengan metode tunai, transfer bank, QRIS, kartu, atau lainnya serta referensi transaksi. Status pembayaran mengikuti jumlah tagihan, pembayaran, retur, dan refund; refund dibatasi pada dana yang sudah dibayar dan menjadi berlebih setelah retur atau pembatalan.

Tabel `sales_payments` menyimpan riwayat pembayaran/refund beserta metode, referensi, pencatat, dan waktunya. Endpoint ber-token: `GET /api/customers`, `POST /api/customers`, `PUT /api/customers/:id`, `DELETE /api/customers/:id`, `GET /api/sales`, `POST /api/sales`, `POST /api/sales/:id/payments`, `POST /api/sales/:id/return`, dan `POST /api/sales/:id/cancel`.

## Operasional lanjutan

Toolbar **Fitur lainnya** di bagian bawah aplikasi menyediakan fitur gudang, stok opname, utang pemasok, laporan, piutang, restock, barcode, serta pelacakan batch:

- **Gudang**: stok lama dimigrasikan ke Gudang Utama. Gudang tambahan memiliki saldo produk masing-masing; transfer mengurangi dan menambah gudang terkait tanpa mengubah stok total. Pilih gudang transaksi pada toolbar sebelum membuat pembelian atau penjualan.
- **Stok opname**: catat hitung fisik per gudang. Sistem menyimpan snapshot; jika stok berubah sebelum penyelesaian, opname ditolak agar pergerakan baru tidak tertimpa. Selisih yang diterapkan masuk ke stock log.
- **Log stok**: admin dapat mencari seluruh riwayat berdasarkan produk, gudang, pengguna, atau alasan, serta memfilter stok masuk/keluar dan rentang tanggal. Total hasil ditampilkan; tabel dan ekspor CSV memuat hingga 200 hasil terbaru yang cocok.
- **Utang pemasok dan retur**: pesanan pembelian memiliki tanggal jatuh tempo (default 30 hari). Pembayaran dapat sebagian atau lunas. Retur dibatasi pada jumlah yang diterima dan masih tersedia, mengurangi stok serta saldo utang terkait.
- **Laporan**: ringkasan penjualan bersih setelah diskon (sebelum pajak), diskon, pajak, pembayaran/refund, pembelian, produk terlaris, dan margin kotor setelah diskon berdasarkan harga beli yang tersimpan pada baris penjualan. Pajak ditampilkan terpisah dan tidak dianggap pendapatan/laba. Margin transaksi lama yang tidak memiliki data biaya tidak dapat dihitung. Laporan dapat diekspor ke CSV atau dicetak/disimpan ke PDF.
- **Piutang**: daftar saldo invoice belum lunas beserta umur tagihannya.
- **Restock**: peringatan stok rendah dan rekomendasi jumlah pemesanan berdasarkan ambang rendah produk. Dari rekomendasi, pengguna dapat membuka tinjauan pesanan dengan pemasok, jumlah, biaya beli, dan gudang tujuan sebelum membuat purchase order. Biaya beli terakhir yang pernah diterima diisi sebagai saran; jika belum ada, isi biaya dari pemasok.
- **Barcode/QR**: barcode dapat disimpan pada produk dan dicari dengan scanner USB yang berperilaku seperti keyboard atau dengan mengetik kode. SKU juga dapat dipakai untuk pencarian.
- **Batch/serial/kedaluwarsa**: aktifkan pada produk tertentu. Barang masuk meminta batch; penjualan mengambil batch yang kedaluwarsanya paling dekat dahulu, dan retur mengembalikan alokasi batch asal. Alert menampilkan batch dengan stok tersisa yang sudah kedaluwarsa atau akan kedaluwarsa dalam 30 hari, termasuk produk, gudang, dan jumlah.
- **Biaya operasional & estimasi laba**: admin mencatat pengeluaran per kategori, metode pembayaran, dan referensi. Laporan periode menampilkan total biaya serta estimasi laba operasional (margin kotor dikurangi biaya yang dicatat); angka ini belum mencakup pajak atau biaya yang belum dimasukkan.
- **Backup & pemulihan**: admin dapat mengunduh seluruh data aplikasi sebagai JSON atau memulihkannya dari file. Sebelum pemulihan, aplikasi menampilkan tanggal backup dan jumlah baris tiap tabel; pemulihan baru dapat dijalankan setelah konfirmasi karena proses ini mengganti seluruh data aktif dan mencabut sesi login yang ada. File berisi data usaha serta hash kata sandi; simpan dengan akses terbatas. OTP sementara tidak dimasukkan ke backup.
- **POS cepat**: dari menu Sales, tombol POS cepat menerima input barcode/SKU, membangun keranjang, mendukung pelanggan umum, lalu membuat invoice dan mencatat pembayaran tunai saat checkout.
- **Kas harian**: kasir membuka satu sesi dengan saldo awal, lalu sistem mengaitkan pembayaran/refund tunai dan pengeluaran tunai ke sesi yang aktif. Saat penutupan, sistem membandingkan saldo fisik dengan saldo yang diharapkan serta menyimpan selisih. Pembayaran atau pengeluaran tunai memerlukan sesi terbuka; transaksi non-tunai tetap dapat dicatat tanpa sesi. Sesi hanya dapat ditutup oleh kasir yang membukanya.

Endpoint baru:

- `GET /api/warehouses`, `POST /api/warehouses`, `GET /api/warehouses/:id/stock`, `POST /api/stock-transfers`
- `GET /api/stocktakes`, `POST /api/stocktakes`, `POST /api/stocktakes/:id/complete`
- `GET /api/product-batches`, `POST /api/product-batches`, `GET /api/products/lookup/:code`, `PUT /api/products/:id/metadata`
- `POST /api/purchases/:id/payments`, `POST /api/supplier-returns`, `GET /api/receivables`, `GET /api/reports`, `GET /api/restock-recommendations`
- `GET /api/expenses`, `POST /api/expenses`, `GET /api/backup`, `POST /api/backup/restore`
- `GET /api/cash-sessions`, `POST /api/cash-sessions/open`, `POST /api/cash-sessions/:id/close`

## Autentikasi, MFA, dan reset password

Alur auth bawaan:

- **Login** (`POST /api/auth/login`): jika akun tidak mengaktifkan MFA, server langsung mengembalikan `user` dan `token`. Jika MFA aktif, server membuat kode OTP 6 digit (berlaku 10 menit) dan mengembalikan `requiresOtp` tanpa token.
- **Verifikasi OTP** (`POST /api/auth/otp/verify`) dan **kirim ulang OTP** (`POST /api/auth/otp/resend`): untuk menyelesaikan login MFA.
- **Lupa password** (`POST /api/auth/password/forgot`) dan **reset password** (`POST /api/auth/password/reset`): memakai kode OTP reset terpisah (berlaku 10 menit) untuk mengganti password.
- **Informasi akun**: halaman Users menampilkan tanggal pembuatan akun dan waktu login terakhir. Login MFA dan verifikasi pendaftaran dicatat setelah OTP berhasil diverifikasi; akun yang belum login menampilkan “Belum pernah”.
- **Pencabutan sesi**: setiap token membawa versi autentikasi pengguna. Ganti/reset password, perubahan status akun, atau pemulihan backup menaikkan versi tersebut sehingga token lama langsung ditolak pada permintaan API berikutnya. Setelah mengganti password sendiri, pengguna diminta masuk kembali dengan password baru.

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

- **Backend**: seluruh route `/api/users` (GET, POST, PUT, DELETE) kini butuh `requireAuth` **dan** `requireAdmin`. Role tidak diambil dari token (token hanya memuat ID, versi sesi, dan waktu kedaluwarsa) melainkan diverifikasi langsung dari database. User yang bukan admin aktif ditolak dengan `403` dan pesan `Akses ditolak. Hanya admin yang diizinkan.`. `requireAuth` memeriksa status aktif dan versi sesi pada setiap permintaan API, sehingga token akun nonaktif atau sesi yang sudah dicabut langsung ditolak.
- **Frontend**: menu dan tampilan **Users** disembunyikan untuk staff, dan aplikasi tidak memanggil `GET /api/users` untuk staff. Staff diarahkan ke tampilan products secara default.

Admin dan staff sama-sama dapat melihat/mengelola informasi produk serta menjalankan alur purchase orders dan sales orders. Staf tidak dapat menetapkan stok awal atau mengubah stok langsung di formulir produk/impor; perubahan stok dari transaksi pembelian/penjualan tetap mengikuti alur transaksi normal. Transfer antar gudang, stok opname yang menerapkan selisih, pembuatan gudang, dan penghapusan permanen produk hanya dapat dilakukan admin. Staf tetap dapat melihat daftar gudang, stok per gudang, dan riwayat stok opname.

Pembatasan stok ditegakkan di backend: endpoint produk menolak perubahan stok langsung oleh staf, endpoint impor menolak stok awal positif, dan endpoint transfer/stok opname mensyaratkan role admin aktif. UI juga menyembunyikan kontrol yang tidak dapat digunakan staf.
