import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Printer, ShoppingBasket } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/lib/api";
import type { DailyReport, RestockGroup, Settings } from "@/lib/types";
import { num, PAYMENT_LABELS, rupiah } from "@/lib/format";
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
  ];
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
            <Button size="sm" variant="outline" onClick={() => printGroup(g)} data-testid={`restock-print-${g.supplier}`}><Printer /> Cetak</Button>
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
          <TabsTrigger value="restock" data-testid="reports-tab-restock">Saran Belanja</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="mt-4"><DailyTab settings={settings} /></TabsContent>
        <TabsContent value="restock" className="mt-4"><RestockTab settings={settings} /></TabsContent>
      </Tabs>
    </div>
  );
}
