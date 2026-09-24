# WARUNG BU CUCUN — Dokumentasi

## Struktur
```
backend/
  server.py            # bootstrap FastAPI, error envelope, security headers, /api/v1 router
  lib/db.py            # koneksi MongoDB + index
  lib/auth.py          # JWT cookie, bcrypt, role guard, rate limit, audit log
  models/schemas.py    # model Pydantic (validasi input)
  routers/             # auth, users, categories, products (+stok, barcode), sales (+settings), dashboard
  seed.py              # data demo
  tests/test_phase1.py # test login, produk, barcode, transaksi, stok, kembalian, void
frontend/src/
  lib/                 # api.ts, types.ts (mirror model), session.ts, print.ts (struk & label), format.ts
  components/AppLayout.tsx
  pages/               # Login, Dashboard, Pos, Products, Categories, Sales, Users, Settings
```

## Instalasi (server Ubuntu)
1. Install Python 3.11+, Node.js 20+, yarn, MongoDB 7.
2. `backend/.env`: `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`, `JWT_SECRET` (acak, panjang), `STORE_TZ=Asia/Jakarta`.
3. `cd backend && pip install -r requirements.txt && python seed.py`
4. `uvicorn server:app --host 0.0.0.0 --port 8001` (production: jalankan via supervisor/systemd atau `pm2 start "uvicorn server:app --port 8001" --name wbc-api`).
5. `cd frontend && yarn install && yarn build` → sajikan `dist/` via Nginx, proxy `/api` ke `127.0.0.1:8001`.
6. HTTPS: `certbot --nginx -d domainanda`.
7. Backup: `mongodump --db app --out /backup/$(date +%F)` via cron harian.

## Testing
- Backend: `cd backend && pytest`
- Typecheck frontend: `cd frontend && yarn typecheck`
- Manual: login `admin/admin123` → Produk → tambah produk (barcode otomatis) → login `kasir/kasir123` → Kasir → scan `8991001000011` + Enter → F4 → isi uang → Selesaikan → Cetak Struk.

## Printer thermal
Versi saat ini mencetak lewat dialog print browser (CSS `@page` 58/80mm). Atur printer thermal sebagai printer default dan ukuran kertas di driver, margin "None". Kiosk mode Chrome `--kiosk-printing` untuk cetak tanpa dialog. Print bridge ESC/POS (USB/LAN) direncanakan pada Phase 3.

## Scanner barcode
Scanner USB (HID) mengetik kode + Enter ke kolom scan di halaman Kasir (fokus otomatis, F3 untuk kembali fokus).

## CHANGELOG
### 1.4.0
- Backup database: manual, otomatis tiap malam 23:59 WIB (cron `daily-backup`, simpan 14 terakhir), unduh (.json.gz), restore dari daftar atau upload file (wajib ketik RESTORE; otomatis membuat backup "Sebelum restore"). File di `backend/backups/` (atur `BACKUP_DIR`)
- Import produk Excel/CSV: template, preview + validasi (SKU/nama kosong, angka tidak valid, SKU dobel, barcode bentrok), SKU lama diperbarui, kategori baru dibuat otomatis, barcode kosong di-generate
- Dashboard: kartu "Hutang Jatuh Tempo" (jatuh tempo hari ini & lewat)
- Laporan Laba Bulanan: omzet, modal, laba kotor, pengeluaran, laba bersih + grafik harian, cetak, kirim WhatsApp
### 1.3.0
- Laporan malam otomatis: cron platform `.emergent/crons.yml` (23:55 WIB) → `POST /api/v1/cron/daily-report` (Bearer `WEBHOOK_CRON_SECRET`, idempotent via X-Webhook-Id) menyimpan snapshot ke koleksi `daily_reports`; tab "Arsip Harian" + tombol "Simpan sekarang"
- Pelanggan & hutang: CRUD pelanggan, riwayat transaksi, metode bayar "Hutang" di kasir (wajib pelanggan, DP, jatuh tempo), piutang dengan cicilan, status lunas, tanda lewat jatuh tempo, pengingat WhatsApp
- Pengeluaran toko: CRUD per kategori (kategori diatur di Pengaturan), masuk laporan harian → laba bersih
- Kirim WhatsApp satu klik (wa.me) untuk laporan harian, arsip, dan daftar belanja per supplier; nomor pemilik di Pengaturan
- Shift: cash seharusnya ikut DP hutang & cicilan yang diterima kasir

## Rekomendasi perangkat
**Printer label barcode (stiker)**
- Xprinter XP-365B / XP-360B (USB, thermal direct, label 20–80 mm) — murah & paling umum di Indonesia (± Rp 700 rb–1 jt)
- Zebra ZD220d / ZD230d (USB, sangat awet, driver stabil) — untuk pemakaian berat (± Rp 3–4 jt)
- Label: stiker thermal 50×30 mm atau 40×30 mm (gap), set ukuran yang sama di dialog "Cetak Label" dan di driver printer (margin 0)
- Printer struk (sudah ada di sistem): Xprinter XP-58IIH (58 mm) atau Epson TM-T82X (80 mm)

**Scanner barcode USB (HID keyboard, plug & play)**
- Zebra Symbol LS2208 (laser 1D, sangat tahan banting, ± Rp 1–1,5 jt)
- Honeywell Voyager 1250g / 1450g (1450g bisa QR/2D, ± Rp 1,5–2,5 jt)
- Budget: Eppos EP-2208 / Netum NT-1228BL (± Rp 200–450 rb)
- Pastikan setelan scanner: suffix **Enter (CR)** aktif, keyboard layout US — kasir cukup fokus di kolom scan (F3)
### 1.2.0
- Retur penjualan & retur pembelian (stok otomatis disesuaikan, validasi qty sisa, nomor RTR)
- Shift kasir: buka shift + modal awal, pengeluaran laci, tutup shift dengan cash aktual & selisih, cetak laporan shift, riwayat
- Laporan harian: omzet, diskon, modal, keuntungan, per metode bayar, void, retur, produk terlaris; cetak, download PDF (reportlab) & Excel (openpyxl)
- Saran belanja: barang stok menipis dikelompokkan per supplier + estimasi biaya, bisa dicetak
- Produk: barcode langsung di-generate saat tambah produk, dialog cetak label muncul setelah simpan, tombol barcode per produk
### 1.1.0 (Phase 4 — sebagian)
- Modul Supplier: CRUD (nama, kontak, telepon, alamat, catatan), jumlah & total pembelian, riwayat pembelian per supplier
- Modul Pembelian: supplier, no. invoice (unik per supplier), tanggal, banyak produk (qty, harga beli), total
- Simpan pembelian → stok otomatis bertambah + stock movement "purchase" + opsi perbarui harga beli (tercatat di histori harga)
- API: GET/POST/PUT/DELETE /api/v1/suppliers, GET/POST /api/v1/purchases (admin)
- Belum: retur penjualan & retur pembelian
### 1.0.0
- Login JWT (cookie httpOnly) + bcrypt, role admin/kasir, rate limit login, audit log
- CRUD kategori, produk, pengguna; histori harga; stock movement & penyesuaian stok
- Generate barcode CODE128 unik, preview, cetak label massal dengan ukuran custom
- Halaman kasir: scan barcode, pencarian, diskon per item & transaksi, pajak, 6 metode bayar, kembalian, hold/resume multi transaksi, shortcut F1–F12
- Struk thermal 58/80mm, cetak ulang, void transaksi (admin, alasan wajib, stok kembali)
- Dashboard: KPI, grafik harian, stok menipis/habis, filter periode
- Pengaturan toko & struk, Test Print
