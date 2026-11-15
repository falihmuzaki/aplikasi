# Ifal Store Frontend

Etalase publik Ifal Store. Aplikasi ini terpisah dari CMS dan memakai API yang sama.

## Menjalankan lokal

Jalankan API terlebih dahulu dari `cms`:

```bash
cd cms
npm run server
```

Jalankan toko online dari terminal lain:

```bash
cd frontend
npm install
npm run dev
```

Buka http://localhost:5174. Untuk API lokal, frontend memakai `http://localhost:3001/api` secara default. Salin `.env.example` ke `.env` bila URL API atau CMS berbeda.

## Build dan deploy

```bash
npm run build
```

Deploy `frontend` sebagai aplikasi Vite dengan output `dist`. Atur `VITE_API_URL` ke URL publik API lengkap dengan `/api`, dan `VITE_CMS_URL` ke URL halaman login CMS. Nilai `VITE_*` bersifat publik dan tidak boleh berisi secret.
