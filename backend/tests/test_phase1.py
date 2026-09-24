"""Phase 1 smoke tests: login, product, barcode, sale, stock, change, void. Run: cd /app/backend && pytest"""

import uuid

import httpx

BASE = "http://localhost:8001/api/v1"


def _login(user: str, pw: str) -> httpx.Client:
    c = httpx.Client(base_url=BASE)
    r = c.post("/auth/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.text
    return c


def test_login_bad_password():
    r = httpx.post(f"{BASE}/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code in (401, 429)
    assert r.json()["success"] is False


def test_product_sale_void_flow():
    admin = _login("admin", "admin123")
    sku = f"T-{uuid.uuid4().hex[:6]}"
    p = admin.post("/products", json={"sku": sku, "name": "Produk Test", "buy_price": 1000, "sell_price": 1500, "stock": 10}).json()
    assert p["barcode"]  # auto-generated
    assert admin.get(f"/products/barcode/{p['barcode']}").json()["id"] == p["id"]

    kasir = _login("kasir", "kasir123")
    sale = kasir.post("/sales", json={"items": [{"product_id": p["id"], "qty": 3, "discount": 0}],
                                      "payment_method": "cash", "amount_paid": 5000}).json()
    assert sale["total"] == 4500 and sale["change"] == 500
    assert admin.get(f"/products/barcode/{p['barcode']}").json()["stock"] == 7

    assert kasir.post(f"/sales/{sale['id']}/void", json={"reason": "salah input"}).status_code == 403
    v = admin.post(f"/sales/{sale['id']}/void", json={"reason": "salah input"}).json()
    assert v["status"] == "void"
    assert admin.get(f"/products/barcode/{p['barcode']}").json()["stock"] == 10
    admin.delete(f"/products/{p['id']}")


def test_insufficient_stock_rejected():
    admin = _login("admin", "admin123")
    p = admin.post("/products", json={"sku": f"T-{uuid.uuid4().hex[:6]}", "name": "Stok Sedikit", "buy_price": 1, "sell_price": 2, "stock": 1}).json()
    r = admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 5}], "payment_method": "qris", "amount_paid": 0})
    assert r.status_code == 400
    admin.delete(f"/products/{p['id']}")


def test_purchase_increases_stock():
    admin = _login("admin", "admin123")
    sup = admin.post("/suppliers", json={"name": f"Sup {uuid.uuid4().hex[:6]}"}).json()
    p = admin.post("/products", json={"sku": f"T-{uuid.uuid4().hex[:6]}", "name": "Beli Test", "buy_price": 1000, "sell_price": 1500, "stock": 2}).json()
    inv = f"INV-{uuid.uuid4().hex[:6]}"
    body = {"supplier_id": sup["id"], "invoice_no": inv, "date": "2026-09-24",
            "items": [{"product_id": p["id"], "qty": 10, "buy_price": 1100}]}
    r = admin.post("/purchases", json=body)
    assert r.status_code == 200 and r.json()["total"] == 11000
    after = admin.get(f"/products/barcode/{p['barcode']}").json()
    assert after["stock"] == 12 and after["buy_price"] == 1100
    assert admin.post("/purchases", json=body).status_code == 409  # duplicate invoice
    hist = admin.get(f"/purchases?supplier_id={sup['id']}").json()
    assert len(hist) == 1 and hist[0]["invoice_no"] == inv
    kasir = _login("kasir", "kasir123")
    assert kasir.get("/purchases").status_code == 403
    admin.delete(f"/products/{p['id']}")


def test_returns_shift_reports():
    admin = _login("admin", "admin123")
    sup = admin.post("/suppliers", json={"name": f"Sup {uuid.uuid4().hex[:6]}"}).json()
    p = admin.post("/products", json={"sku": f"T-{uuid.uuid4().hex[:6]}", "name": "Retur Test", "buy_price": 1000,
                                      "sell_price": 2000, "stock": 5, "min_stock": 10}).json()
    bc = p["barcode"]
    pur = admin.post("/purchases", json={"supplier_id": sup["id"], "invoice_no": "R1", "date": "2026-09-24",
                                         "items": [{"product_id": p["id"], "qty": 5, "buy_price": 1000}]}).json()
    # shift
    admin.post("/shifts/close", json={"actual_cash": 0})  # close leftover if any
    assert admin.post("/shifts/open", json={"opening_cash": 50000}).status_code == 200
    sale = admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 4}], "payment_method": "cash", "amount_paid": 10000}).json()
    assert admin.get(f"/products/barcode/{bc}").json()["stock"] == 6
    # sale return 2 -> stock 8; over-return rejected
    r = admin.post("/returns", json={"type": "sale", "ref_id": sale["id"], "items": [{"product_id": p["id"], "qty": 2}], "reason": "rusak"})
    assert r.status_code == 200 and r.json()["total"] == 4000
    assert admin.post("/returns", json={"type": "sale", "ref_id": sale["id"], "items": [{"product_id": p["id"], "qty": 3}], "reason": "lagi"}).status_code == 400
    assert admin.get(f"/products/barcode/{bc}").json()["stock"] == 8
    # purchase return 3 -> stock 5
    assert admin.post("/returns", json={"type": "purchase", "ref_id": pur["id"], "items": [{"product_id": p["id"], "qty": 3}], "reason": "expired"}).status_code == 200
    assert admin.get(f"/products/barcode/{bc}").json()["stock"] == 5
    # shift summary: 50000 + 8000 cash - 4000 refund = 54000
    cur = admin.get("/shifts/current").json()
    assert cur["summary"]["expected_cash"] == 54000
    closed = admin.post("/shifts/close", json={"actual_cash": 53000}).json()
    assert closed["difference"] == -1000 and closed["status"] == "closed"
    # reports
    d = admin.get(f"/reports/daily?date={sale['date']}").json()
    assert d["omzet"] >= 8000 and "cash" in d["by_payment"]
    assert admin.get(f"/reports/daily.pdf?date={sale['date']}").content[:4] == b"%PDF"
    assert admin.get(f"/reports/daily.xlsx?date={sale['date']}").content[:2] == b"PK"
    groups = admin.get("/reports/restock").json()
    assert any(i["id"] == p["id"] for g in groups for i in g["items"])


def test_customer_debt_expense_report():
    admin = _login("admin", "admin123")
    c = admin.post("/customers", json={"name": f"Pelanggan {uuid.uuid4().hex[:5]}", "whatsapp": "0812"}).json()
    p = admin.post("/products", json={"sku": f"T-{uuid.uuid4().hex[:6]}", "name": "Hutang Test", "buy_price": 1000, "sell_price": 5000, "stock": 10}).json()
    # hutang without customer rejected
    assert admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 2}], "payment_method": "hutang", "amount_paid": 0}).status_code == 400
    sale = admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 2}], "payment_method": "hutang", "amount_paid": 3000,
                                      "customer_id": c["id"], "due_date": "2026-10-01"}).json()
    assert sale["customer_name"] == c["name"] and sale["change"] == 0
    debt = [d for d in admin.get(f"/debts?customer_id={c['id']}").json()][0]
    assert debt["remaining"] == 7000 and debt["status"] == "open"
    assert admin.post(f"/debts/{debt['id']}/payments", json={"amount": 9000}).status_code == 400
    d2 = admin.post(f"/debts/{debt['id']}/payments", json={"amount": 7000}).json()
    assert d2["status"] == "paid" and d2["remaining"] == 0
    e = admin.post("/expenses", json={"category": "Listrik", "amount": 2500, "date": sale["date"], "note": "token"}).json()
    r = admin.get(f"/reports/daily?date={sale['date']}").json()
    assert r["expenses_total"] >= 2500 and r["net_profit"] == r["profit"] - r["expenses_total"]
    assert r["debt_collected"] >= 7000
    kasir = _login("kasir", "kasir123")
    assert kasir.get("/expenses").status_code == 403
    admin.delete(f"/expenses/{e['id']}")


def test_backup_import_monthly():
    admin = _login("admin", "admin123")
    b = admin.post("/backups").json()
    assert b["collections"]["users"] >= 2 and b["size"] > 0
    assert admin.get(f"/backups/{b['id']}/download").content[:2] == b"\x1f\x8b"
    sku = f"T-{uuid.uuid4().hex[:6]}"
    csv_data = f"SKU,Nama,Kategori,Harga Beli,Harga Jual,Stok,Stok Minimum\n{sku},Import Test,Sembako,100,150,7,2\n,Kosong,,1,1,1,1\n"
    rows = admin.post("/products/import/preview", files={"file": ("p.csv", csv_data, "text/csv")}).json()
    assert [r["status"] for r in rows] == ["new", "error"]
    res = admin.post("/products/import", json={"rows": rows}).json()
    assert res["created"] == 1 and res["skipped"] == 1
    p = [x for x in admin.get(f"/products?q={sku}").json()][0]
    assert p["stock"] == 7 and p["barcode"]
    m = admin.get("/reports/monthly").json()
    assert len(m["days"]) >= 28 and abs(m["net"] - (m["profit"] - m["expenses"])) < 0.01
    assert admin.get("/reports/monthly?month=2026-13").status_code == 422
    assert "due_debts" in admin.get("/dashboard").json()
    admin.delete(f"/products/{p['id']}")
    admin.delete(f"/backups/{b['id']}")
