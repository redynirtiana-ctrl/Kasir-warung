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

## Frontend flows
- /login (demo chips) → admin → `/`, kasir → `/pos`
- /pos: barcode input (Enter), search (debounced), category chips, cart (qty, per-line Rp discount, trx discount Rp/%), payment dialog (cash w/ change or other methods), receipt dialog + browser thermal print. Multi-cart hold/resume persisted in localStorage. Shortcuts: F1 POS, F2 search, F3 scan, F4 pay, F5 hold, F6 held list, F12 print last receipt.
- /products: table, stock status badges (STOK MENIPIS / STOK HABIS), add/edit dialog with barcode generate + preview, stock adjustment, multi-select label printing (custom size mm, copies). `?new=<barcode>` opens add-form prefilled.
- /categories, /sales (filter, reprint, void), /users, /settings (Test Print).

## Seed (`cd backend && python seed.py`, idempotent)
7 categories; 10 products (e.g. Beras Premium 5 Kg barcode 8991001000011 Rp75.000 stok 20; Mie Instan 8991001000059 Rp3.500; Telur Ayam stok 4 min 5 = menipis; Teh Celup stok 0 = habis).

## Not yet built (later phases)
Purchases/suppliers module, returns module, shifts, expenses, customers & debt, nightly reports/PDF/Excel export, import, backup/restore, ESC/POS print bridge, photo upload (URL field only).
