import { useEffect, useState } from "react";
import { ShoppingBasket, Sparkles, Store } from "lucide-react";
import type { DisplayState } from "@/lib/types";
import { num, rupiah } from "@/lib/format";

/** Customer-facing second screen. Open from the POS (monitor icon) and drag to the customer monitor. */
export default function CustomerDisplay() {
  const [s, setS] = useState<DisplayState | null>(null);

  useEffect(() => {
    document.title = "Layar Pelanggan";
    if (!("BroadcastChannel" in window)) return;
    const ch = new BroadcastChannel("wbc-display");
    ch.onmessage = (e: MessageEvent) => { if (e.data && typeof e.data === "object") setS(e.data as DisplayState); };
    ch.postMessage("hello");
    return () => ch.close();
  }, []);

  const items = s?.items ?? [];
  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-green-50 via-white to-amber-50 p-6 text-slate-900" data-testid="customer-display">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-green-700 text-white"><Store /></div>
          <div>
            <div className="font-heading text-2xl font-bold" data-testid="display-store">{s?.store || "WARUNG BU CUCUN"}</div>
            <div className="text-sm text-muted-foreground">Selamat berbelanja</div>
          </div>
        </div>
        {s?.customer && (
          <div className="rounded-2xl bg-violet-100 px-5 py-3 text-right text-violet-900" data-testid="display-customer">
            <div className="text-sm">Member</div>
            <div className="text-lg font-bold">{s.customer.name} · {num(s.customer.points)} poin</div>
          </div>
        )}
      </header>

      {s?.thanks ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center" data-testid="display-thanks">
          <Sparkles className="size-14 text-amber-500" />
          <div className="mt-4 font-heading text-5xl font-bold text-green-800">Terima kasih!</div>
          <div className="mt-6 grid grid-cols-3 gap-6 text-xl">
            <div><div className="text-sm text-muted-foreground">Total</div><b>{rupiah(s.thanks.total)}</b></div>
            <div><div className="text-sm text-muted-foreground">Bayar</div><b>{rupiah(s.thanks.paid)}</b></div>
            <div><div className="text-sm text-muted-foreground">Kembalian</div><b className="text-green-700" data-testid="display-change">{rupiah(s.thanks.change)}</b></div>
          </div>
          {s.thanks.points_earned > 0 && <div className="mt-6 rounded-full bg-violet-100 px-5 py-2 text-lg font-semibold text-violet-900">+{num(s.thanks.points_earned)} poin didapat</div>}
        </div>
      ) : (
        <div className="mt-6 grid min-h-0 flex-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="min-h-0 overflow-y-auto rounded-3xl border bg-white/80 p-5 shadow-sm backdrop-blur" data-testid="display-items">
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground"><ShoppingBasket className="size-14" /><p className="mt-3 text-xl">Menunggu belanjaan…</p></div>
            ) : items.map((i, idx) => (
              <div key={idx} className="flex items-center justify-between border-b py-3 text-lg last:border-0" data-testid={`display-item-${idx}`}>
                <div>
                  <div className="font-semibold">{i.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {num(i.qty)} {i.unit} × {rupiah(i.price)}
                    {i.type !== "normal" && <><span className="ml-2 line-through">{rupiah(i.normal)}</span><span className={`ml-2 rounded px-1.5 text-xs font-bold ${i.type === "promo" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>{i.type === "promo" ? "PROMO" : "GROSIR"}</span></>}
                  </div>
                </div>
                <div className="font-semibold">{rupiah(i.subtotal)}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-col justify-end gap-3 rounded-3xl bg-green-800 p-6 text-white shadow-lg">
            <div className="flex justify-between text-lg opacity-90"><span>Subtotal</span><span>{rupiah(s?.subtotal ?? 0)}</span></div>
            {!!s?.discount && <div className="flex justify-between text-lg text-amber-200"><span>Diskon</span><span>-{rupiah(s.discount)}</span></div>}
            {!!s?.tax && <div className="flex justify-between text-lg opacity-90"><span>Pajak</span><span>{rupiah(s.tax)}</span></div>}
            <div className="mt-2 border-t border-white/30 pt-4 text-sm uppercase tracking-widest opacity-80">Total</div>
            <div className="font-heading text-6xl font-bold" data-testid="display-total">{rupiah(s?.total ?? 0)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
