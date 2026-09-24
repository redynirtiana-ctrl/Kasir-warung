import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Printer, ShoppingBasket, MessageCircle, Archive, Moon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, apiPost } from "@/lib/api";
import type { DailyReport, DailyReportSnapshot, MonthlyReport, RestockGroup, Settings } from "@/lib/types";
import { fmtDateTime, num, PAYMENT_LABELS, rupiah, waLink } from "@/lib/format";
import { printHtml } from "@/lib/print";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
const A4_CSS = `@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;font-size:12px;color:#111}h1{font-size:18px;margin:0}h2{font-size:14px;margin:4px 0 12px}
table{border-collapse:collapse;width:100%;margin-top:8px}td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}td.r{text-align:right}th{background:#dcfce7}`;

function reportRows(r: DailyReport): [string, string][] {
  return [
    ["Total transaksi", num(r.transaction_count)],
    ["Produk terjual", num(r.items_sold)],
    ["Omzet", rupiah(r.omzet)],
    ["Diskon", rupiah(r.discount)],
    ["Modal", rupiah(r.modal)],
    ["Estimasi keuntungan", rupiah(r.profit)],
    ...Object.entries(r.by_payment).map(([k, v]) => [PAYMENT_LABELS[k] ?? k, rupiah(v)] as [string, string]),
    ["Transaksi void", num(r.void_count)],
    ["Retur penjualan", rupiah(r.sale_returns_total)],
    ...Object.entries(r.expenses_by_category).map(([k, v]) => [`Pengeluaran: ${k}`, rupiah(v)] as [string, string]),
    ["Total pengeluaran", rupiah(r.expenses_total)],
    ["Laba bersih", rupiah(r.net_profit)],
    ["Hutang baru", rupiah(r.debt_new)],
    ["Cicilan hutang diterima", rupiah(r.debt_collected)],
  ];
}

function dailyWaText(r: DailyReport, store: string): string {
  const pay = Object.entries(r.by_payment).map(([k, v]) => `${PAYMENT_LABELS[k] ?? k}: ${rupiah(v)}`).join("\n");
  return `*LAPORAN PENJUALAN HARIAN*\n${store}\nTanggal: ${longDate(r.date)}\n\nTotal transaksi: ${num(r.transaction_count)}\nProduk terjual: ${num(r.items_sold)}\n\nOmzet: ${rupiah(r.omzet)}\nModal: ${rupiah(r.modal)}\nEstimasi keuntungan: ${rupiah(r.profit)}\nPengeluaran: ${rupiah(r.expenses_total)}\n*Laba bersih: ${rupiah(r.net_profit)}*\n\n${pay}${r.debt_new ? `\n\nHutang baru: ${rupiah(r.debt_new)}` : ""}`;
}

function sendWa(settings: Settings | undefined, text: string) {
  if (!settings?.owner_whatsapp) toast.info("Nomor WhatsApp pemilik belum diisi di Pengaturan — pilih kontak di WhatsApp");
  window.open(waLink(settings?.owner_whatsapp ?? "", text), "_blank");
}

function DailyTab({ settings }: { settings?: Settings }) {
  const [date, setDate] = useState(todayLocal());
  const { data: r } = useQuery({ queryKey: ["reports", "daily", date], queryFn: () => apiGet<DailyReport>(`/v1/reports/daily?date=${date}`), enabled: !!date });

  const print = () => {
    if (!r) return;
    const rows = reportRows(r).map(([l, v]) => `<tr><td>${l}</td><td class="r">${v}</td></tr>`).join("");
    const top = r.top_products.map((p) => `<tr><td>${p.name}</td><td class="r">${num(p.qty)}</td><td class="r">${rupiah(p.omzet)}</td><td class="r">${rupiah(p.profit)}</td></tr>`).join("");
    printHtml(`<h1>${settings?.store_name ?? ""}</h1><h2>LAPORAN PENJUALAN HARIAN — ${longDate(r.date)}</h2><table>${rows}</table>
${top ? `<h2 style="margin-top:18px">Produk Terlaris</h2><table><tr><th>Produk</th><th>Qty</th><th>Omzet</th><th>Keuntungan</th></tr>${top}</table>` : ""}`, A4_CSS);
  };

  const cards = r ? [
    ["Omzet", rupiah(r.omzet), "bg-green-100 text-green-900", "report-omzet"],
    ["Modal", rupiah(r.modal), "bg-white", "report-modal"],
    ["Estimasi Keuntungan", rupiah(r.profit), "bg-amber-100 text-amber-900", "report-profit"],
    ["Transaksi", num(r.transaction_count), "bg-white", "report-trx"],
  ] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" data-testid="report-date-input" />
        <Button variant="outline" onClick={print} disabled={!r} data-testid="report-print-button"><Printer /> Cetak</Button>
        <a className={buttonVariants({ variant: "outline" })} href={`/api/v1/reports/daily.pdf?date=${date}`} data-testid="report-pdf-link"><FileText /> Download PDF</a>
        <a className={buttonVariants({ variant: "outline" })} href={`/api/v1/reports/daily.xlsx?date=${date}`} data-testid="report-excel-link"><FileSpreadsheet /> Download Excel</a>
        <Button className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" disabled={!r} onClick={() => r && sendWa(settings, dailyWaText(r, settings?.store_name ?? ""))} data-testid="report-wa-button"><MessageCircle /> Kirim WhatsApp</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map(([l, v, cls, id]) => (
          <div key={id} className={`rounded-2xl border p-5 shadow-sm ${cls}`}>
            <div className="text-sm font-medium opacity-80">{l}</div>
            <div className="mt-2 font-heading text-2xl font-bold" data-testid={id}>{v}</div>
          </div>
        ))}
      </div>
      {r && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5 shadow-sm" data-testid="report-detail">
            <h3 className="mb-2 font-semibold">LAPORAN PENJUALAN HARIAN · {longDate(r.date)}</h3>
            <div className="divide-y text-sm">
              {reportRows(r).map(([l, v]) => <div key={l} className="flex justify-between py-1.5"><span>{l}</span><span className="font-medium">{v}</span></div>)}
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-semibold">Produk Terlaris</h3>
            {r.top_products.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.top_products} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis type="number" fontSize={12} />
                    <YAxis type="category" dataKey="name" width={130} fontSize={11} />
                    <Tooltip formatter={(value: number) => num(value)} />
                    <Bar dataKey="qty" fill="#15803D" radius={[0, 4, 4, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="py-10 text-center text-sm text-muted-foreground">Belum ada penjualan di tanggal ini</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function RestockTab({ settings }: { settings?: Settings }) {
  const { data: groups = [] } = useQuery({ queryKey: ["reports", "restock"], queryFn: () => apiGet<RestockGroup[]>("/v1/reports/restock") });
  const printGroup = (g: RestockGroup) => {
    const rows = g.items.map((i) => `<tr><td>${i.name}</td><td>${i.sku}</td><td class="r">${num(i.stock)}</td><td class="r">${num(i.suggested_qty)} ${i.unit}</td><td class="r">${rupiah(i.estimated_cost)}</td></tr>`).join("");
    printHtml(`<h1>${settings?.store_name ?? ""}</h1><h2>DAFTAR BELANJA — ${g.supplier} (${longDate(todayLocal())})</h2>
<table><tr><th>Produk</th><th>SKU</th><th>Stok</th><th>Pesan</th><th>Estimasi</th></tr>${rows}<tr><td colspan="4"><b>Total</b></td><td class="r"><b>${rupiah(g.total_cost)}</b></td></tr></table>`, A4_CSS);
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Barang dengan stok ≤ stok minimum, dikelompokkan per supplier. Saran qty = 2× stok minimum − stok sekarang.</p>
      {groups.map((g) => (
        <div key={g.supplier} className="rounded-2xl border bg-white shadow-sm" data-testid={`restock-group-${g.supplier}`}>
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div className="flex items-center gap-2 font-semibold"><ShoppingBasket className="size-4 text-amber-600" /> {g.supplier} <span className="text-sm font-normal text-muted-foreground">· {g.items.length} barang · {rupiah(g.total_cost)}</span></div>
            <div className="flex gap-1">
              <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" onClick={() => sendWa(settings, `*DAFTAR BELANJA — ${g.supplier}*\n${settings?.store_name ?? ""} · ${longDate(todayLocal())}\n\n${g.items.map((i, n) => `${n + 1}. ${i.name} — ${num(i.suggested_qty)} ${i.unit} (stok ${num(i.stock)})`).join("\n")}\n\nEstimasi: ${rupiah(g.total_cost)}`)} data-testid={`restock-wa-${g.supplier}`}><MessageCircle /> WhatsApp</Button>
              <Button size="sm" variant="outline" onClick={() => printGroup(g)} data-testid={`restock-print-${g.supplier}`}><Printer /> Cetak</Button>
            </div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead className="text-right">Stok</TableHead><TableHead className="text-right">Min</TableHead><TableHead className="text-right">Saran pesan</TableHead><TableHead className="text-right">Estimasi biaya</TableHead></TableRow></TableHeader>
            <TableBody>
              {g.items.map((i) => (
                <TableRow key={i.id} data-testid={`restock-item-${i.sku}`}>
                  <TableCell><div className="font-medium">{i.name}</div><div className="font-mono text-xs text-muted-foreground">{i.sku}</div></TableCell>
                  <TableCell className={`text-right font-mono ${i.stock <= 0 ? "text-rose-700" : "text-amber-700"}`}>{num(i.stock)}</TableCell>
                  <TableCell className="text-right font-mono">{num(i.min_stock)}</TableCell>
                  <TableCell className="text-right font-semibold">{num(i.suggested_qty)} {i.unit}</TableCell>
                  <TableCell className="text-right">{rupiah(i.estimated_cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
      {groups.length === 0 && <p className="rounded-2xl border bg-white py-10 text-center text-sm text-muted-foreground">Semua stok aman 👍</p>}
    </div>
  );
}

function MonthlyTab({ settings }: { settings?: Settings }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const { data: r } = useQuery({ queryKey: ["reports", "monthly", month], queryFn: () => apiGet<MonthlyReport>(`/v1/reports/monthly?month=${month}`), enabled: !!month });
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  const print = () => {
    if (!r) return;
    const rows = r.days.filter((d) => d.transactions || d.expenses).map((d) => `<tr><td>${d.date}</td><td class="r">${num(d.transactions)}</td><td class="r">${rupiah(d.omzet)}</td><td class="r">${rupiah(d.modal)}</td><td class="r">${rupiah(d.expenses)}</td><td class="r">${rupiah(d.net)}</td></tr>`).join("");
    printHtml(`<h1>${settings?.store_name ?? ""}</h1><h2>LAPORAN LABA RUGI — ${monthLabel}</h2>
<table><tr><td>Omzet</td><td class="r">${rupiah(r.omzet)}</td></tr><tr><td>Modal (HPP)</td><td class="r">${rupiah(r.modal)}</td></tr><tr><td>Laba kotor</td><td class="r">${rupiah(r.profit)}</td></tr><tr><td>Pengeluaran</td><td class="r">${rupiah(r.expenses)}</td></tr><tr><th>LABA BERSIH</th><th class="r">${rupiah(r.net)}</th></tr></table>
<h2 style="margin-top:18px">Rincian harian</h2><table><tr><th>Tanggal</th><th>Trx</th><th>Omzet</th><th>Modal</th><th>Pengeluaran</th><th>Laba bersih</th></tr>${rows}</table>`, A4_CSS);
  };
  const cards: [string, string, string, string][] = r ? [
    ["Omzet", rupiah(r.omzet), "bg-green-100 text-green-900", "monthly-omzet"],
    ["Laba kotor", rupiah(r.profit), "bg-white", "monthly-profit"],
    ["Pengeluaran", rupiah(r.expenses), "bg-rose-100 text-rose-900", "monthly-expenses"],
    ["Laba bersih", rupiah(r.net), "bg-amber-100 text-amber-900", "monthly-net"],
  ] : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" data-testid="monthly-month-input" />
        <Button variant="outline" onClick={print} disabled={!r} data-testid="monthly-print-button"><Printer /> Cetak</Button>
        <Button className="bg-[#25D366] text-white hover:bg-[#1ebe5b]" disabled={!r} data-testid="monthly-wa-button"
          onClick={() => r && sendWa(settings, `*LAPORAN LABA RUGI*\n${settings?.store_name ?? ""} · ${monthLabel}\n\nTransaksi: ${num(r.transactions)}\nOmzet: ${rupiah(r.omzet)}\nModal: ${rupiah(r.modal)}\nLaba kotor: ${rupiah(r.profit)}\nPengeluaran: ${rupiah(r.expenses)}\n*Laba bersih: ${rupiah(r.net)}*`)}>
          <MessageCircle /> Kirim WhatsApp
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map(([l, v, cls, id]) => (
          <div key={id} className={`rounded-2xl border p-5 shadow-sm ${cls}`}>
            <div className="text-sm font-medium opacity-80">{l}</div>
            <div className="mt-2 font-heading text-2xl font-bold" data-testid={id}>{v}</div>
          </div>
        ))}
      </div>
      {r && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">Omzet, pengeluaran & laba bersih per hari — {monthLabel}</h3>
          <div className="h-80" data-testid="monthly-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={r.days}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(8)} fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}rb` : `${v}`)} />
                <Tooltip formatter={(value: number) => rupiah(value)} labelFormatter={(label: string) => longDate(label)} />
                <Legend />
                <Bar dataKey="omzet" name="Omzet" fill="#15803D" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="expenses" name="Pengeluaran" fill="#E11D48" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line type="monotone" dataKey="net" name="Laba bersih" stroke="#D97706" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function ArchiveTab({ settings }: { settings?: Settings }) {
  const qc = useQueryClient();
  const [view, setView] = useState<DailyReportSnapshot | null>(null);
  const { data: snaps = [] } = useQuery({ queryKey: ["reports", "archive"], queryFn: () => apiGet<DailyReportSnapshot[]>("/v1/reports/archive") });
  const snap = useMutation({
    mutationFn: () => apiPost<DailyReportSnapshot>(`/v1/reports/archive/${todayLocal()}`),
    onSuccess: () => { toast.success("Laporan hari ini disimpan ke arsip"); qc.invalidateQueries({ queryKey: ["reports", "archive"] }); },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <span className="flex items-center gap-2"><Moon className="size-4" /> Laporan harian otomatis tersimpan setiap malam pukul 23:55 WIB.</span>
        <Button size="sm" variant="outline" onClick={() => snap.mutate()} disabled={snap.isPending} data-testid="archive-snapshot-button"><Archive /> Simpan sekarang</Button>
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead className="text-right">Transaksi</TableHead><TableHead className="text-right">Omzet</TableHead><TableHead className="text-right">Laba bersih</TableHead><TableHead>Dibuat</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {snaps.map((x) => (
              <TableRow key={x.date} data-testid={`archive-row-${x.date}`}>
                <TableCell className="font-medium">{longDate(x.date)}</TableCell>
                <TableCell className="text-right">{num(x.report.transaction_count)}</TableCell>
                <TableCell className="text-right">{rupiah(x.report.omzet)}</TableCell>
                <TableCell className="text-right font-semibold">{rupiah(x.report.net_profit)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(x.generated_at)} · {x.source === "cron" ? "otomatis" : "manual"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setView(x)} data-testid={`archive-view-${x.date}`}>Lihat</Button>
                  <Button size="sm" variant="ghost" onClick={() => sendWa(settings, dailyWaText(x.report, settings?.store_name ?? ""))} data-testid={`archive-wa-${x.date}`}><MessageCircle /></Button>
                </TableCell>
              </TableRow>
            ))}
            {snaps.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Belum ada arsip</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {view && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm" data-testid="archive-detail">
          <h3 className="mb-2 font-semibold">LAPORAN PENJUALAN HARIAN · {longDate(view.date)}</h3>
          <div className="divide-y text-sm">{reportRows(view.report).map(([l, v]) => <div key={l} className="flex justify-between py-1.5"><span>{l}</span><span className="font-medium">{v}</span></div>)}</div>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/v1/settings") });
  return (
    <div className="space-y-5 p-4 md:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Laporan</h1>
        <p className="text-sm text-muted-foreground">Laporan harian & saran belanja</p>
      </div>
      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily" data-testid="reports-tab-daily">Laporan Harian</TabsTrigger>
          <TabsTrigger value="monthly" data-testid="reports-tab-monthly">Laba Bulanan</TabsTrigger>
          <TabsTrigger value="restock" data-testid="reports-tab-restock">Saran Belanja</TabsTrigger>
          <TabsTrigger value="archive" data-testid="reports-tab-archive">Arsip Harian</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="mt-4"><DailyTab settings={settings} /></TabsContent>
        <TabsContent value="monthly" className="mt-4"><MonthlyTab settings={settings} /></TabsContent>
        <TabsContent value="restock" className="mt-4"><RestockTab settings={settings} /></TabsContent>
        <TabsContent value="archive" className="mt-4"><ArchiveTab settings={settings} /></TabsContent>
      </Tabs>
    </div>
  );
}
