import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { Printer, Ban, Eye } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import type { Sale, Settings, User } from "@/lib/types";
import { errMsg, fmtDateTime, num, PAYMENT_LABELS, rupiah } from "@/lib/format";
import { printReceipt, receiptHtml } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Sales() {
  const me = useOutletContext<User>();
  const qc = useQueryClient();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const { data: sales = [] } = useQuery({
    queryKey: ["sales", start, end, q],
    queryFn: () => apiGet<Sale[]>(`/v1/sales?start=${start}&end=${end}&q=${encodeURIComponent(q)}`),
  });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/v1/settings") });

  const voidM = useMutation({
    mutationFn: (s: Sale) => apiPost<Sale>(`/v1/sales/${s.id}/void`, { reason: voidReason }),
    onSuccess: (s) => {
      toast.success(`Transaksi ${s.invoice_no} di-void, stok dikembalikan`);
      setView(s);
      setVoidReason("");
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const done = sales.filter((s) => s.status === "completed");
  const omzet = done.reduce((a, s) => a + s.total, 0);

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Penjualan</h1>
        <p className="text-sm text-muted-foreground">Riwayat transaksi & cetak ulang struk</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" data-testid="sales-start-input" />
        <span className="text-muted-foreground">s/d</span>
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" data-testid="sales-end-input" />
        <Input placeholder="Cari nomor transaksi" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" data-testid="sales-search-input" />
        <Badge variant="secondary" className="h-8 px-3" data-testid="sales-count">{done.length} transaksi</Badge>
        <Badge className="h-8 bg-green-100 px-3 text-green-900" data-testid="sales-omzet">Omzet {rupiah(omzet)}</Badge>
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Transaksi</TableHead><TableHead>Waktu</TableHead><TableHead>Kasir</TableHead>
              <TableHead>Metode</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.map((s) => (
              <TableRow key={s.id} data-testid={`sale-row-${s.invoice_no}`}>
                <TableCell className="font-mono font-medium">{s.invoice_no}</TableCell>
                <TableCell>{fmtDateTime(s.created_at)}</TableCell>
                <TableCell>{s.cashier_name}</TableCell>
                <TableCell>{PAYMENT_LABELS[s.payment_method] ?? s.payment_method}</TableCell>
                <TableCell className="text-right font-semibold">{rupiah(s.total)}</TableCell>
                <TableCell>{s.status === "void" ? <Badge variant="destructive">VOID</Badge> : <Badge className="bg-green-100 text-green-800">Selesai</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon-sm" variant="ghost" onClick={() => setView(s)} data-testid={`sale-view-${s.invoice_no}`}><Eye /></Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => settings && printReceipt(s, settings)} data-testid={`sale-print-${s.invoice_no}`}><Printer /></Button>
                </TableCell>
              </TableRow>
            ))}
            {sales.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Belum ada transaksi</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        {view && settings && (
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{view.invoice_no}</DialogTitle></DialogHeader>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-dashed bg-amber-50 p-3 font-mono text-xs [&_.b]:font-bold [&_.c]:text-center [&_.hr]:my-1 [&_.hr]:border-t [&_.hr]:border-dashed [&_.hr]:border-stone-400 [&_.r]:flex [&_.r]:justify-between"
              data-testid="sale-receipt-preview" dangerouslySetInnerHTML={{ __html: receiptHtml(view, settings) }} />
            {view.status === "void" && <p className="text-sm text-rose-700">Alasan void: {view.void_reason}</p>}
            {me.role === "admin" && view.status === "completed" && (
              <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
                <Input placeholder="Alasan void (wajib)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} data-testid="void-reason-input" />
                <Button variant="destructive" className="w-full" disabled={voidReason.trim().length < 3 || voidM.isPending} onClick={() => voidM.mutate(view)} data-testid="void-submit-button">
                  <Ban /> Void Transaksi ({num(view.items.length)} item)
                </Button>
              </div>
            )}
            <DialogFooter><Button onClick={() => printReceipt(view, settings)} data-testid="sale-dialog-print-button"><Printer /> Cetak Ulang</Button></DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
