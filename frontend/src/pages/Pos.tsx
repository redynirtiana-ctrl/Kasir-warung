import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ScanBarcode, Search, Trash2, Minus, Plus, PauseCircle, FolderOpen, Printer, CreditCard, X } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { effectivePrice, promoActive } from "@/lib/pricing";
import type { Category, Customer, PaymentMethod, Product, Sale, SaleIn, Settings } from "@/lib/types";
import { todayLocal, errMsg, num, PAYMENT_LABELS, rupiah, stockStatus } from "@/lib/format";
import { printReceipt, receiptHtml } from "@/lib/print";
import { useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CartItem { product: Product; qty: number; discount: number }
interface Cart { id: number; items: CartItem[]; discountType: "nominal" | "percent"; discountValue: number }

const STORAGE = "wbc-carts";
const newCart = (id: number): Cart => ({ id, items: [], discountType: "nominal", discountValue: 0 });

function loadCarts(): Cart[] {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE) ?? "[]") as Cart[];
    return c.length ? c : [newCart(1)];
  } catch {
    return [newCart(1)];
  }
}

const TODAY = todayLocal();
const unitPrice = (p: Product, qty: number) => effectivePrice(p, qty, TODAY);

function calc(cart: Cart, taxPercent: number, extraDiscount = 0) {
  const subtotal = cart.items.reduce((s, i) => s + Math.max(0, unitPrice(i.product, i.qty).price * i.qty - i.discount), 0);
  const raw = cart.discountType === "percent" ? (subtotal * cart.discountValue) / 100 : cart.discountValue;
  const discount = Math.round(Math.min(raw, subtotal)) + extraDiscount;
  const tax = Math.round(((subtotal - discount) * taxPercent) / 100);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

export default function Pos() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [carts, setCarts] = useState<Cart[]>(loadCarts);
  const [activeId, setActiveId] = useState<number>(() => loadCarts()[0].id);
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [catId, setCatId] = useState("");
  const [flash, setFlash] = useState(0);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paid, setPaid] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [redeemPts, setRedeemPts] = useState(0);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: products = [] } = useQuery({ queryKey: ["products", "pos"], queryFn: () => apiGet<Product[]>("/v1/products?active_only=true") });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => apiGet<Category[]>("/v1/categories") });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/v1/settings") });

  useEffect(() => localStorage.setItem(STORAGE, JSON.stringify(carts)), [carts]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const cart = carts.find((c) => c.id === activeId) ?? carts[0];
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => apiGet<Customer[]>("/v1/customers"), enabled: payOpen });
  const totals = calc(cart, settings?.tax_percent ?? 0);
  const selCustomer = customers.find((c) => c.id === customerId);
  const loyalty = !!settings?.loyalty_enabled && !!selCustomer;
  const maxRedeem = loyalty && settings!.point_value > 0
    ? Math.min(selCustomer!.points, Math.floor((totals.subtotal - totals.discount) / settings!.point_value)) : 0;
  const pointsDiscount = loyalty ? Math.min(redeemPts, maxRedeem) * settings!.point_value : 0;
  const payTotals = calc(cart, settings?.tax_percent ?? 0, pointsDiscount);
  const paidNum = Number(paid) || 0;
  const change = paidNum - totals.total;

  const updateCart = (fn: (c: Cart) => Cart) => setCarts((cs) => cs.map((c) => (c.id === cart.id ? fn(c) : c)));

  const addToCart = (p: Product) => {
    const inCart = cart.items.find((i) => i.product.id === p.id)?.qty ?? 0;
    if (inCart + 1 > p.stock) {
      toast.error(p.stock <= 0 ? `STOK HABIS: ${p.name}` : `Stok ${p.name} hanya ${num(p.stock)}`);
      return;
    }
    updateCart((c) => {
      const exists = c.items.some((i) => i.product.id === p.id);
      const items = exists
        ? c.items.map((i) => (i.product.id === p.id ? { ...i, qty: i.qty + 1, product: p } : i))
        : [...c.items, { product: p, qty: 1, discount: 0 }];
      return { ...c, items };
    });
    setFlash((f) => f + 1);
  };

  const setQty = (id: string, qty: number) =>
    updateCart((c) => ({
      ...c,
      items: c.items
        .map((i) => (i.product.id === id ? { ...i, qty: Math.min(Math.max(qty, 0), i.product.stock) } : i))
        .filter((i) => i.qty > 0),
    }));

  const handleScan = async () => {
    const code = scan.trim();
    if (!code) return;
    setScan("");
    const local = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
    if (local) return addToCart(local);
    try {
      addToCart(await apiGet<Product>(`/v1/products/barcode/${encodeURIComponent(code)}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(code);
      else toast.error(errMsg(e));
    }
  };

  const holdCart = () => {
    if (!cart.items.length) return toast.info("Keranjang masih kosong");
    const id = Math.max(...carts.map((c) => c.id)) + 1;
    setCarts((cs) => [...cs, newCart(id)]);
    setActiveId(id);
    toast.success(`Transaksi #${cart.id} ditahan`);
  };

  const removeCart = (id: number) => {
    const rest = carts.filter((c) => c.id !== id);
    const next = rest.length ? rest : [newCart(1)];
    setCarts(next);
    if (id === activeId) setActiveId(next[next.length - 1].id);
  };

  const openPay = () => {
    if (!cart.items.length) return toast.info("Keranjang masih kosong");
    setMethod("cash");
    setPaid("");
    setCustomerId("");
    setDueDate("");
    setRedeemPts(0);
    setPayOpen(true);
  };

  const pay = useMutation({
    mutationFn: (body: SaleIn) => apiPost<Sale>("/v1/sales", body),
    onSuccess: (sale) => {
      setLastSale(sale);
      setPayOpen(false);
      setReceiptOpen(true);
      removeCart(cart.id);
      toast.success(`Transaksi berhasil · ${sale.invoice_no}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["debts"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submitPay = () => {
    if (method === "cash" && paidNum < payTotals.total) return toast.error("Uang diterima kurang");
    if (method === "hutang" && !customerId) return toast.error("Pilih pelanggan untuk hutang");
    if (method === "hutang" && paidNum >= payTotals.total) return toast.error("DP harus lebih kecil dari total");
    if (redeemPts && redeemPts < (settings?.min_redeem_points ?? 0)) return toast.error(`Minimal tukar ${settings?.min_redeem_points} poin`);
    pay.mutate({
      redeem_points: redeemPts,
      customer_id: customerId || null,
      due_date: method === "hutang" && dueDate ? dueDate : null,
      items: cart.items.map((i) => ({ product_id: i.product.id, qty: i.qty, discount: i.discount })),
      discount_type: cart.discountType,
      discount_value: cart.discountValue,
      payment_method: method,
      amount_paid: method === "cash" || method === "hutang" ? paidNum : payTotals.total,
    });
  };

  const printLast = () => {
    if (lastSale && settings) printReceipt(lastSale, settings);
    else toast.info("Belum ada struk untuk dicetak");
  };

  // Keyboard shortcuts (F1 handled globally in layout)
  const handlers = useRef({ holdCart, openPay, printLast });
  handlers.current = { holdCart, openPay, printLast };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, () => void> = {
        F2: () => searchRef.current?.focus(),
        F3: () => scanRef.current?.focus(),
        F4: () => handlers.current.openPay(),
        F5: () => handlers.current.holdCart(),
        F6: () => setHeldOpen(true),
        F12: () => handlers.current.printLast(),
      };
      if (map[e.key]) {
        e.preventDefault();
        map[e.key]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (!catId || p.category_id === catId) &&
          (!debounced || [p.name, p.sku, p.barcode ?? "", p.category_name ?? ""].some((f) => f.toLowerCase().includes(debounced))),
      ),
    [products, catId, debounced],
  );

  const quick = [totals.total, 20000, 50000, 100000].filter((v, i, a) => v >= totals.total && a.indexOf(v) === i);
  const methods = (settings?.payment_methods ?? ["cash"]) as PaymentMethod[];

  return (
    <div className="grid h-full grid-cols-1 gap-4 p-3 md:p-4 lg:grid-cols-12 lg:overflow-hidden">
      {/* LEFT: catalog */}
      <section className="flex min-h-0 flex-col rounded-2xl border bg-white p-4 shadow-sm lg:col-span-7 xl:col-span-8">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <ScanBarcode className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-green-700" />
            <Input
              key={flash}
              ref={scanRef}
              autoFocus
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e: ReactKeyboardEvent) => e.key === "Enter" && handleScan()}
              placeholder="Scan / ketik barcode lalu Enter (F3)"
              className={cn("h-12 pl-10 font-mono text-base", flash > 0 && "animate-scan-flash")}
              data-testid="pos-barcode-input"
            />
          </div>
          <Button className="h-12" onClick={handleScan} data-testid="pos-scan-button"><ScanBarcode /> Scan</Button>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama, SKU, barcode, kategori (F2)" className="h-10 pl-9" data-testid="pos-search-input" />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {[{ id: "", name: "Semua" }, ...categories].map((c) => (
            <button key={c.id} onClick={() => setCatId(c.id)} data-testid={`pos-category-${c.id || "all"}`}
              className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150",
                catId === c.id ? "border-primary bg-primary text-white" : "bg-white hover:bg-green-50")}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="mt-3 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4" data-testid="pos-product-grid">
          {filtered.map((p) => {
            const st = stockStatus(p.stock, p.min_stock);
            return (
              <button key={p.id} onClick={() => addToCart(p)} disabled={st === "habis"} data-testid={`pos-product-${p.sku}`}
                className="flex flex-col rounded-xl border bg-white p-3 text-left transition-transform duration-75 hover:border-green-600 hover:shadow-md active:scale-95 disabled:opacity-50">
                <span className="line-clamp-2 min-h-10 text-sm font-semibold">{p.name}</span>
                {promoActive(p, TODAY) ? (
                  <span className="mt-1 flex items-baseline gap-1.5"><span className="font-heading text-lg font-bold text-rose-700">{rupiah(p.promo_price as number)}</span><span className="text-xs text-muted-foreground line-through">{rupiah(p.sell_price)}</span></span>
                ) : <span className="mt-1 font-heading text-lg font-bold text-green-800">{rupiah(p.sell_price)}</span>}
                {(p.wholesale_tiers?.length ?? 0) > 0 && <span className="text-[11px] font-medium text-sky-700">Grosir mulai {num(Math.min(...p.wholesale_tiers.map((t) => t.min_qty)))} {p.unit}</span>}
                <span className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Stok {num(p.stock)} {p.unit}</span>
                  {st !== "aman" && <Badge className={st === "habis" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}>{st === "habis" ? "HABIS" : "MENIPIS"}</Badge>}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">Produk tidak ditemukan</p>}
        </div>
      </section>

      {/* RIGHT: cart */}
      <section className="flex min-h-0 flex-col rounded-2xl border bg-white p-4 shadow-sm lg:col-span-5 xl:col-span-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {carts.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} data-testid={`cart-tab-${c.id}`}
              className={cn("shrink-0 rounded-lg px-3 py-1 text-xs font-semibold", c.id === cart.id ? "bg-green-100 text-green-900" : "bg-muted text-muted-foreground")}>
              #{c.id} ({c.items.length})
            </button>
          ))}
          <div className="ml-auto flex shrink-0 gap-1">
            <Button size="sm" variant="outline" onClick={holdCart} data-testid="pos-hold-button"><PauseCircle /> Hold F5</Button>
            <Button size="sm" variant="outline" onClick={() => setHeldOpen(true)} data-testid="pos-open-held-button"><FolderOpen /> F6</Button>
          </div>
        </div>
        <div className="min-h-40 flex-1 divide-y overflow-y-auto" data-testid="cart-items">
          {cart.items.map((i) => (
            <div key={i.product.id} className="py-2.5" data-testid={`cart-item-${i.product.sku}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{i.product.name}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {(() => { const ep = unitPrice(i.product, i.qty); return (<>
                      <span data-testid={`cart-item-price-${i.product.sku}`}>{rupiah(ep.price)}</span>
                      {ep.type !== "normal" && <><span className="line-through">{rupiah(i.product.sell_price)}</span><Badge className={ep.type === "promo" ? "bg-rose-100 text-rose-800" : "bg-sky-100 text-sky-800"} data-testid={`cart-item-pricetype-${i.product.sku}`}>{ep.type === "promo" ? "PROMO" : "GROSIR"}</Badge></>}
                    </>); })()}
                    <span>· stok {num(i.product.stock)}</span>
                  </div>
                </div>
                <div className="text-right font-semibold" data-testid={`cart-item-subtotal-${i.product.sku}`}>{rupiah(unitPrice(i.product, i.qty).price * i.qty - i.discount)}</div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Button size="icon-sm" variant="outline" onClick={() => setQty(i.product.id, i.qty - 1)} data-testid={`cart-dec-${i.product.sku}`}><Minus /></Button>
                <Input value={i.qty} onChange={(e) => setQty(i.product.id, Number(e.target.value) || 0)} className="h-8 w-14 text-center" data-testid={`cart-qty-${i.product.sku}`} />
                <Button size="icon-sm" variant="outline" onClick={() => addToCart(i.product)} data-testid={`cart-inc-${i.product.sku}`}><Plus /></Button>
                <Input type="number" min={0} placeholder="Diskon Rp" value={i.discount || ""}
                  onChange={(e) => updateCart((c) => ({ ...c, items: c.items.map((x) => (x.product.id === i.product.id ? { ...x, discount: Math.max(0, Number(e.target.value) || 0) } : x)) }))}
                  className="h-8 flex-1 text-orange-600" data-testid={`cart-discount-${i.product.sku}`} />
                <Button size="icon-sm" variant="ghost" onClick={() => setQty(i.product.id, 0)} data-testid={`cart-remove-${i.product.sku}`}><Trash2 className="text-rose-600" /></Button>
              </div>
            </div>
          ))}
          {cart.items.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">Keranjang kosong — scan barcode atau klik produk</p>}
        </div>
        <div className="space-y-2 border-t pt-3 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span data-testid="cart-subtotal">{rupiah(totals.subtotal)}</span></div>
          <div className="flex items-center justify-between gap-2">
            <span>Diskon transaksi</span>
            <div className="flex gap-1">
              <select value={cart.discountType} onChange={(e) => updateCart((c) => ({ ...c, discountType: e.target.value as Cart["discountType"] }))}
                className="h-8 rounded-md border px-1 text-xs" data-testid="cart-discount-type">
                <option value="nominal">Rp</option>
                <option value="percent">%</option>
              </select>
              <Input type="number" min={0} value={cart.discountValue || ""} onChange={(e) => updateCart((c) => ({ ...c, discountValue: Math.max(0, Number(e.target.value) || 0) }))}
                className="h-8 w-24" data-testid="cart-discount-input" />
            </div>
          </div>
          {totals.discount > 0 && <div className="flex justify-between text-orange-600"><span>Potongan</span><span>-{rupiah(totals.discount)}</span></div>}
          {totals.tax > 0 && <div className="flex justify-between"><span>Pajak ({settings?.tax_percent}%)</span><span>{rupiah(totals.tax)}</span></div>}
          <div className="flex items-center justify-between rounded-xl bg-green-100 px-4 py-3 text-green-900">
            <span className="font-semibold">TOTAL</span>
            <span className="font-heading text-2xl font-bold" data-testid="cart-total">{rupiah(totals.total)}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Button variant="outline" className="h-12" onClick={printLast} data-testid="pos-print-last-button" title="Cetak struk terakhir (F12)"><Printer /></Button>
            <Button className="col-span-3 h-12 text-base" onClick={openPay} data-testid="pos-pay-button"><CreditCard /> Bayar (F4)</Button>
          </div>
        </div>
      </section>

      {/* Payment */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Pembayaran</DialogTitle></DialogHeader>
          <div className="rounded-xl bg-green-50 p-4 text-center">
            <div className="text-sm text-green-800">Total Akhir</div>
            <div className="font-heading text-3xl font-bold text-green-900" data-testid="pay-total">{rupiah(payTotals.total)}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {methods.map((m) => (
              <button key={m} onClick={() => setMethod(m)} data-testid={`pay-method-${m}`}
                className={cn("rounded-lg border py-2 text-sm font-medium transition-colors duration-150", method === m ? "border-primary bg-primary text-white" : "hover:bg-muted")}>
                {PAYMENT_LABELS[m] ?? m}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Pelanggan {method === "hutang" ? "(wajib)" : "(opsional)"}</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-9 w-full rounded-md border bg-white px-2 text-sm" data-testid="pay-customer-select">
              <option value="">- Umum -</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.debt_remaining > 0 ? `${c.name} (hutang ${rupiah(c.debt_remaining)})` : c.name}</option>)}
            </select>
          </div>
          {loyalty && (
            <div className="rounded-lg bg-violet-50 p-3 text-sm" data-testid="pay-points-box">
              <div className="flex justify-between"><span>Poin {selCustomer!.name}</span><b data-testid="pay-customer-points">{num(selCustomer!.points)} poin</b></div>
              {maxRedeem >= (settings!.min_redeem_points || 1) ? (
                <div className="mt-2 flex items-center gap-2">
                  <Input type="number" min={0} max={maxRedeem} value={redeemPts || ""} placeholder="Tukar poin" onChange={(e) => setRedeemPts(Math.max(0, Math.min(maxRedeem, Math.floor(Number(e.target.value) || 0))))} className="h-8 w-28" data-testid="pay-redeem-input" />
                  <Button size="sm" variant="outline" onClick={() => setRedeemPts(maxRedeem)} data-testid="pay-redeem-max">Pakai semua</Button>
                  {pointsDiscount > 0 && <span className="ml-auto font-semibold text-violet-800" data-testid="pay-points-discount">-{rupiah(pointsDiscount)}</span>}
                </div>
              ) : <p className="mt-1 text-xs text-muted-foreground">Minimal {settings!.min_redeem_points} poin untuk ditukar (1 poin = {rupiah(settings!.point_value)})</p>}
              <p className="mt-1 text-xs text-violet-800">Dapat +{num(Math.floor(payTotals.total / settings!.points_per_amount))} poin dari transaksi ini</p>
            </div>
          )}
          {method === "hutang" && (
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-amber-50 p-3">
              <div className="space-y-1"><label className="text-xs font-medium">DP / uang muka</label><Input type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} data-testid="pay-dp-input" /></div>
              <div className="space-y-1"><label className="text-xs font-medium">Jatuh tempo</label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="pay-due-date-input" /></div>
              <div className="col-span-2 flex justify-between text-sm font-semibold text-amber-900"><span>Sisa hutang</span><span data-testid="pay-debt-remaining">{rupiah(Math.max(payTotals.total - paidNum, 0))}</span></div>
            </div>
          )}
          {method === "cash" && (
            <div className="space-y-2">
              <Input autoFocus type="number" placeholder="Uang diterima" value={paid} onChange={(e) => setPaid(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitPay()} className="h-12 text-lg" data-testid="pay-amount-input" />
              <div className="flex flex-wrap gap-2">
                {quick.map((v) => (
                  <Button key={v} size="sm" variant="secondary" onClick={() => setPaid(String(v))} data-testid={`pay-quick-${v}`}>{v === payTotals.total ? "Uang pas" : rupiah(v)}</Button>
                ))}
              </div>
              <div className="flex justify-between text-lg">
                <span>Kembalian</span>
                <span className={cn("font-bold", change < 0 ? "text-rose-600" : "text-green-800")} data-testid="pay-change">{rupiah(Math.max(change, 0))}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button className="h-11 w-full text-base" onClick={submitPay} disabled={pay.isPending} data-testid="pay-submit-button">
              {pay.isPending ? "Memproses…" : "Selesaikan Transaksi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt after sale */}
      <Dialog open={receiptOpen && !!lastSale && !!settings} onOpenChange={(o) => { setReceiptOpen(o); if (!o) scanRef.current?.focus(); }}>
        {lastSale && settings && (
          <DialogContent className="sm:max-w-sm" data-testid="receipt-dialog">
            <DialogHeader><DialogTitle>Transaksi Berhasil</DialogTitle></DialogHeader>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-dashed bg-amber-50 p-3 font-mono text-xs [&_.b]:font-bold [&_.big]:text-sm [&_.c]:text-center [&_.hr]:my-1 [&_.hr]:border-t [&_.hr]:border-dashed [&_.hr]:border-stone-400 [&_.r]:flex [&_.r]:justify-between"
              data-testid="receipt-preview" dangerouslySetInnerHTML={{ __html: receiptHtml(lastSale, settings) }} />
            <DialogFooter className="gap-2">
              <Button onClick={printLast} data-testid="receipt-print-button"><Printer /> Cetak Struk (F12)</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* Held transactions */}
      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transaksi Tertahan</DialogTitle></DialogHeader>
          <div className="divide-y" data-testid="held-list">
            {carts.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-semibold">Transaksi #{c.id} {c.id === cart.id && <Badge variant="secondary">aktif</Badge>}</div>
                  <div className="text-xs text-muted-foreground">{c.items.length} item · {rupiah(calc(c, settings?.tax_percent ?? 0).total)}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => { setActiveId(c.id); setHeldOpen(false); }} data-testid={`held-resume-${c.id}`}>Resume</Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => removeCart(c.id)} data-testid={`held-delete-${c.id}`}><X /></Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Barcode not found */}
      <Dialog open={!!notFound} onOpenChange={(o) => !o && setNotFound(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Barcode tidak ditemukan</DialogTitle></DialogHeader>
          <p className="text-sm" data-testid="barcode-not-found-message">Produk dengan barcode tersebut belum terdaftar.</p>
          <p className="font-mono text-lg">{notFound}</p>
          <DialogFooter>
            {me?.role === "admin" && (
              <Button onClick={() => navigate(`/products?new=${encodeURIComponent(notFound ?? "")}`)} data-testid="barcode-add-product-button">Tambah Produk</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
