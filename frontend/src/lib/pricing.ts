// Mirror of backend/lib/pricing.py — keep in sync.
import type { Product } from "@/lib/types";

export type PriceType = "normal" | "promo" | "grosir";

export function promoActive(p: Product, today: string): boolean {
  return p.promo_price != null && p.promo_price > 0 && p.promo_price < p.sell_price
    && (!p.promo_start || p.promo_start <= today) && (!p.promo_end || today <= p.promo_end);
}

export function effectivePrice(p: Product, qty: number, today: string): { price: number; type: PriceType } {
  let price = p.sell_price;
  let type: PriceType = "normal";
  if (promoActive(p, today)) {
    price = p.promo_price as number;
    type = "promo";
  }
  const tiers = (p.wholesale_tiers ?? []).filter((t) => t.min_qty <= qty);
  if (tiers.length) {
    const best = tiers.reduce((a, b) => (b.min_qty > a.min_qty ? b : a));
    if (best.price < price) {
      price = best.price;
      type = "grosir";
    }
  }
  return { price, type };
}
