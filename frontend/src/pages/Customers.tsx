import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, History, HandCoins, MessageCircle } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Customer, CustomerIn, Debt, Sale, Settings } from "@/lib/types";
import { errMsg, fmtDateTime, PAYMENT_LABELS, rupiah, todayLocal, waLink } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const EMPTY: CustomerIn = { name: "", whatsapp: "", address: "", note: "" };

export default function Customers() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerIn | null>(null);
  const [history, setHistory] = useState<Customer | null>(null);
  const [status, setStatus] = useState("open");
  const [paying, setPaying] = useState<Debt | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");

  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => apiGet<Customer[]>("/v1/customers") });
  const { data: debts = [] } = useQuery({ queryKey: ["debts", status], queryFn: () => apiGet<Debt[]>(`/v1/debts?status=${status}`) });
  const { data: sales = [] } = useQuery({ queryKey: ["customers", "sales", history?.id], queryFn: () => apiGet<Sale[]>(`/v1/customers/${history!.id}/sales`), enabled: !!history });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/v1/settings") });
  const custById = new Map(customers.map((c) => [c.id, c]));
  const today = todayLocal();

  const refresh = () => { qc.invalidateQueries({ queryKey: ["customers"] }); qc.invalidateQueries({ queryKey: ["debts"] }); qc.invalidateQueries({ queryKey: ["shift"] }); };
  const save = useMutation({
    mutationFn: (b: CustomerIn) => (editing ? apiPut<Customer>(`/v1/customers/${editing.id}`, b) : apiPost<Customer>("/v1/customers", b)),
    onSuccess: (c) => { toast.success(`Pelanggan ${c.name} disimpan`); setForm(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/customers/${id}`),
    onSuccess: () => { toast.success("Pelanggan dihapus"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const pay = useMutation({
    mutationFn: () => apiPost<Debt>(`/v1/debts/${paying!.id}/payments`, { amount: Number(payAmount), note: payNote }),
    onSuccess: (d) => { toast.success(d.status === "paid" ? `Hutang ${d.invoice_no} LUNAS` : `Cicilan diterima, sisa ${rupiah(d.remaining)}`); setPaying(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const totalOpen = debts.filter((d) => d.status === "open").reduce((a, d) => a + d.remaining, 0);
  const remind = (d: Debt) => {
    const c = custById.get(d.customer_id);
    const text = `Halo ${d.customer_name}, ini pengingat dari ${settings?.store_name ?? "warung"}.\nSisa hutang transaksi ${d.invoice_no}: ${rupiah(d.remaining)}${d.due_date ? `\nJatuh tempo: ${d.due_date}` : ""}.\nTerima kasih 🙏`;
    window.open(waLink(c?.whatsapp ?? "", text), "_blank");
  };

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pelanggan & Hutang</h1>
          <p className="text-sm text-muted-foreground">Total piutang berjalan: <b data-testid="debt-total-open">{rupiah(customers.reduce((a, c) => a + c.debt_remaining, 0))}</b></p>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ ...EMPTY }); }} data-testid="add-customer-button"><Plus /> Tambah Pelanggan</Button>
      </div>
      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers" data-testid="tab-customers">Pelanggan</TabsTrigger>
          <TabsTrigger value="debts" data-testid="tab-debts">Piutang</TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-4">
          <div className="rounded-2xl border bg-white shadow-sm">
            <Table>
              <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>WhatsApp</TableHead><TableHead>Alamat</TableHead><TableHead className="text-right">Transaksi</TableHead><TableHead className="text-right">Sisa hutang</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id} data-testid={`customer-row-${c.name}`}>
                    <TableCell className="font-semibold">{c.name}{c.note && <div className="text-xs font-normal text-muted-foreground">{c.note}</div>}</TableCell>
                    <TableCell className="font-mono text-sm">{c.whatsapp || "-"}</TableCell>
                    <TableCell className="max-w-48 truncate">{c.address || "-"}</TableCell>
                    <TableCell className="text-right">{c.transaction_count}</TableCell>
                    <TableCell className={cn("text-right font-semibold", c.debt_remaining > 0 && "text-amber-700")} data-testid={`customer-debt-${c.name}`}>{rupiah(c.debt_remaining)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon-sm" variant="ghost" onClick={() => setHistory(c)} data-testid={`customer-history-${c.name}`}><History /></Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => { setEditing(c); setForm({ name: c.name, whatsapp: c.whatsapp, address: c.address, note: c.note }); }} data-testid={`customer-edit-${c.name}`}><Pencil /></Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => confirm(`Hapus ${c.name}?`) && del.mutate(c.id)} data-testid={`customer-delete-${c.name}`}><Trash2 className="text-rose-600" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {customers.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Belum ada pelanggan</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="debts" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border bg-white px-2 text-sm" data-testid="debt-status-filter">
              <option value="open">Belum lunas</option><option value="paid">Lunas</option><option value="">Semua</option>
            </select>
            {status === "open" && <Badge className="h-8 bg-amber-100 px-3 text-amber-900">Sisa {rupiah(totalOpen)}</Badge>}
          </div>
          <div className="rounded-2xl border bg-white shadow-sm">
            <Table>
              <TableHeader><TableRow><TableHead>Pelanggan</TableHead><TableHead>Transaksi</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Dibayar</TableHead><TableHead className="text-right">Sisa</TableHead><TableHead>Jatuh tempo</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {debts.map((d) => {
                  const overdue = d.status === "open" && d.due_date && d.due_date < today;
                  return (
                    <TableRow key={d.id} data-testid={`debt-row-${d.invoice_no}`}>
                      <TableCell className="font-semibold">{d.customer_name}</TableCell>
                      <TableCell className="font-mono text-sm">{d.invoice_no}</TableCell>
                      <TableCell className="text-right">{rupiah(d.total)}</TableCell>
                      <TableCell className="text-right">{rupiah(d.paid)}</TableCell>
                      <TableCell className="text-right font-semibold" data-testid={`debt-remaining-${d.invoice_no}`}>{d.status === "paid" ? <Badge className="bg-green-100 text-green-800">LUNAS</Badge> : rupiah(d.remaining)}</TableCell>
                      <TableCell>{d.due_date ?? "-"} {overdue && <Badge variant="destructive">Lewat</Badge>}</TableCell>
                      <TableCell className="text-right">
                        {d.status === "open" && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => remind(d)} data-testid={`debt-remind-${d.invoice_no}`}><MessageCircle /> Ingatkan</Button>
                            <Button size="sm" onClick={() => { setPaying(d); setPayAmount(String(d.remaining)); setPayNote(""); }} data-testid={`debt-pay-${d.invoice_no}`}><HandCoins /> Bayar</Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {debts.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Tidak ada data</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Pelanggan" : "Tambah Pelanggan"}</DialogTitle></DialogHeader>
          {form && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <div className="space-y-1"><Label>Nama</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="customer-name-input" /></div>
              <div className="space-y-1"><Label>Nomor WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} data-testid="customer-wa-input" /></div>
              <div className="space-y-1"><Label>Alamat</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="customer-address-input" /></div>
              <div className="space-y-1"><Label>Catatan</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="customer-note-input" /></div>
              <DialogFooter><Button type="submit" disabled={save.isPending} data-testid="customer-save-button">Simpan</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Bayar Hutang — {paying?.customer_name}</DialogTitle></DialogHeader>
          {paying && (
            <div className="space-y-3">
              <p className="text-sm">Transaksi {paying.invoice_no} · sisa <b>{rupiah(paying.remaining)}</b></p>
              {paying.payments.length > 0 && (
                <ul className="rounded-lg bg-muted/60 p-2 text-xs">{paying.payments.map((p, i) => <li key={i}>{fmtDateTime(p.created_at)} · {rupiah(p.amount)} · {p.username}</li>)}</ul>
              )}
              <Input type="number" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} data-testid="debt-pay-amount-input" />
              <Input placeholder="Catatan (opsional)" value={payNote} onChange={(e) => setPayNote(e.target.value)} data-testid="debt-pay-note-input" />
              <DialogFooter><Button onClick={() => pay.mutate()} disabled={!Number(payAmount) || pay.isPending} data-testid="debt-pay-submit-button">Simpan Pembayaran</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Riwayat Transaksi — {history?.name}</DialogTitle></DialogHeader>
          <div className="max-h-96 divide-y overflow-y-auto" data-testid="customer-history-list">
            {sales.map((s) => (
              <div key={s.id} className="flex justify-between py-2 text-sm">
                <div><div className="font-mono">{s.invoice_no}</div><div className="text-xs text-muted-foreground">{fmtDateTime(s.created_at)} · {PAYMENT_LABELS[s.payment_method] ?? s.payment_method}</div></div>
                <div className="text-right font-semibold">{rupiah(s.total)}{s.status === "void" && <Badge variant="destructive" className="ml-1">VOID</Badge>}</div>
              </div>
            ))}
            {sales.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada transaksi</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
