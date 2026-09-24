import JsBarcode from "jsbarcode";
import type { Product, Sale, Settings } from "@/lib/types";
import { num, PAYMENT_LABELS } from "@/lib/format";

/** Print arbitrary HTML via a hidden iframe (browser print dialog → thermal printer driver). */
export function printHtml(body: string, pageCss: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${pageCss}</style></head><body>${body}</body></html>`);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 250);
}

export function barcodeSvg(code: string, opts: { height?: number; width?: number; fontSize?: number } = {}): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(svg, code, {
      format: "CODE128",
      height: opts.height ?? 40,
      width: opts.width ?? 1.5,
      fontSize: opts.fontSize ?? 12,
      margin: 2,
    });
  } catch {
    return `<span>${code}</span>`;
  }
  return svg.outerHTML;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function receiptHtml(sale: Sale, s: Settings): string {
  const rows = sale.items
    .map(
      (i) => `<div class="b">${esc(i.name)}</div>
<div class="r"><span>${num(i.qty)} x ${num(i.price)}${i.price_type === "promo" ? " PROMO" : i.price_type === "grosir" ? " GROSIR" : ""}${i.discount ? ` (-${num(i.discount)})` : ""}</span><span>${num(i.subtotal)}</span></div>`,
    )
    .join("");
  const line = (l: string, v: string, cls = "") => `<div class="r ${cls}"><span>${l}</span><span>${v}</span></div>`;
  return `<div class="c b big">${esc(s.store_name)}</div>
<div class="c">${esc(s.address)}</div><div class="c">WA: ${esc(s.whatsapp)}</div>
<div class="hr"></div>
${line("No", sale.invoice_no)}${line("Tanggal", new Date(sale.created_at).toLocaleString("id-ID"))}${line("Kasir", esc(sale.cashier_name))}
<div class="hr"></div>${rows}<div class="hr"></div>
${line("Subtotal", num(sale.subtotal))}${sale.discount ? line("Diskon", "-" + num(sale.discount)) : ""}${sale.tax ? line("Pajak", num(sale.tax)) : ""}
${line("TOTAL", num(sale.total), "b big")}
${line("Bayar (" + (PAYMENT_LABELS[sale.payment_method] ?? sale.payment_method) + ")", num(sale.amount_paid))}${sale.payment_method === "hutang" ? line("Sisa hutang", num(sale.total - sale.amount_paid), "b") : line("Kembalian", num(sale.change))}
${sale.customer_name ? line("Pelanggan", esc(sale.customer_name)) : ""}${sale.points_redeemed ? line(`Tukar ${sale.points_redeemed} poin`, "-" + num(sale.points_discount)) : ""}${sale.points_earned ? line("Poin didapat", "+" + num(sale.points_earned)) : ""}
${sale.status === "void" ? '<div class="c b">*** VOID ***</div>' : ""}
<div class="hr"></div><div class="c">${esc(s.receipt_footer).replace(/\n/g, "<br>")}</div><div class="hr"></div>`;
}

export function receiptCss(paper: "58" | "80"): string {
  const w = paper === "80" ? 72 : 48;
  return `@page{size:${paper}mm auto;margin:2mm}body{width:${w}mm;margin:0 auto;font-family:'Courier New',monospace;font-size:${paper === "80" ? 12 : 10.5}px;color:#000}
.c{text-align:center}.b{font-weight:bold}.big{font-size:1.25em}.r{display:flex;justify-content:space-between;gap:4px}.hr{border-top:1px dashed #000;margin:4px 0}`;
}

export function printReceipt(sale: Sale, s: Settings) {
  printHtml(receiptHtml(sale, s), receiptCss(s.paper_size));
}

export interface LabelSize {
  widthMm: number;
  heightMm: number;
}

export function printLabels(items: { product: Product; copies: number }[], size: LabelSize) {
  const labels = items
    .flatMap(({ product, copies }) => Array.from({ length: copies }, () => product))
    .filter((p) => p.barcode)
    .map(
      (p) => `<div class="lbl"><div class="n">${esc(p.name)}</div>${barcodeSvg(p.barcode!, { height: size.heightMm * 1.1, width: 1.3, fontSize: 10 })}<div class="p">Rp ${num(p.sell_price)}</div></div>`,
    )
    .join("");
  const css = `@page{margin:4mm}body{margin:0;font-family:Arial,sans-serif;display:flex;flex-wrap:wrap;gap:2mm}
.lbl{width:${size.widthMm}mm;height:${size.heightMm}mm;border:1px dashed #999;box-sizing:border-box;padding:1mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;page-break-inside:avoid}
.lbl svg{max-width:100%;height:auto}.n{font-size:9px;font-weight:bold;text-align:center;white-space:nowrap;overflow:hidden;max-width:100%}.p{font-size:11px;font-weight:bold}`;
  printHtml(labels, css);
}

/** Member card, credit-card size (85.6 × 54 mm), CODE128 barcode of member_code. */
export function printMemberCards(customers: { name: string; member_code: string; whatsapp: string }[], settings: Settings): void {
  const cards = customers.map((c) => `<div class="card"><div class="top"><b>${esc(settings.store_name)}</b><span>KARTU MEMBER</span></div>
<div class="nm">${esc(c.name)}</div><div class="wa">${esc(c.whatsapp || "")}</div>${barcodeSvg(c.member_code, { height: 34, width: 1.6, fontSize: 12 })}</div>`).join("");
  printHtml(cards, `@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;display:flex;flex-wrap:wrap;gap:6mm}
.card{width:85.6mm;height:54mm;box-sizing:border-box;border:1px solid #15803D;border-radius:4mm;padding:4mm 5mm;background:linear-gradient(135deg,#f0fdf4,#fff7ed);display:flex;flex-direction:column;page-break-inside:avoid}
.top{display:flex;justify-content:space-between;font-size:10px;color:#166534}.top span{letter-spacing:1px}
.nm{font-size:16px;font-weight:bold;margin-top:4mm}.wa{font-size:10px;color:#555;margin-bottom:auto}svg{align-self:center;max-width:100%}`);
}
