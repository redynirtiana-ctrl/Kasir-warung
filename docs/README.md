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
