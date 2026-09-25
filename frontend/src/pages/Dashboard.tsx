import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, BellRing, CalendarClock, MessageCircle, Sunrise, PackageX, Receipt, TrendingUp, Wallet, ShoppingBag } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, apiPost } from "@/lib/api";
import type { Dashboard as DashboardData, FonnteStatus, MorningSummary, NotificationLog, Settings, User } from "@/lib/types";
import { num, PAYMENT_LABELS, rupiah, fmtDateTime, todayLocal, waLink } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const RANGES = [
  ["today", "Hari ini"],
  ["yesterday", "Kemarin"],
  ["7d", "7 hari"],
  ["month", "Bulan ini"],
  ["custom", "Custom"],
] as const;

export default function Dashboard() {
  const me = useOutletContext<User>();
  const qc = useQueryClient();
  const dismiss = useMutation({
    mutationFn: (id: string) => apiPost(`/v1/batches/${id}/dismiss`),
    onSuccess: () => { toast.success("Ditandai sudah ditangani"); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
  });
  const isAdmin = me?.role === "admin";
  const { data: morning } = useQuery({ queryKey: ["morning-summary"], queryFn: () => apiGet<MorningSummary>("/v1/notifications/morning-summary"), enabled: isAdmin });
  const { data: fonnte } = useQuery({ queryKey: ["fonnte"], queryFn: () => apiGet<FonnteStatus>("/v1/integrations/fonnte"), enabled: isAdmin });
  const sendNow = useMutation({
    mutationFn: () => apiPost<NotificationLog>("/v1/notifications/morning-summary/send"),
    onSuccess: (r) => (r.status ? toast.success("Ringkasan pagi terkirim lewat Fonnte") : toast.error(`Gagal kirim: ${r.reason}`)),
  });
  const [showMorning, setShowMorning] = useState(false);
  const { data: storeSettings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/v1/settings"), enabled: isAdmin });
  const settingsAuto = storeSettings?.morning_summary_enabled ?? true;
  const [range, setRange] = useState<string>("today");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const ready = range !== "custom" || (start && end);
  const { data, isError } = useQuery({
    queryKey: ["dashboard", range, start, end],
    queryFn: () => apiGet<DashboardData>(`/v1/dashboard?range=${range}&start=${start}&end=${end}`),
    enabled: Boolean(ready),
  });
  const d = isError ? undefined : data;

  const kpis = [
    { label: "Total Penjualan", value: d ? rupiah(d.total_sales) : "—", icon: Wallet, cls: "bg-green-100 text-green-900", id: "kpi-total-sales" },
    { label: "Jumlah Transaksi", value: d ? num(d.transaction_count) : "—", icon: Receipt, cls: "bg-white", id: "kpi-transactions" },
    { label: "Produk Terjual", value: d ? num(d.items_sold) : "—", icon: ShoppingBag, cls: "bg-white", id: "kpi-items-sold" },
    { label: "Estimasi Keuntungan", value: d ? rupiah(d.profit) : "—", icon: TrendingUp, cls: "bg-amber-100 text-amber-900", id: "kpi-profit" },
  ];

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{d ? `Periode ${d.start} s/d ${d.end}` : "Ringkasan toko"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border bg-white p-1">
            {RANGES.map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} data-testid={`range-${k}`}
                className={cn("rounded-md px-3 py-1.5 text-sm transition-colors duration-150", range === k ? "bg-primary text-white" : "hover:bg-muted")}>
                {l}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" data-testid="range-start-input" />
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" data-testid="range-end-input" />
            </>
          )}
        </div>
      </div>

      {isAdmin && morning && (
        <div className="rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-50 to-amber-50 p-5" data-testid="morning-summary-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-emerald-900"><Sunrise className="size-4" /> RINGKASAN PAGI</h3>
              <p className="text-sm text-emerald-900/80" data-testid="morning-summary-stats">{morning.due_debts} hutang jatuh tempo ({rupiah(morning.due_total)}) · {morning.expiring} barang kedaluwarsa · {morning.out_of_stock} stok habis</p>
              <p className="text-xs text-muted-foreground">{fonnte?.configured ? (settingsAuto ? "Terkirim otomatis ke WhatsApp setiap 07:00 WIB via Fonnte" : "Kirim otomatis dimatikan di Pengaturan") : "Kirim otomatis 07:00 belum aktif — isi token Fonnte di Pengaturan"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="text-sm font-medium text-emerald-800 hover:underline" onClick={() => setShowMorning((v) => !v)} data-testid="morning-summary-toggle">{showMorning ? "Tutup" : "Lihat pesan"}</button>
              <a className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#25D366] px-3 text-sm font-medium text-white hover:bg-[#1ebe5b]" target="_blank" rel="noreferrer"
                href={waLink(fonnte?.owner_whatsapp ?? "", morning.text)} data-testid="morning-summary-wa-link"><MessageCircle className="size-4" /> Kirim WhatsApp</a>
              {fonnte?.configured && <button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-600 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50" disabled={sendNow.isPending} onClick={() => sendNow.mutate()} data-testid="morning-summary-fonnte-button">Kirim via Fonnte</button>}
            </div>
          </div>
          {showMorning && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-white/80 p-3 font-sans text-sm" data-testid="morning-summary-text">{morning.text}</pre>}
        </div>
      )}

      {d && d.due_debts.length > 0 && (
        <div className="rounded-2xl border border-orange-300 bg-orange-50 p-5" data-testid="due-debts-card">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold text-orange-900"><BellRing className="size-4 animate-pulse" /> HUTANG JATUH TEMPO ({d.due_debts.length}) · {rupiah(d.due_debts.reduce((a, x) => a + x.remaining, 0))}</h3>
            <Link to="/customers" className="text-sm font-medium text-orange-800 hover:underline" data-testid="due-debts-link">Kelola piutang</Link>
          </div>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3" data-testid="due-debts-list">
            {d.due_debts.map((x) => (
              <li key={x.id} className="flex justify-between rounded-lg bg-white/70 px-3 py-2">
                <span><b>{x.customer_name}</b> <span className="font-mono text-xs text-muted-foreground">{x.invoice_no}</span><br /><span className="text-xs">{x.due_date < todayLocal() ? `Lewat sejak ${x.due_date}` : "Jatuh tempo hari ini"}</span></span>
                <span className="font-semibold text-orange-900">{rupiah(x.remaining)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d && d.expiring.length > 0 && (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-5" data-testid="expiring-card">
          <h3 className="flex items-center gap-2 font-semibold text-rose-900"><CalendarClock className="size-4" /> SEGERA KEDALUWARSA ({d.expiring.length})</h3>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3" data-testid="expiring-list">
            {d.expiring.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2" data-testid={`expiring-${x.sku}`}>
                <span><b>{x.product_name}</b> <span className="text-xs text-muted-foreground">stok {num(x.stock)} {x.unit}</span><br />
                  <span className="text-xs">{x.expiry_date} · {x.supplier_name} · {x.invoice_no}</span></span>
                <span className="flex flex-col items-end gap-1">
                  <Badge className={x.days_left < 0 ? "bg-rose-600 text-white" : x.days_left <= 7 ? "bg-orange-500 text-white" : "bg-amber-100 text-amber-900"} data-testid={`expiring-days-${x.sku}`}>
                    {x.days_left < 0 ? `LEWAT ${-x.days_left} hari` : x.days_left === 0 ? "HARI INI" : `${x.days_left} hari lagi`}
                  </Badge>
                  {me?.role === "admin" && <button className="text-xs text-rose-700 hover:underline" onClick={() => dismiss.mutate(x.id)} data-testid={`expiring-dismiss-${x.sku}`}>Sudah ditangani</button>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.id} className={cn("rounded-2xl border p-5 shadow-sm", k.cls)}>
            <div className="flex items-center justify-between text-sm font-medium opacity-80">{k.label}<k.icon className="size-4" /></div>
            <div className="mt-3 font-heading text-2xl font-bold md:text-3xl" data-testid={k.id}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm xl:col-span-2">
          <h3 className="mb-4 text-lg font-semibold">Grafik Penjualan Harian</h3>
          <div className="h-64" data-testid="sales-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d?.chart ?? []}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#15803D" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#15803D" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}rb` : `${v}`)} />
                <Tooltip formatter={(value: number) => rupiah(value)} labelFormatter={(label: string) => `Tanggal ${label}`} />
                <Area type="monotone" dataKey="total" stroke="#15803D" strokeWidth={2} fill="url(#g)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {d && Object.keys(d.payment_breakdown).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2" data-testid="payment-breakdown">
              {Object.entries(d.payment_breakdown).map(([m, v]) => (
                <Badge key={m} variant="secondary">{PAYMENT_LABELS[m] ?? m}: {rupiah(v)}</Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
            <h3 className="flex items-center gap-2 font-semibold text-rose-900"><PackageX className="size-4" /> STOK HABIS ({d?.out_of_stock.length ?? 0})</h3>
            <ul className="mt-3 space-y-1 text-sm" data-testid="out-of-stock-list">
              {d?.out_of_stock.map((p) => <li key={p.id} className="flex justify-between"><span>{p.name}</span><span className="font-mono">0 {p.unit}</span></li>)}
              {d && d.out_of_stock.length === 0 && <li className="text-rose-700/70">Tidak ada</li>}
            </ul>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h3 className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="size-4" /> STOK MENIPIS ({d?.low_stock.length ?? 0})</h3>
            <ul className="mt-3 space-y-1 text-sm" data-testid="low-stock-list">
              {d?.low_stock.map((p) => <li key={p.id} className="flex justify-between"><span>{p.name}</span><span className="font-mono">{num(p.stock)} / min {num(p.min_stock)}</span></li>)}
              {d && d.low_stock.length === 0 && <li className="text-amber-800/70">Tidak ada</li>}
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Transaksi Terbaru</h3>
          <Link to="/sales" className="text-sm font-medium text-primary hover:underline" data-testid="see-all-sales-link">Lihat semua</Link>
        </div>
        <div className="divide-y" data-testid="recent-sales-list">
          {d?.recent_sales.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <div className="font-mono font-medium">{s.invoice_no}</div>
                <div className="text-xs text-muted-foreground">{fmtDateTime(s.created_at)} · {s.cashier_name}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{rupiah(s.total)}</div>
                {s.status === "void" ? <Badge variant="destructive">VOID</Badge> : <span className="text-xs text-muted-foreground">{PAYMENT_LABELS[s.payment_method]}</span>}
              </div>
            </div>
          ))}
          {(!d || d.recent_sales.length === 0) && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada transaksi</p>}
        </div>
      </div>
    </div>
  );
}
