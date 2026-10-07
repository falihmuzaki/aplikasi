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

Saat server API dijalankan, tabel `products`, `users`, kolom auth/MFA, dan index-nya dibuat otomatis dari `server/schema.sql`.

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

Token login dikirim frontend sebagai header `Authorization: Bearer <token>`. Endpoint `GET /api/products`, `GET /api/users`, dan seluruh perubahan `/api/users` membutuhkan token tersebut.
