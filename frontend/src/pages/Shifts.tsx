import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, Wallet, Printer } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import type { Settings, Shift } from "@/lib/types";
import { errMsg, fmtDateTime, PAYMENT_LABELS, rupiah } from "@/lib/format";
import { printHtml, receiptCss } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function Row({ label, value, bold, testId }: { label: string; value: string; bold?: boolean; testId?: string }) {
  return (
    <div className={cn("flex justify-between py-1.5", bold && "font-bold")}>
      <span>{label}</span><span data-testid={testId}>{value}</span>
    </div>
  );
}

function shiftLines(s: Shift) {
  const sum = s.summary;
  if (!sum) return [];
  return [
    ["Modal awal", rupiah(s.opening_cash)],
    ...["cash", "qris", "transfer", "debit", "kredit", "ewallet"].filter((m) => m === "cash" || m === "qris" || m === "transfer" || sum.by_payment[m]).map((m) => [`Total ${PAYMENT_LABELS[m]}`, rupiah(sum.by_payment[m] ?? 0)]),
    ["Total penjualan", rupiah(sum.total_sales)],
    ["Pengeluaran", rupiah(sum.expenses_total)],
    ...(sum.refunds_cash ? [["Refund retur (cash)", rupiah(sum.refunds_cash)]] : []),
    ["Cash seharusnya", rupiah(sum.expected_cash)],
  ];
}

function printShift(s: Shift, st: Settings) {
  const lines = [...shiftLines(s), ["Cash aktual", rupiah(s.actual_cash ?? 0)], ["Selisih", rupiah(s.difference ?? 0)]];
  const body = `<div class="c b big">${st.store_name}</div><div class="c b">LAPORAN SHIFT</div><div class="hr"></div>
<div class="r"><span>Kasir</span><span>${s.cashier_name}</span></div><div class="r"><span>Buka</span><span>${fmtDateTime(s.opened_at)}</span></div>
<div class="r"><span>Tutup</span><span>${s.closed_at ? fmtDateTime(s.closed_at) : "-"}</span></div><div class="hr"></div>
${lines.map(([l, v]) => `<div class="r"><span>${l}</span><span>${v}</span></div>`).join("")}<div class="hr"></div>`;
  printHtml(body, receiptCss(st.paper_size));
}

export default function Shifts() {
  const qc = useQueryClient();
  const [opening, setOpening] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expNote, setExpNote] = useState("");
  const [actual, setActual] = useState("");
  const [closed, setClosed] = useState<Shift | null>(null);
  const { data: current, isLoading } = useQuery({ queryKey: ["shift", "current"], queryFn: () => apiGet<Shift | null>("/v1/shifts/current"), refetchOnMount: "always" });
  const { data: history = [] } = useQuery({ queryKey: ["shift", "list"], queryFn: () => apiGet<Shift[]>("/v1/shifts"), refetchOnMount: "always" });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/v1/settings") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["shift"] });

  const openM = useMutation({
    mutationFn: () => apiPost<Shift>("/v1/shifts/open", { opening_cash: Number(opening) || 0 }),
    onSuccess: () => { toast.success("Shift dibuka"); setOpening(""); setClosed(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const expM = useMutation({
    mutationFn: () => apiPost<Shift>("/v1/shifts/current/expenses", { amount: Number(expAmount), note: expNote }),
    onSuccess: () => { toast.success("Pengeluaran dicatat"); setExpAmount(""); setExpNote(""); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const closeM = useMutation({
    mutationFn: () => apiPost<Shift>("/v1/shifts/close", { actual_cash: Number(actual) || 0, note: "" }),
    onSuccess: (s) => { toast.success("Shift ditutup"); setActual(""); setClosed(s); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const diffPreview = current?.summary && actual !== "" ? Number(actual) - current.summary.expected_cash : null;

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Shift Kasir</h1>
        <p className="text-sm text-muted-foreground">Buka shift dengan modal awal, tutup shift untuk hitung selisih kas</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {!isLoading && !current && (
          <div className="rounded-2xl border bg-white p-6 shadow-sm" data-testid="shift-open-card">
            <h3 className="flex items-center gap-2 text-lg font-semibold"><LogIn className="size-5 text-green-700" /> BUKA SHIFT</h3>
            <div className="mt-4 space-y-2">
              <Label>Modal awal (uang di laci)</Label>
              <Input type="number" min={0} value={opening} onChange={(e) => setOpening(e.target.value)} className="h-11 text-lg" data-testid="shift-opening-input" />
              <Button className="mt-2 h-11 w-full" onClick={() => openM.mutate()} disabled={openM.isPending} data-testid="shift-open-button">Buka Shift</Button>
            </div>
          </div>
        )}

        {current?.summary && (
          <>
            <div className="rounded-2xl border bg-white p-6 shadow-sm" data-testid="shift-current-card">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold"><Clock className="size-5 text-green-700" /> Shift Aktif</h3>
                <Badge className="bg-green-100 text-green-800">Sejak {fmtDateTime(current.opened_at)}</Badge>
              </div>
              <div className="mt-3 divide-y text-sm">
                {shiftLines(current).map(([l, v]) => <Row key={l} label={l} value={v} bold={l === "Cash seharusnya"} testId={l === "Cash seharusnya" ? "shift-expected-cash" : undefined} />)}
                <Row label="Jumlah transaksi" value={String(current.summary.transaction_count)} testId="shift-trx-count" />
              </div>
              <div className="mt-4 rounded-xl bg-muted/60 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" /> Catat pengeluaran dari laci</div>
                <div className="flex gap-2">
                  <Input type="number" placeholder="Nominal" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} className="w-32" data-testid="shift-expense-amount-input" />
                  <Input placeholder="Keterangan (plastik, transport…)" value={expNote} onChange={(e) => setExpNote(e.target.value)} data-testid="shift-expense-note-input" />
                  <Button variant="outline" onClick={() => expM.mutate()} disabled={!Number(expAmount) || !expNote.trim()} data-testid="shift-expense-add-button">Catat</Button>
                </div>
                {current.expenses.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {current.expenses.map((e, i) => <li key={i}>{e.note}: {rupiah(e.amount)}</li>)}
                  </ul>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6" data-testid="shift-close-card">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-amber-900"><LogOut className="size-5" /> TUTUP SHIFT</h3>
              <div className="mt-4 space-y-2">
                <Label>Cash aktual (hitung uang di laci)</Label>
                <Input type="number" min={0} value={actual} onChange={(e) => setActual(e.target.value)} className="h-11 bg-white text-lg" data-testid="shift-actual-input" />
                {diffPreview !== null && (
                  <p className={cn("text-sm font-semibold", diffPreview === 0 ? "text-green-700" : diffPreview > 0 ? "text-sky-700" : "text-rose-700")} data-testid="shift-diff-preview">
                    Selisih: {rupiah(diffPreview)} {diffPreview === 0 ? "(pas)" : diffPreview > 0 ? "(lebih)" : "(kurang)"}
                  </p>
                )}
                <Button className="mt-2 h-11 w-full" variant="destructive" onClick={() => closeM.mutate()} disabled={actual === "" || closeM.isPending} data-testid="shift-close-button">Tutup Shift</Button>
              </div>
            </div>
          </>
        )}

        {closed && (
          <div className="rounded-2xl border bg-white p-6 shadow-sm" data-testid="shift-closed-report">
            <h3 className="text-lg font-semibold">Laporan Shift Tersimpan</h3>
            <div className="mt-3 divide-y text-sm">
              {shiftLines(closed).map(([l, v]) => <Row key={l} label={l} value={v} />)}
              <Row label="Cash aktual" value={rupiah(closed.actual_cash ?? 0)} />
              <Row label="Selisih" value={rupiah(closed.difference ?? 0)} bold testId="shift-closed-difference" />
            </div>
            {settings && <Button variant="outline" className="mt-3" onClick={() => printShift(closed, settings)} data-testid="shift-print-button"><Printer /> Cetak Laporan Shift</Button>}
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b px-5 py-3 font-semibold">Riwayat Shift</div>
        <Table>
          <TableHeader><TableRow><TableHead>Kasir</TableHead><TableHead>Buka</TableHead><TableHead>Tutup</TableHead><TableHead className="text-right">Penjualan</TableHead><TableHead className="text-right">Cash seharusnya</TableHead><TableHead className="text-right">Aktual</TableHead><TableHead className="text-right">Selisih</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {history.map((s) => (
              <TableRow key={s.id} data-testid={`shift-row-${s.id}`}>
                <TableCell>{s.cashier_name}</TableCell>
                <TableCell>{fmtDateTime(s.opened_at)}</TableCell>
                <TableCell>{s.closed_at ? fmtDateTime(s.closed_at) : <Badge className="bg-green-100 text-green-800">Aktif</Badge>}</TableCell>
                <TableCell className="text-right">{s.summary ? rupiah(s.summary.total_sales) : "-"}</TableCell>
                <TableCell className="text-right">{s.summary && s.status === "closed" ? rupiah(s.summary.expected_cash) : "-"}</TableCell>
                <TableCell className="text-right">{s.actual_cash != null ? rupiah(s.actual_cash) : "-"}</TableCell>
                <TableCell className={cn("text-right font-semibold", (s.difference ?? 0) < 0 && "text-rose-700")}>{s.difference != null ? rupiah(s.difference) : "-"}</TableCell>
                <TableCell>{s.status === "closed" && settings && <Button size="icon-sm" variant="ghost" onClick={() => printShift(s, settings)} data-testid={`shift-row-print-${s.id}`}><Printer /></Button>}</TableCell>
              </TableRow>
            ))}
            {history.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada shift</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
