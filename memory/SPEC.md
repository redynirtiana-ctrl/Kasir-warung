# WARUNG BU CUCUN — POS (SPEC)

Stack: React 19 + Vite + Tailwind v4 + shadcn (frontend/), FastAPI + Motor/MongoDB (backend/). User approved this stack instead of Express/PostgreSQL.

## Auth & roles
- JWT in httpOnly cookie `wbc_token` (12h), bcrypt hashes. `POST /api/v1/auth/login|logout`, `GET /api/v1/auth/me`.
- Login rate limit: 5 failures / IP / minute → 429.
- Roles: `admin` (everything), `kasir` (POS, dashboard, product list read-only, sales list, reprint). Void, product/category/user/settings CRUD = admin only (403 otherwise).

## Data (Mongo collections, string uuid `id`)
users, categories, products (sku unique, barcode unique sparse), sales (invoice_no unique, `date` = store-local YYYY-MM-DD, status completed|void), stock_movements (type stock_in|stock_out|adjustment|sale|return, before/after, user, note), price_history, audit_logs, counters (invoice seq per day), settings (key=store).

## API (/api/v1) — errors: `{success:false,message,error}`
- products: GET (q, category_id, active_only), POST, PUT/{id}, DELETE/{id}, GET /products/barcode/{barcode} (404 "Produk dengan barcode tersebut belum terdaftar."), GET /barcode/generate
- POST /stock/adjustment, GET /stock/movements
- categories CRUD (delete blocked if used)
- sales: POST (atomic conditional stock decrement + rollback), GET (start,end,q), GET /{id}, POST /{id}/void (admin, reason ≥3, restores stock)
- GET /dashboard?range=today|yesterday|7d|month|custom&start&end
- GET/PUT /settings (store name, address, WA, footer, paper 58/80, tax %, invoice prefix, payment methods)
- users: GET/POST/PUT (admin)

- suppliers (admin): GET (with purchase_count, purchase_total), POST, PUT/{id}, DELETE/{id} (blocked if has purchases)
- purchases (admin): GET (supplier_id, start, end), POST {supplier_id, invoice_no (unique per supplier, 409), date YYYY-MM-DD, items[{product_id, qty, buy_price}], note, update_buy_price} → stock += qty, movement "purchase", optional buy_price update + price_history
- returns (admin): GET (type, ref_id), GET /returns/returned/{ref_id}, POST {type sale|purchase, ref_id, items[{product_id, qty}], reason} — qty ≤ original − already returned; sale return stock += qty (refund = line subtotal/qty), purchase return stock −= qty (needs stock); movement "return"; number RTR-YYYYMMDD-####
- shifts (any user, own shift): GET /shifts/current (with live summary), POST /shifts/open {opening_cash}, POST /shifts/current/expenses {amount, note}, POST /shifts/close {actual_cash} → summary (by_payment, expenses, cash refunds, expected_cash = opening + cash sales − expenses − cash refunds), difference; GET /shifts (admin all, kasir own). Sales counted = cashier's completed sales since opened_at.
- customers (read/create any user; edit/delete admin): GET (debt_remaining, transaction_count), POST, PUT/{id}, DELETE/{id} (blocked with open debt), GET /customers/{id}/sales
- Sale: optional customer_id; payment_method "hutang" requires customer, amount_paid = DP (< total), due_date → creates debts doc {total, paid, remaining, due_date, status open|paid, payments[]}
- debts (admin): GET (status, customer_id), POST /debts/{id}/payments {amount ≤ remaining}
- expenses (admin): GET (start,end,category), POST, PUT/{id}, DELETE/{id}; categories from settings.expense_categories
- DailyReport now also: expenses_total, expenses_by_category, net_profit (= profit − expenses), debt_new, debt_collected
- reports archive (admin): GET /reports/archive, POST /reports/archive/{date}; cron POST /api/v1/cron/daily-report (Bearer WEBHOOK_CRON_SECRET, 401 otherwise) scheduled 23:55 Asia/Jakarta in .emergent/crons.yml
- Settings: owner_whatsapp (WA target for reports), expense_categories
- Seed/demo customers: Bu Siti (081234500001), Pak Joko (081234500002)
- Frontend: /customers (Pelanggan + Piutang tabs, pay, WA reminder), /expenses, /reports tab Arsip Harian, WA buttons (wa.me links, no API)
- backups (admin): GET/POST /backups, GET /backups/{id}/download, POST /backups/{id}/restore, POST /backups/restore-upload (multipart), DELETE /backups/{id}; cron POST /api/v1/cron/backup (23:59 WIB, keep 14 auto). Restore replaces all collections except backups/cron_runs, makes a pre-restore backup first
- product import (admin): GET /products/import/template.xlsx, POST /products/import/preview (multipart xlsx/csv → ImportRow[] status new|update|error), POST /products/import {rows} → created/updated/skipped/new_categories
- GET /reports/monthly?month=YYYY-MM → days[{omzet, modal, profit, expenses, net, transactions}] + totals; Dashboard.due_debts (open debts due ≤ today)
- Frontend: /backup page, Products "Import Excel/CSV" dialog, Dashboard due-debts card, Reports tab "Laba Bulanan"; lib/api.ts apiUpload for multipart
- Pricing: Product.wholesale_tiers[{min_qty>1, price}], promo_price + promo_start/promo_end (YYYY-MM-DD, inclusive). Server picks lowest of normal/active promo/best tier (lib/pricing.py); SaleItem.price_type normal|promo|grosir, normal_price
- Loyalty: Settings.loyalty_enabled, points_per_amount (Rp per point, default 10000), point_value (Rp per point, 100), min_redeem_points (10). Customer.points. SaleIn.redeem_points → extra discount; Sale.points_earned/points_redeemed/points_discount; void reverses points (returns do not)
- Stock opname (admin): GET/POST /stock/opname {items[{product_id, counted}], note} → sets stock, movement "opname", Opname{lines, adjusted_count, value_diff}. Frontend /opname keeps counts in localStorage until committed
- Export (admin): GET /export/{products|sales|purchases|customers|suppliers}.{xlsx|csv}?start&end (sales/purchases date filter)
- Demo: Mie Instan (MKN-001) grosir ≥10 = 3.200, ≥40 = 3.000; Minyak (SBK-002) promo 16.000 until 2026-10-31
- Member card: Customer.member_code "MBR"+6 digits (generated on create, backfilled on GET /customers); GET /customers/by-code/{code} (any user, 404 if unknown). POS scan of MBR code sets cart.customerId; Customers page prints cards (lib/print printMemberCards)
- Multi-unit: Product.units[{name, factor>1, price, barcode?}] (base unit = Product.unit, stock always base). SaleItemIn.unit (null=base); SaleItem.unit=unit name, factor, buy_price = base buy × factor; stock −= qty×factor; void restores qty×factor; sale returns aggregate lines to base units. /products/barcode/{bc} also matches units.barcode. Demo: MKN-001 dus=40 pcs Rp125.000 barcode 8991001000509
- GET /reports/breakdown?start&end (admin) → by_cashier / by_category rows {name, transactions, qty, omzet, profit} (trx discount spread proportionally)
- Customer display: public route /display (no auth, no API) listens on BroadcastChannel "wbc-display"; POS posts DisplayState on every cart change and responds to "hello"
- Permissions (kasir, per user): catalog in lib/auth.PERMISSIONS = give_discount, sell_on_credit, void_sale, process_returns, receive_debt_payment, view_reports. Stored as users.permissions (absent → DEFAULT_KASIR_PERMISSIONS = give_discount, sell_on_credit); admin = all. User responses carry effective `permissions`. GET /auth/permissions (catalog). PUT/POST /users accept permissions (unknown key → 422). Enforced: create_sale (discount>0 → give_discount, hutang → sell_on_credit), POST /sales/{id}/void → void_sale, /returns* → process_returns (purchase type admin only), /debts* → receive_debt_payment, /reports/* → view_reports. Denials 403 + audit "permission_denied". Frontend helper `can(user, perm)` in lib/types.ts
- Admin PIN approval: PUT /users/me/pin {pin 4-6 digits, current_password} (admin); users.pin_hash (bcrypt), User.has_pin. lib/auth.verify_admin_pin(pin, requester, action, ip) → checks any active admin PIN, rate-limited (key pin:<ip>), audited admin_approval / admin_approval_failed. 403 messages: "Butuh PIN admin: <reason>" or "PIN admin salah" → frontend components/PinDialog (needsPin) retries with approval_pin
- SaleIn.approval_pin / VoidIn.approval_pin. Kasir: discount without give_discount → PIN; manual discount % (item + trx, excl. points, vs gross) > Settings.max_cashier_discount_percent (10) → PIN. Void without void_sale → PIN. Admin never limited. Demo admin PIN 1234
- Expiry: PurchaseItemIn.expiry_date → product_batches {product_id, expiry_date, qty, invoice_no, supplier_name, dismissed}. Dashboard.expiring = non-dismissed batches with expiry ≤ today + Settings.expiry_warning_days (30) and product stock > 0 (days_left negative = expired). GET /batches/expiring, POST /batches/{id}/dismiss (admin). Demo batches: Air Mineral (expired 2 days), Telur Ayam (5 days)
- WhatsApp morning summary: GET /notifications/morning-summary (admin) → {text, due_debts, due_total, expiring, out_of_stock, low_stock}; POST /notifications/morning-summary/send (Fonnte, manual); GET /notifications/logs; GET/PUT /integrations/fonnte {token} (stored in secrets collection, never returned; env FONNTE_TOKEN fallback); POST /integrations/fonnte/test. Cron POST /api/v1/cron/morning-summary (07:00 Asia/Jakarta, Bearer WEBHOOK_CRON_SECRET) respects Settings.morning_summary_enabled. Sends go to Settings.owner_whatsapp; results logged in notification_logs. Adapter: integrations/fonnte.py. Token not yet provided by user → auto-send inactive until set
- reports (admin or view_reports): GET /reports/daily?date, /reports/daily.pdf, /reports/daily.xlsx (file downloads), GET /reports/restock (stock ≤ min grouped by product.supplier, suggested = 2×min − stock)

## Frontend flows
- /returns (admin): tabs Retur Penjualan / Retur Pembelian, dialog: pick source trx, qty per line, reason.
- /shifts (all): open shift, live summary, drawer expenses, close with actual cash → difference, print shift report (thermal), history.
- /reports (admin): Laporan Harian (date, KPIs, detail, top-products chart, Cetak, PDF, Excel) + Saran Belanja (per supplier, print list).
- /products: "Tambah Produk" auto-generates barcode immediately (preview visible); after saving a new product a label dialog opens to print it; per-row barcode button.
- /purchases (admin): list + filter supplier, "Catat Pembelian" dialog (supplier, invoice, date, product picker, qty/price, total, update-price checkbox), detail view.
- /suppliers (admin): table, add/edit/delete, purchase history dialog.
- /login (demo chips) → admin → `/`, kasir → `/pos`
- /pos: barcode input (Enter), search (debounced), category chips, cart (qty, per-line Rp discount, trx discount Rp/%), payment dialog (cash w/ change or other methods), receipt dialog + browser thermal print. Multi-cart hold/resume persisted in localStorage. Shortcuts: F1 POS, F2 search, F3 scan, F4 pay, F5 hold, F6 held list, F12 print last receipt.
- /products: table, stock status badges (STOK MENIPIS / STOK HABIS), add/edit dialog with barcode generate + preview, stock adjustment, multi-select label printing (custom size mm, copies). `?new=<barcode>` opens add-form prefilled.
- /categories, /sales (filter, reprint, void), /users, /settings (Test Print).

## Seed (`cd backend && python seed.py`, idempotent)
7 categories; 10 products (e.g. Beras Premium 5 Kg barcode 8991001000011 Rp75.000 stok 20; Mie Instan 8991001000059 Rp3.500; Telur Ayam stok 4 min 5 = menipis; Teh Celup stok 0 = habis).

## Not yet built (later phases)
Customers & debt, expenses module (separate from shift drawer expenses), nightly auto-generated reports, import/export, backup/restore, ESC/POS print bridge, photo upload (URL field only).

## Struk via WhatsApp
- Tombol "Kirim WA" ada di dialog struk kasir (setelah transaksi), di tiap baris Penjualan, dan di dialog detail penjualan. Semuanya membuka `WaReceiptDialog`.
- `GET /api/v1/sales/{id}/whatsapp` → WaReceiptPreview {phone (WA member, bisa diedit), customer_name, text (struk teks), fonnte_configured}
- `POST /api/v1/sales/{id}/whatsapp` {phone} → WaReceiptResult {sent, via: fonnte|link, target, reason, wa_link}. Kalau Fonnte tidak diatur atau gagal: sent=false, lalu frontend membuka wa_link. Dicatat di notification_logs (kind=receipt) dan di audit log.

## Kirim struk otomatis ke member
- Settings.auto_wa_receipt (bool, bawaan false). SaleIn.send_wa_receipt (bool|null; kalau null ikut pengaturan) diatur lewat kotak centang di dialog bayar (muncul kalau ada member yang dipilih).
- Setelah penjualan tersimpan, kalau member punya nomor WA dan token Fonnte ada, struk dikirim di latar belakang (asyncio task). Sale.wa_receipt_queued = true. Hasilnya dicatat di notification_logs (kind=receipt_auto).

## Pengingat hutang WA (manual)
- `GET /api/v1/debts/due-today` → DueDebtGroup[] (hutang belum lunas yang due_date <= hari ini, dikelompokkan per pelanggan)
- `POST /api/v1/customers/{id}/debt-reminder` {phone} → WaReceiptResult (pesan sopan; Fonnte, cadangan wa.me). Tab Piutang menampilkan panel "Jatuh tempo hari ini" dengan tombol Kirim Pengingat per pelanggan.

## Fondasi multi-cabang
- Collection `stores` {id, code (unik, huruf besar), name, address, phone, active, is_main, created_at}. Cabang Utama id="main".
- Migrasi 007_add_store_id (lib/stores.py, jalan saat startup, idempotent, dicatat di collection `migrations`): menandai products/sales/purchases/stock_movements lama dengan store_id="main".
- Data baru diberi store_id = current_store_id(user) (user.store_id kalau ada, kalau tidak "main").
- `/api/v1/stores` untuk GET, POST, PUT, DELETE (cabang utama tidak bisa dihapus atau dinonaktifkan; cabang yang sudah punya data tidak bisa dihapus). Halaman /stores menu "Cabang" (khusus admin).

## Ucapan ulang tahun member
- Customer.birthday "MM-DD" (tanpa tahun, opsional, divalidasi regex). Customer.birthday_greeted_year dipakai supaya ucapan tidak terkirim dua kali dalam setahun. Form pelanggan memakai pilihan Tanggal + Bulan.
- `GET /api/v1/customers/birthdays-today` → Customer[] (member yang lahir 29 Feb diucapkan pada 28 Feb di tahun non-kabisat). `POST /api/v1/customers/{id}/birthday-greeting` {phone} → WaReceiptResult (Fonnte, cadangan wa.me); setelah dikirim, birthday_greeted_year diisi.
- Otomatis: job pagi (cron /cron/morning-summary, 07:00 WIB) memanggil send_birthday_greetings_auto() kalau Settings.birthday_greeting_enabled aktif (bawaan true), berjalan terpisah dari ringkasan pagi. Tanpa poin bonus.
- UI: panel "Ulang tahun hari ini" di tab Pelanggan, ikon kue + tanggal lahir di baris pelanggan, dan saklar di Pengaturan.

## Promo Member via WhatsApp (Dashboard)
- Kartu "Promo Member Minggu Ini" di Dashboard (khusus admin) → komponen PromoBroadcast.
- `GET /api/v1/promo/broadcast` → PromoDraft {text (dibuat otomatis dari produk dengan harga promo aktif; {nama} diganti nama member), promo_products, recipients (member yang punya WA), fonnte_configured, sent_this_week (dihitung sejak Senin, zona waktu toko), last_campaign}
- `POST /api/v1/promo/broadcast` {text, mode: fonnte|link} → PromoCampaign. Mode fonnte: asyncio task mengirim bertahap dengan jeda PROMO_SEND_DELAY_SECONDS (env, bawaan 6 detik + jitter) dan menyimpan hasil per member; hanya boleh ada 1 kampanye running; kalau token Fonnte kosong → 400. Mode link: kampanye hanya dicatat, lalu admin membuka wa.me satu per satu.
- `GET /api/v1/promo/campaigns/{id}` untuk memantau progres (frontend polling tiap 2 detik selama running). Admin mendapat peringatan (tetap bisa kirim) kalau promo sudah dikirim minggu ini. Collection: promo_campaigns.

## Cabang per pengguna
- User.store_id (bawaan "main"). Diatur admin lewat pilihan "Cabang tempat bekerja" di form Pengguna (hanya cabang aktif, divalidasi di backend). Tabel Pengguna menampilkan kolom Cabang.
- current_store_id(user) membaca user.store_id langsung dari DB setiap request, jadi perubahan cabang langsung berlaku. Penjualan, pembelian, produk baru, dan histori stok ditandai dengan cabang pengguna yang melakukannya (histori stok mengikuti cabang pengguna, bukan cabang produk).
- Stok masih satu gudang bersama. Admin melihat semua data; transaksi admin masuk ke cabang admin.
- Cabang yang masih punya pengguna aktif tidak bisa dinonaktifkan, dan cabang yang masih punya pengguna atau data tidak bisa dihapus.
