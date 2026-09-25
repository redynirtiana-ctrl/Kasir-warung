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


def test_pricing_points_opname_export():
    admin = _login("admin", "admin123")
    p = admin.post("/products", json={"sku": f"T-{uuid.uuid4().hex[:6]}", "name": "Grosir Test", "buy_price": 2000, "sell_price": 3000,
                                      "stock": 50, "wholesale_tiers": [{"min_qty": 10, "price": 2500}, {"min_qty": 24, "price": 2300}],
                                      "promo_price": 2800, "promo_start": "2020-01-01", "promo_end": "2099-12-31"}).json()
    s1 = admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 2}], "payment_method": "qris", "amount_paid": 0}).json()
    assert s1["items"][0]["price"] == 2800 and s1["items"][0]["price_type"] == "promo"
    s2 = admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 12}], "payment_method": "qris", "amount_paid": 0}).json()
    assert s2["items"][0]["price"] == 2500 and s2["items"][0]["price_type"] == "grosir"
    # loyalty: 10000 per point, 1 point = 100
    c = admin.post("/customers", json={"name": f"Pelanggan {uuid.uuid4().hex[:5]}"}).json()
    s3 = admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 24}], "payment_method": "cash", "amount_paid": 60000,
                                    "customer_id": c["id"]}).json()
    assert s3["total"] == 55200 and s3["points_earned"] == 5
    assert admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 1}], "payment_method": "cash", "amount_paid": 5000,
                                      "customer_id": c["id"], "redeem_points": 99}).status_code == 400
    admin.put("/settings", json={**admin.get("/settings").json(), "min_redeem_points": 5})
    s4 = admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 1}], "payment_method": "cash", "amount_paid": 5000,
                                    "customer_id": c["id"], "redeem_points": 5}).json()
    assert s4["points_redeemed"] == 5 and s4["points_discount"] == 500 and s4["total"] == 2300
    cust = [x for x in admin.get("/customers").json() if x["id"] == c["id"]][0]
    assert cust["points"] == 0
    admin.post(f"/sales/{s4['id']}/void", json={"reason": "test void poin"})
    cust = [x for x in admin.get("/customers").json() if x["id"] == c["id"]][0]
    assert cust["points"] == 5
    admin.put("/settings", json={**admin.get("/settings").json(), "min_redeem_points": 10})
    # opname: system stock now 50-2-12-24 = 12 -> counted 10
    op = admin.post("/stock/opname", json={"items": [{"product_id": p["id"], "counted": 10}], "note": "test"}).json()
    assert op["adjusted_count"] == 1 and op["lines"][0]["diff"] == -2 and op["value_diff"] == -4000
    assert admin.get(f"/products/barcode/{p['barcode']}").json()["stock"] == 10
    for e in ("products", "sales", "purchases", "customers", "suppliers"):
        assert admin.get(f"/export/{e}.xlsx").content[:2] == b"PK"
        assert admin.get(f"/export/{e}.csv").status_code == 200
    kasir = _login("kasir", "kasir123")
    assert kasir.get("/export/products.csv").status_code == 403


def test_units_member_breakdown():
    admin = _login("admin", "admin123")
    ubc = f"77{uuid.uuid4().int % 10**10:010d}"
    p = admin.post("/products", json={"sku": f"T-{uuid.uuid4().hex[:6]}", "name": "Satuan Test", "unit": "pcs", "buy_price": 1000,
                                      "sell_price": 1500, "stock": 100, "units": [{"name": "dus", "factor": 40, "price": 55000, "barcode": ubc}]}).json()
    assert admin.get(f"/products/barcode/{ubc}").json()["id"] == p["id"]
    s = admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 2, "unit": "dus"}, {"product_id": p["id"], "qty": 3}],
                                   "payment_method": "qris", "amount_paid": 0}).json()
    dus = [i for i in s["items"] if i["unit"] == "dus"][0]
    assert dus["price"] == 55000 and dus["factor"] == 40 and dus["buy_price"] == 40000 and s["total"] == 114500
    assert admin.get(f"/products/barcode/{p['barcode']}").json()["stock"] == 17  # 100 - 80 - 3
    assert admin.post("/sales", json={"items": [{"product_id": p["id"], "qty": 1, "unit": "dus"}], "payment_method": "qris", "amount_paid": 0}).status_code == 400
    # sale return in base units: return 40 pcs -> refund = 40 * (114500/83)
    r = admin.post("/returns", json={"type": "sale", "ref_id": s["id"], "items": [{"product_id": p["id"], "qty": 40}], "reason": "dus rusak"})
    assert r.status_code == 200 and admin.get(f"/products/barcode/{p['barcode']}").json()["stock"] == 57
    # member card
    c = admin.post("/customers", json={"name": f"Pelanggan {uuid.uuid4().hex[:5]}"}).json()
    assert c["member_code"].startswith("MBR")
    assert admin.get(f"/customers/by-code/{c['member_code']}").json()["id"] == c["id"]
    assert admin.get("/customers/by-code/MBR000000X").status_code == 404
    b = admin.get(f"/reports/breakdown?start={s['date']}&end={s['date']}").json()
    assert b["by_cashier"] and b["by_category"]


def test_kasir_permissions():
    admin = _login("admin", "admin123")
    kasir_id = [u for u in admin.get("/users").json() if u["username"] == "kasir"][0]["id"]
    def set_perms(perms):
        r = admin.put(f"/users/{kasir_id}", json={"full_name": "Kasir Toko", "role": "kasir", "active": True, "permissions": perms})
        assert r.status_code == 200, r.text
        return r.json()
    assert admin.put(f"/users/{kasir_id}", json={"full_name": "Kasir Toko", "role": "kasir", "active": True, "permissions": ["hack"]}).status_code == 422
    p = admin.post("/products", json={"sku": f"T-{uuid.uuid4().hex[:6]}", "name": "Izin Test", "buy_price": 1000, "sell_price": 2000, "stock": 20}).json()
    c = admin.post("/customers", json={"name": f"Pelanggan {uuid.uuid4().hex[:5]}"}).json()
    try:
        set_perms([])
        k = _login("kasir", "kasir123")
        assert k.get("/auth/me").json()["permissions"] == []
        assert k.post("/sales", json={"items": [{"product_id": p["id"], "qty": 1, "discount": 500}], "payment_method": "qris", "amount_paid": 0}).status_code == 403
        assert k.post("/sales", json={"items": [{"product_id": p["id"], "qty": 1}], "payment_method": "hutang", "amount_paid": 0, "customer_id": c["id"]}).status_code == 403
        sale = k.post("/sales", json={"items": [{"product_id": p["id"], "qty": 1}], "payment_method": "qris", "amount_paid": 0}).json()
        assert k.post(f"/sales/{sale['id']}/void", json={"reason": "salah input"}).status_code == 403
        assert k.get(f"/reports/daily?date={sale['date']}").status_code == 403
        assert k.post("/returns", json={"type": "sale", "ref_id": sale["id"], "items": [{"product_id": p["id"], "qty": 1}], "reason": "rusak"}).status_code == 403
        assert k.get("/debts").status_code == 403
        # grant -> takes effect immediately (no re-login)
        set_perms(["give_discount", "void_sale", "view_reports", "process_returns", "receive_debt_payment", "sell_on_credit"])
        assert k.post("/sales", json={"items": [{"product_id": p["id"], "qty": 1, "discount": 200}], "payment_method": "qris", "amount_paid": 0}).status_code == 200  # 10% = within limit
        assert k.get(f"/reports/daily?date={sale['date']}").status_code == 200
        assert k.get("/debts").status_code == 200
        assert k.post("/returns", json={"type": "sale", "ref_id": sale["id"], "items": [{"product_id": p["id"], "qty": 1}], "reason": "rusak"}).status_code == 200
        s2 = k.post("/sales", json={"items": [{"product_id": p["id"], "qty": 1}], "payment_method": "qris", "amount_paid": 0}).json()
        assert k.post(f"/sales/{s2['id']}/void", json={"reason": "salah input"}).status_code == 200
        # purchase returns stay admin-only; admin-only areas unaffected
        assert k.get("/users").status_code == 403 and k.get("/backups").status_code == 403
    finally:
        set_perms(["give_discount", "sell_on_credit"])


def test_admin_pin_discount_limit_expiry():
    admin = _login("admin", "admin123")
    assert admin.put("/users/me/pin", json={"pin": "1234", "current_password": "salah"}).status_code == 403
    assert admin.put("/users/me/pin", json={"pin": "1234", "current_password": "admin123"}).status_code == 200
    assert [u for u in admin.get("/users").json() if u["username"] == "admin"][0]["has_pin"] is True
    p = admin.post("/products", json={"sku": f"T-{uuid.uuid4().hex[:6]}", "name": "PIN Test", "buy_price": 5000, "sell_price": 10000, "stock": 30}).json()
    k = _login("kasir", "kasir123")
    base = {"items": [{"product_id": p["id"], "qty": 1}], "payment_method": "qris", "amount_paid": 0}
    # 10% allowed, 20% needs PIN
    assert k.post("/sales", json={**base, "discount_type": "nominal", "discount_value": 1000}).status_code == 200
    r = k.post("/sales", json={**base, "discount_type": "percent", "discount_value": 20})
    assert r.status_code == 403 and r.json()["message"].startswith("Butuh PIN admin")
    assert k.post("/sales", json={**base, "discount_type": "percent", "discount_value": 20, "approval_pin": "9999"}).json()["message"] == "PIN admin salah"
    ok = k.post("/sales", json={**base, "discount_type": "percent", "discount_value": 20, "approval_pin": "1234"})
    assert ok.status_code == 200 and ok.json()["total"] == 8000
    # admin not limited
    assert admin.post("/sales", json={**base, "discount_type": "percent", "discount_value": 50}).status_code == 200
    # void by kasir without permission -> needs PIN
    sale = ok.json()
    assert k.post(f"/sales/{sale['id']}/void", json={"reason": "salah input"}).status_code == 403
    assert k.post(f"/sales/{sale['id']}/void", json={"reason": "salah input", "approval_pin": "1234"}).status_code == 200
    # expiry batch from purchase shows on dashboard, dismiss removes it
    sup = admin.post("/suppliers", json={"name": f"Sup {uuid.uuid4().hex[:6]}"}).json()
    admin.post("/purchases", json={"supplier_id": sup["id"], "invoice_no": "EXP1", "date": sale["date"],
                                   "items": [{"product_id": p["id"], "qty": 5, "buy_price": 5000, "expiry_date": sale["date"]}]})
    exp = [x for x in admin.get("/dashboard").json()["expiring"] if x["sku"] == p["sku"]]
    assert exp and exp[0]["days_left"] == 0
    assert admin.post(f"/batches/{exp[0]['id']}/dismiss").status_code == 200
    assert not [x for x in admin.get("/dashboard").json()["expiring"] if x["sku"] == p["sku"]]


def test_morning_summary_and_fonnte():
    admin = _login("admin", "admin123")
    s = admin.get("/notifications/morning-summary").json()
    assert "RINGKASAN PAGI" in s["text"] and "Hutang jatuh tempo" in s["text"]
    st = admin.get("/integrations/fonnte").json()
    if not st["configured"]:
        r = admin.post("/notifications/morning-summary/send").json()
        assert r["status"] is False and "Token" in r["reason"]
    # invalid token -> Fonnte rejects, error surfaced (no crash); then removed again
    if st["source"] != "database":
        assert admin.put("/integrations/fonnte", json={"token": "invalid-test-token"}).json()["configured"] is True
        r = admin.post("/integrations/fonnte/test").json()
        assert r["status"] is False and r["reason"]
        assert admin.put("/integrations/fonnte", json={"token": ""}).json()["source"] in ("none", "env")
    assert admin.get("/notifications/logs").status_code == 200
    assert _login("kasir", "kasir123").get("/integrations/fonnte").status_code == 403
