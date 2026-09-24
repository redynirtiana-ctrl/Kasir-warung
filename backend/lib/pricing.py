"""Effective unit price: lowest of normal, active promo (date range), and best wholesale tier for the qty.
Mirror: frontend/src/lib/pricing.ts — keep in sync."""


def effective_price(product: dict, qty: float, today: str) -> tuple[float, str]:
    price, kind = float(product["sell_price"]), "normal"
    promo = product.get("promo_price")
    if promo is not None and promo > 0:
        start, end = product.get("promo_start"), product.get("promo_end")
        if (not start or start <= today) and (not end or today <= end) and promo < price:
            price, kind = float(promo), "promo"
    tiers = [t for t in product.get("wholesale_tiers") or [] if t["min_qty"] <= qty]
    if tiers:
        best = max(tiers, key=lambda t: t["min_qty"])
        if best["price"] < price:
            price, kind = float(best["price"]), "grosir"
    return price, kind
