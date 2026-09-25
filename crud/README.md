# Lumina CRUD

Aplikasi inventory CRUD dengan React, Vite, Express, dan PostgreSQL.

## Setup PostgreSQL

1. Di pgAdmin, buat database bernama `apps`.
2. Salin `.env.example` menjadi `.env`.
3. Isi password PostgreSQL langsung di `.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/apps
PORT=3001
```

Saat server API dijalankan, tabel `products` dan index-nya dibuat otomatis dari `server/schema.sql`.

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
