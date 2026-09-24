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
- reports (admin): GET /reports/daily?date, /reports/daily.pdf, /reports/daily.xlsx (file downloads), GET /reports/restock (stock ≤ min grouped by product.supplier, suggested = 2×min − stock)

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
