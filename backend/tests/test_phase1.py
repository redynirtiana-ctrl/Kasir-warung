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
