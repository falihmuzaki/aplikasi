# Implementation Plan: ui-visual-refresh

## Overview

Rencana implementasi ini mengubah tampilan aplikasi inventory/POS Ifal Store menjadi gaya modern SaaS yang bersih dan konsisten. **Seluruh pekerjaan hanya menyentuh berkas `crud/src/App.css` (Stylesheet).** Markup pada `crud/src/App.jsx` dan `crud/src/FeatureViews.jsx` TIDAK boleh diubah (byte-identik), dan tidak ada dependency styling baru yang ditambahkan.

Pendekatan bersifat inkremental dari bawah ke atas kaskade: mulai dari fondasi token (`:root`), lapisan tipografi dasar, lalu penggantian literal warna menjadi token, perapihan komponen inti satu per satu, state interaktif, kontras, responsivitas, dan print-safety. Setiap tugas membangun di atas tugas sebelumnya dan ditutup dengan verifikasi build/lint serta pemeriksaan diff agar tidak ada regresi.

Verifikasi wajib dijalankan di folder `crud` dengan eksekusi sekali jalan (bukan mode watch):
- `npm run build` (Vite) — harus sukses tanpa error.
- `npm run lint` (oxlint) — tidak boleh menghasilkan error baru.
- `git diff` — hanya `crud/src/App.css` yang berubah; `crud/src/App.jsx` dan `crud/src/FeatureViews.jsx` byte-identik.

## Tasks

- [x] 1. Konsolidasi fondasi token pada `:root`
  - Gabungkan dua blok `:root` yang ada menjadi satu sumber kebenaran (*Palet_Aktif*) dengan **mempertahankan nama token lama** (`--ink`, `--muted`, `--line`, `--paper`, `--wash`, `--navy`, `--blue`, `--green`, `--orange`, `--red`) agar setiap `var(--token)` lama tetap valid.
  - Pastikan setiap token warna ter-resolve ke tepat satu nilai akhir (teal/hijau) sesuai deklarasi `:root` final dalam kaskade.
  - Tambahkan token spacing (`--space-1`..`--space-6`), radius (`--radius-sm/md/lg/xl`), dan shadow (`--shadow-card`, `--shadow-pop`) sesuai tabel di design.
  - Tambahkan token turunan untuk hover/surface (mis. `--blue-strong`, `--navy-strong`, `--surface-soft`, `--sidebar-bg`, `--sidebar-ink`) untuk menghapus literal.
  - Tambahkan fallback `var(--token, <nilai-aman>)` pada pemanggilan token kritikal.
  - _Requirements: 2.1, 2.2, 2.5, 3.4, 4.8_
  - _Properties: 6, 7_

- [x] 2. Lapisan tipografi dasar
  - [x] 2.1 Terapkan peran tipografi konsisten pada elemen dasar dan *Kelas_Kontrak*
    - Set Manrope untuk peran heading (heading besar, heading panel) dan DM Sans untuk body/label/eyebrow, sesuai tabel peran tipografi.
    - Gunakan hanya bobot yang aset-nya dirujuk (DM Sans 400/500/600/700; Manrope 600/700/800); hapus keluarga font lain sebagai font utama.
    - Pastikan dua elemen dengan peran teks sama memiliki nilai `font-family`, `font-size`, `font-weight`, dan `line-height` yang identik.
    - _Requirements: 3.1, 3.2, 3.3_
    - _Properties: 8_

- [x] 3. Ganti nilai warna literal menjadi `var(--token)`
  - [x] 3.1 Konversi literal hex/rgb/hsl pada aturan *Kelas_Kontrak* ke `var(--token)`
    - Ganti nilai literal untuk peran bertoken (teks `--ink`/`--muted`, garis `--line`, latar `--paper`/`--wash`, aksen `--navy`/`--blue`/`--green`/`--orange`/`--red`).
    - Untuk warna turunan (hover gelap, surface lembut) gunakan token turunan dari tugas 1, bukan memaksakan token yang salah peran.
    - Biarkan rgba dekoratif murni (mis. bayangan transparan) sebagai nilai bila tidak punya peran token.
    - _Requirements: 2.3, 2.4_
    - _Properties: 5_

- [x] 4. Rapikan sidebar, topbar, dan welcome row
  - [x] 4.1 Terapkan warna *Palet_Aktif* dan skala spacing pada ketiga area
    - Sidebar gelap teal via token; warna teks nav dan state dirujuk via token; padding/gap dari skala spacing.
    - Topbar + welcome row terang: judul Manrope, subteks `--muted`; breadcrumb/sync-status/pulse memakai token status.
    - Pastikan elemen sejenis di ketiga area memakai nilai warna dan langkah spacing yang identik.
    - _Requirements: 4.1_
    - _Properties: 9_

- [x] 5. Konsistenkan kartu statistik `.stats-grid` / `.stat-card`
  - [x] 5.1 Seragamkan border, radius, dan shadow kartu statistik
    - Setiap `.stat-card` memakai nilai `border-width`, `border-radius` (dari `--radius-lg`), dan `box-shadow` (dari `--shadow-card`) yang identik.
    - Petakan ikon status (`.stat-icon.blue/green/orange/red`) ke token peran warna + latar lembutnya.
    - _Requirements: 4.2_
    - _Properties: 10_

- [x] 6. Rapikan panel katalog dan tabel `.catalog-panel`, `table`, `th`, `td`
  - [x] 6.1 Seragamkan padding sel dan garis pemisah baris
    - `.catalog-panel` memakai radius/shadow dari token yang sama dengan kartu.
    - Semua `td` dalam satu tabel memakai padding identik (satu langkah spacing); `border-top` baris memakai `var(--line)` dengan ketebalan identik.
    - `th` memakai latar wash + teks muted.
    - _Requirements: 4.3_
    - _Properties: 11_

- [x] 7. Tata modal dan backdrop `.modal` / `.modal-backdrop`
  - [x] 7.1 Terapkan radius/shadow token dan pertahankan urutan penumpukan
    - `.modal` memakai `--radius-xl` dan `--shadow-pop`.
    - `.modal-backdrop` tetap `position: fixed; inset: 0` dengan z-index di bawah modal dan di atas konten biasa; urutan penumpukan tidak diubah.
    - _Requirements: 4.4, 9.3_
    - _Properties: 25_

- [x] 8. Bedakan tombol `.primary-button`, `.secondary-button`, `.danger-button`
  - [x] 8.1 Terapkan latar yang saling berbeda via token
    - primary = aksen utama (navy/teal), secondary = netral (paper + border line), danger = `--red`; semua dirujuk via token.
    - Pastikan ketiga latar saling berbeda.
    - _Requirements: 4.5_
    - _Properties: 12_

- [x] 9. Tata badge `.status`, `.role-badge`, `.purchase-status`
  - [x] 9.1 Bedakan warna tiap nilai status dan pertahankan pembeda non-warna
    - Setiap nilai status berbeda memiliki warna latar/teks berbeda (mis. `.active` hijau, `.low-stock` oranye, `.out-of-stock` merah; `.role-badge.admin` vs `.staff`; `.purchase-status.*`).
    - Pertahankan pembeda non-warna yang sudah ada di Markup (titik `.status span`, label teks, bentuk kapsul) tanpa mengubah Markup.
    - _Requirements: 4.6, 6.4_
    - _Properties: 13, 14_

- [x] 10. Rapikan toast, notif-panel, login, feature-launcher/overlay
  - [x] 10.1 Terapkan token & spacing dan konsolidasikan duplikasi `.feature-launcher`
    - `.toast` (success/error), `.notif-panel`, `.login-card`, `.feature-overlay` memakai warna *Palet_Aktif* dan langkah spacing yang sama untuk elemen sejenis.
    - Gabungkan tiga definisi `.feature-launcher` menjadi satu definisi efektif yang hasil akhirnya identik dengan definisi terakhir yang berlaku (varian fixed bar kanan-bawah: `.feature-launcher-bar`, `.feature-menu-toggle`, `.feature-menu-items`, `.feature-warehouse`), lalu rapikan aturan responsifnya tanpa mengubah posisi/perilaku akhir.
    - _Requirements: 4.7, 1.3_
    - _Properties: 9_

- [x] 11. Standarisasi state interaktif
  - [x] 11.1 Terapkan hover, active (pressed), dan disabled yang konsisten
    - Hover tombol/nav-item tidak disabled berbeda dari default pada minimal satu properti teramati.
    - Active/pressed berbeda dari hover maupun default pada minimal satu properti.
    - Disabled berbeda dari aktif (opasitas/latar/teks) dan menonaktifkan perubahan hover.
    - Nav-item `active` berbeda dari non-aktif pada minimal satu properti teramati.
    - _Requirements: 5.1, 5.3, 5.4, 5.5_
    - _Properties: 15, 17, 18, 19_

  - [x] 11.2 Tegaskan indikator focus-visible dan pertahankan `prefers-reduced-motion`
    - focus-visible berupa outline/ring ≥ 2px, berbeda warna dari latar elemen, kontras ≥ 3:1 terhadap latar berdekatan.
    - Pertahankan `:focus-visible` global dan `@media (prefers-reduced-motion: reduce)` yang sudah ada (rapikan, jangan dihapus).
    - _Requirements: 5.2, 6.3_
    - _Properties: 16_

- [x] 12. Periksa dan sesuaikan kontras WCAG
  - [x] 12.1 Pastikan pasangan teks/latar memenuhi ambang kontras
    - Pastikan teks normal ≥ 4.5:1 dan teks besar ≥ 3:1 pada setiap komponen *Kelas_Kontrak*.
    - Jika suatu perubahan menurunkan kontras di bawah ambang, pertahankan nilai lama yang memenuhi (jangan diturunkan).
    - _Requirements: 6.1, 6.2, 6.5_
    - _Properties: 20_

- [x] 13. Pertahankan responsivitas lintas breakpoint
  - [x] 13.1 Jaga semua breakpoint dan perilaku responsif
    - Pertahankan aturan responsif pada 900/1180/760/720/640px tanpa menghapus/menonaktifkan.
    - Grid statistik satu kolom per baris pada ≤ 640px; sidebar/toolbar/tabel tidak melebihi lebar viewport maupun tumpang tindih.
    - Tabel menggulir horizontal bila kontennya lebih lebar dari kontainer; tidak ada horizontal scroll di tingkat halaman pada 320px–1920px.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
    - _Properties: 21, 22, 23_

- [x] 14. Pastikan print-safety tetap utuh
  - [x] 14.1 Pertahankan `@media print` untuk invoice dan laporan
    - Jangan hapus/ubah selektor di dalam blok `@media print`.
    - Cetak invoice menampilkan hanya `.invoice-print` dan turunannya; cetak laporan menampilkan hanya `.feature-overlay.report-print` dan turunannya; `.no-print` selalu disembunyikan.
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
    - _Properties: 24_

- [x] 15. Checkpoint - Pastikan semua tes/verifikasi lolos
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Verifikasi non-regresi akhir
  - [x] 16.1 Jalankan build dan lint serta pemeriksaan non-regresi statis
    - Jalankan `npm run build` di folder `crud` (sekali jalan) — harus sukses.
    - Jalankan `npm run lint` di folder `crud` — tidak ada error baru.
    - Jalankan `git diff` dan pastikan satu-satunya berkas berubah adalah `crud/src/App.css`; `crud/src/App.jsx` dan `crud/src/FeatureViews.jsx` byte-identik.
    - Verifikasi setiap selektor kelas pada Stylesheet merujuk *Kelas_Kontrak*; tidak ada `@import`/`url(` baru selain aset font DM Sans/Manrope.
    - Verifikasi setiap elemen interaktif yang sebelumnya terlihat tetap terlihat & dapat diklik (kecuali `.sr-only`, responsif < 768px, dan Print_Styles) serta urutan z-index dipertahankan.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 9.1, 9.2, 9.3, 9.5_
    - _Properties: 1, 2, 3, 4, 26_

## Notes

- Seluruh perubahan hanya pada `crud/src/App.css`; Markup JSX tidak diubah dan tidak ada dependency baru.
- Tiap tugas merujuk requirement (dan properti bila relevan) untuk keterlacakan.
- Verifikasi menggunakan eksekusi sekali jalan: `npm run build` dan `npm run lint` di folder `crud`. Hindari `npm run dev` (mode watch) dalam pipeline verifikasi.
- Fitur ini presentasional murni, sehingga tidak ada property-based test bergaya input acak; properti korektikas diperiksa sebagai invarian statis (analisis teks CSS + diff Markup) dan verifikasi visual/kontras/print/responsif.
- Checkpoint memastikan validasi inkremental sebelum verifikasi akhir.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["4.1", "5.1", "6.1", "7.1", "8.1", "9.1", "10.1"] },
    { "id": 3, "tasks": ["11.1", "11.2"] },
    { "id": 4, "tasks": ["12.1", "13.1", "14.1"] },
    { "id": 5, "tasks": ["16.1"] }
  ]
}
```
