# Requirements Document

## Introduction

Fitur ui-visual-refresh melakukan refresh visual menyeluruh ("redesign template UI/UX") pada aplikasi inventory/POS Ifal Store. Tujuannya adalah memperbarui tampilan menjadi gaya modern SaaS yang bersih dan rapi melalui perbaikan palet warna, tipografi, spacing, serta penampilan komponen inti (sidebar, topbar, kartu statistik, tabel, panel katalog, modal, tombol, badge, toast, halaman login, panel notifikasi, feature launcher/overlay, dan invoice).

Batasan mutlak: seluruh perubahan hanya dilakukan pada lapisan styling di file `crud/src/App.css`. Struktur JSX pada `crud/src/App.jsx` dan `crud/src/FeatureViews.jsx` tidak boleh diubah, tidak ada dependency baru yang ditambahkan (tanpa Tailwind atau framework CSS lain), dan seluruh fitur, layout, perilaku, serta hierarki navigasi aplikasi harus tetap berfungsi persis seperti sekarang. Refresh ini bersifat murni presentasional dan tidak boleh mengubah perilaku fungsional aplikasi.

## Glossary

- **Stylesheet**: File `crud/src/App.css` yang menjadi satu-satunya sumber aturan styling aplikasi dan satu-satunya file yang dimodifikasi oleh fitur ini.
- **Markup**: Struktur JSX pada `crud/src/App.jsx` dan `crud/src/FeatureViews.jsx`, termasuk seluruh elemen, nama kelas CSS, dan atribut yang sudah ada.
- **Kelas_Kontrak**: Kumpulan nama kelas CSS yang sudah dirujuk oleh Markup (misalnya `.app-shell`, `.sidebar`, `.nav-item`, `.main-content`, `.topbar`, `.welcome-row`, `.stats-grid`, `.stat-card`, `.catalog-panel`, `.toolbar`, `.search-box`, `.status`, `.modal`, `.modal-backdrop`, `.primary-button`, `.secondary-button`, `.danger-button`, `.toast`, `.login-page`, `.login-card`, `.notif-panel`, `.feature-launcher`, `.feature-overlay`, `.invoice-print`) beserta elemen `table`, `th`, dan `td`.
- **Token_Desain**: Variabel CSS custom property yang didefinisikan pada selector `:root` (contoh `--ink`, `--muted`, `--line`, `--paper`, `--wash`, `--navy`, `--blue`, `--green`, `--orange`, `--red`).
- **Palet_Aktif**: Nilai Token_Desain yang efektif berlaku setelah seluruh blok `:root` pada Stylesheet dievaluasi oleh kaskade CSS.
- **Rasio_Kontras**: Perbandingan luminansi antara warna teks dan warna latar sesuai metode perhitungan WCAG 2.1.
- **Breakpoint**: Lebar viewport tempat aturan `@media (max-width: ...)` mengubah tata letak, yaitu 900px, 760px, 720px, dan 640px.
- **Print_Styles**: Aturan di dalam blok `@media print` pada Stylesheet yang mengatur tampilan cetak invoice dan laporan.
- **State_Interaktif**: Kondisi visual elemen interaktif, mencakup hover, focus-visible, active, dan disabled.

## Requirements

### Requirement 1: Integritas Markup dan Kontrak Kelas

**User Story:** Sebagai developer, saya ingin refresh visual tidak menyentuh struktur JSX, sehingga seluruh fitur dan perilaku aplikasi tetap utuh.

#### Acceptance Criteria

1. WHEN fitur ui-visual-refresh selesai diterapkan, THE berkas crud/src/App.css SHALL menjadi satu-satunya berkas yang dimodifikasi oleh fitur ui-visual-refresh.
2. WHEN fitur ui-visual-refresh selesai diterapkan, THE Markup pada crud/src/App.jsx dan crud/src/FeatureViews.jsx SHALL tetap identik byte-per-byte dengan versi sebelum fitur ui-visual-refresh.
3. THE Stylesheet SHALL mendefinisikan aturan hanya untuk nama kelas dan elemen yang sudah ada pada Kelas_Kontrak.
4. IF sebuah aturan styling membutuhkan hasil visual tertentu, THEN THE Stylesheet SHALL mencapainya melalui selektor atas struktur dan kelas yang sudah ada tanpa menambah, menghapus, atau mengubah Markup.
5. THE Stylesheet SHALL tidak mengimpor atau mereferensikan dependency styling eksternal baru selain aset font yang sudah dipakai sebelumnya.
6. IF suatu perubahan berada di luar crud/src/App.css atau memperkenalkan dependency styling baru, THEN THE perubahan tersebut SHALL ditolak dan Markup sebelumnya SHALL dipertahankan.

### Requirement 2: Palet Warna Terpusat

**User Story:** Sebagai desainer, saya ingin palet warna modern yang dikelola melalui token terpusat, sehingga tampilan konsisten di seluruh aplikasi.

#### Acceptance Criteria

1. THE Stylesheet SHALL mendefinisikan sepuluh Token_Desain warna (--ink, --muted, --line, --paper, --wash, --navy, --blue, --green, --orange, --red) pada selector `:root` sehingga setiap token dapat di-resolve ke satu nilai warna.
2. WHERE terdapat lebih dari satu blok `:root` yang mendeklarasikan Token_Desain yang sama, THE Palet_Aktif SHALL bernilai tepat satu nilai akhir per token sesuai deklarasi `:root` terakhir dalam urutan kaskade.
3. WHERE sebuah komponen pada Kelas_Kontrak menampilkan warna latar, teks, atau garis untuk peran yang memiliki Token_Desain, THE Stylesheet SHALL merujuk Token_Desain melalui `var(--token)` alih-alih menuliskan nilai hex/rgb/hsl literal.
4. IF sebuah aturan menuliskan nilai warna literal untuk peran yang sudah memiliki Token_Desain, THEN THE aturan tersebut SHALL dianggap tidak memenuhi kriteria dan diganti dengan rujukan `var(--token)`.
5. WHEN komponen setara di crud/src/App.jsx dan crud/src/FeatureViews.jsx dirender, THE Stylesheet SHALL menerapkan nilai Palet_Aktif yang identik pada komponen setara tersebut.

### Requirement 3: Sistem Tipografi dan Spacing

**User Story:** Sebagai pengguna, saya ingin teks dan jarak antar elemen yang rapi dan mudah dibaca, sehingga antarmuka terasa modern dan nyaman.

#### Acceptance Criteria

1. THE Stylesheet SHALL menerapkan nilai keluarga font, ukuran font, bobot font, dan tinggi baris yang identik untuk setiap elemen yang memiliki peran teks yang sama di seluruh Kelas_Kontrak, sehingga dua elemen dengan peran teks sama tidak memiliki perbedaan pada keempat properti tersebut.
2. THE Stylesheet SHALL hanya menggunakan keluarga font DM Sans dan Manrope yang aset-nya sudah dirujuk sebelumnya pada Stylesheet, dan bobot font yang digunakan SHALL terbatas pada bobot yang aset-nya dirujuk (DM Sans: 400, 500, 600, 700; Manrope: 600, 700, 800).
3. IF sebuah aturan pada Stylesheet merujuk keluarga font di luar DM Sans dan Manrope sebagai keluarga font utama, THEN THE Stylesheet SHALL dianggap tidak memenuhi kriteria dan deklarasi tersebut SHALL dihilangkan.
4. THE Stylesheet SHALL menerapkan nilai padding dan margin yang berasal dari satu himpunan langkah spacing yang telah ditetapkan secara eksplisit pada Stylesheet, dan komponen yang setara SHALL menggunakan langkah spacing yang sama untuk padding dan margin yang berperan sama.

### Requirement 4: Penampilan Komponen Inti

**User Story:** Sebagai pengguna, saya ingin sidebar, topbar, kartu statistik, tabel, panel, modal, tombol, dan badge tampil rapi bergaya SaaS modern, sehingga aplikasi terlihat profesional.

#### Acceptance Criteria

1. THE Stylesheet SHALL menata tampilan sidebar, topbar, dan welcome row dengan menerapkan warna dari Palet_Aktif dan nilai spacing dari skala spacing yang sama, sehingga seluruh elemen sejenis pada ketiga area tersebut menggunakan nilai warna dan spacing yang identik.
2. THE Stylesheet SHALL menata tampilan `.stats-grid` dan `.stat-card` sebagai kartu statistik sehingga setiap `.stat-card` memiliki nilai ketebalan batas, radius sudut, dan bayangan yang identik satu sama lain.
3. THE Stylesheet SHALL menata tampilan `.catalog-panel` beserta elemen `table`, `th`, dan `td` sehingga setiap `td` pada satu tabel memiliki nilai padding yang identik dan setiap baris dipisahkan oleh garis pemisah dengan ketebalan dan warna yang identik.
4. THE Stylesheet SHALL menata tampilan `.modal` dan `.modal-backdrop` sehingga `.modal` memiliki radius sudut dan bayangan yang telah ditetapkan serta `.modal-backdrop` berada pada lapisan di bawah `.modal` dan di atas konten halaman lainnya.
5. THE Stylesheet SHALL menata tampilan `.primary-button`, `.secondary-button`, dan `.danger-button` dengan warna dari Palet_Aktif sehingga ketiga tombol memiliki warna latar yang saling berbeda satu sama lain.
6. THE Stylesheet SHALL menata tampilan badge `.status`, `.role-badge`, dan `.purchase-status` sehingga setiap nilai status yang berbeda memiliki warna latar atau warna teks yang berbeda dari nilai status lainnya pada badge yang sama.
7. THE Stylesheet SHALL menata tampilan `.toast`, `.notif-panel`, `.login-card`, `.feature-launcher`, dan `.feature-overlay` dengan menerapkan warna dari Palet_Aktif dan nilai spacing dari skala spacing yang sama sehingga elemen sejenis pada komponen tersebut menggunakan nilai warna dan spacing yang identik.
8. IF sebuah token warna pada Palet_Aktif tidak terdefinisi saat komponen dirender, THEN THE Stylesheet SHALL menerapkan warna fallback yang telah ditetapkan pada elemen terkait dan mempertahankan tata letak komponen tanpa elemen yang hilang atau tumpang tindih.

### Requirement 5: State Interaktif

**User Story:** Sebagai pengguna, saya ingin elemen interaktif memberi umpan balik visual yang jelas, sehingga saya tahu elemen mana yang aktif, terpilih, atau dinonaktifkan.

#### Acceptance Criteria

1. WHEN pointer berada di atas tombol atau item navigasi yang tidak disabled, THE Stylesheet SHALL menerapkan gaya hover yang berbeda dari keadaan default elemen tersebut pada setidaknya satu properti visual yang dapat diamati (warna latar, warna teks, warna border, atau bayangan).
2. WHEN elemen interaktif menerima fokus keyboard, THE Stylesheet SHALL menampilkan indikator focus-visible berupa outline atau ring yang mengelilingi elemen dengan ketebalan minimal 2px dan berbeda warna dari warna latar elemen.
3. WHILE tombol atau item navigasi yang tidak disabled sedang ditekan (active/pressed oleh pointer), THE Stylesheet SHALL menerapkan gaya pressed yang berbeda dari keadaan hover maupun default pada setidaknya satu properti visual yang dapat diamati (warna latar, warna teks, atau bayangan).
4. WHILE sebuah tombol berada dalam keadaan disabled, THE Stylesheet SHALL menerapkan gaya nonaktif yang berbeda dari keadaan aktif tombol pada setidaknya satu properti visual yang dapat diamati (opasitas, warna latar, atau warna teks) dan SHALL menonaktifkan perubahan gaya hover pada tombol tersebut.
5. WHILE sebuah item navigasi berada dalam keadaan `active`, THE Stylesheet SHALL menerapkan gaya terpilih yang berbeda dari item navigasi yang tidak aktif pada setidaknya satu properti visual yang dapat diamati (warna latar, warna teks, atau penanda border/aksen).

### Requirement 6: Kontras Aksesibilitas

**User Story:** Sebagai pengguna dengan keterbatasan penglihatan, saya ingin teks memiliki kontras yang memadai, sehingga konten tetap terbaca.

#### Acceptance Criteria

1. THE Stylesheet SHALL menjaga Rasio_Kontras minimal 4.5:1 antara warna teks ukuran normal (ukuran font kurang dari 24px, atau kurang dari 18.66px bila tebal) dan warna latar efektifnya pada setiap komponen Kelas_Kontrak sebagaimana dihitung dengan rumus kontras WCAG 2.1.
2. THE Stylesheet SHALL menjaga Rasio_Kontras minimal 3:1 antara warna teks berukuran besar (ukuran font minimal 24px, atau minimal 18.66px bila tebal) dan warna latar efektifnya pada setiap komponen Kelas_Kontrak sebagaimana dihitung dengan rumus kontras WCAG 2.1.
3. THE Stylesheet SHALL menjaga Rasio_Kontras minimal 3:1 antara warna indikator focus-visible dan warna latar elemen yang berdekatan langsung dengan indikator tersebut.
4. WHERE informasi status disampaikan melalui warna, THE Stylesheet SHALL mempertahankan minimal satu pembeda visual non-warna yang sudah ada pada Markup (misalnya ikon, teks label, atau bentuk) sehingga status dapat dibedakan tanpa bergantung pada warna.
5. IF suatu perubahan gaya pada crud/src/App.css akan menyebabkan Rasio_Kontras suatu teks turun di bawah ambang yang berlaku pada kriteria 1 atau 2, THEN THE Stylesheet SHALL tidak menerapkan perubahan tersebut dan mempertahankan nilai warna yang memenuhi ambang kontras.

### Requirement 7: Responsivitas Lintas Breakpoint

**User Story:** Sebagai pengguna perangkat seluler dan desktop, saya ingin tata letak tetap tertata di setiap ukuran layar, sehingga aplikasi tetap dapat digunakan.

#### Acceptance Criteria

1. THE Stylesheet SHALL mempertahankan aturan tata letak responsif pada setiap Breakpoint yang sudah ada (900px, 760px, 720px, dan 640px) tanpa menghapus atau menonaktifkan aturan yang telah ada sebelumnya.
2. WHILE lebar viewport berada pada atau di bawah 640px, THE Stylesheet SHALL menampilkan sidebar, grid statistik, toolbar, dan tabel dengan setiap elemen memiliki lebar efektif tidak melebihi lebar viewport dan tanpa tumpang tindih antar elemen.
3. WHILE lebar viewport berada pada atau di bawah 640px, THE Stylesheet SHALL menyusun grid statistik menjadi satu kolom per baris.
4. IF lebar konten tabel melebihi lebar kontainer tabel, THEN THE Stylesheet SHALL mengaktifkan pengguliran horizontal pada kontainer tabel sehingga seluruh kolom tabel dapat diakses tanpa memotong konten.
5. THE Stylesheet SHALL menjaga agar tidak terjadi pengguliran horizontal pada tingkat halaman (document body) pada rentang lebar viewport 320px hingga 1920px.

### Requirement 8: Keamanan Tampilan Cetak

**User Story:** Sebagai kasir, saya ingin invoice dan laporan tetap tercetak dengan benar setelah refresh visual, sehingga dokumen cetak tetap rapi.

#### Acceptance Criteria

1. THE Stylesheet SHALL mempertahankan Print_Styles untuk `.invoice-print` yang sudah ada sebelum refresh visual tanpa menghapus atau mengubah selektor di dalam blok `@media print`.
2. WHEN pengguna mencetak invoice, THE Stylesheet SHALL menampilkan konten `.invoice-print` dan menyembunyikan seluruh elemen Kelas_Kontrak lain yang bukan turunan `.invoice-print`.
3. WHEN pengguna mencetak laporan, THE Stylesheet SHALL menampilkan konten `.feature-overlay.report-print` dan menyembunyikan seluruh elemen Kelas_Kontrak lain yang bukan turunan `.feature-overlay.report-print`.
4. WHEN pengguna mencetak invoice atau laporan, THE Stylesheet SHALL menyembunyikan setiap elemen yang ditandai `.no-print` sehingga elemen tersebut tidak muncul pada hasil cetak.

### Requirement 9: Non-Regresi Fungsional

**User Story:** Sebagai pemilik produk, saya ingin memastikan refresh visual tidak mengubah perilaku apa pun, sehingga aplikasi bekerja sama seperti sebelumnya.

#### Acceptance Criteria

1. WHEN fitur selesai diterapkan, THE Stylesheet SHALL mempertahankan setiap elemen interaktif Markup tetap terlihat (visibility bukan hidden, display bukan none, opacity lebih besar dari 0) dan tetap dapat diklik (pointer-events bukan none dan tidak tertutup elemen lain) sebagaimana sebelum refresh.
2. THE Stylesheet SHALL tidak menyembunyikan elemen fungsional apa pun yang sebelumnya terlihat, kecuali pada kondisi yang sudah diatur sebelumnya yaitu `.sr-only`, keadaan responsif pada lebar viewport di bawah 768px, dan Print_Styles.
3. THE Stylesheet SHALL mempertahankan urutan penumpukan sehingga toast berada pada lapisan lebih tinggi atau sama dengan modal, modal di atas backdrop, backdrop di atas feature overlay dan panel notifikasi, dan seluruhnya di atas konten dasar halaman.
4. WHEN pengguna melakukan klik, input teks, pemilihan opsi, submit form, atau navigasi yang didukung aplikasi sebelum refresh, THE aplikasi SHALL menghasilkan keadaan DOM dan hasil yang teramati identik setelah refresh.
5. IF sebuah elemen interaktif yang sebelumnya terlihat menjadi tersembunyi atau tidak dapat diklik di luar pengecualian pada kriteria 2, THEN THE perubahan tersebut SHALL dianggap regresi dan ditolak.
