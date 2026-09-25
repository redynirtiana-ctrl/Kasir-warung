import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { can } from "@/lib/types";
import type { User } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, History, HandCoins, MessageCircle, IdCard, BellRing, Send, Cake } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Customer, CustomerIn, Debt, DueDebtGroup, Sale, Settings, WaReceiptResult } from "@/lib/types";
import { errMsg, fmtDateTime, PAYMENT_LABELS, rupiah, todayLocal, waLink } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ExportButtons from "@/components/ExportButtons";
import { printMemberCards } from "@/lib/print";
import { cn } from "@/lib/utils";

const EMPTY: CustomerIn = { name: "", whatsapp: "", address: "", note: "", birthday: "" };
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const fmtBirthday = (b: string) => (b ? `${Number(b.slice(3))} ${MONTHS[Number(b.slice(0, 2)) - 1]}` : "");

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
  const me = useOutletContext<User>();
  const { data: debts = [] } = useQuery({ queryKey: ["debts", status], queryFn: () => apiGet<Debt[]>(`/v1/debts?status=${status}`), enabled: can(me, "receive_debt_payment") });
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

  const { data: dueToday = [] } = useQuery({ queryKey: ["debts", "due-today"], queryFn: () => apiGet<DueDebtGroup[]>("/v1/debts/due-today"), enabled: can(me, "receive_debt_payment") });
  const [sentIds, setSentIds] = useState<string[]>([]);
  const reminder = useMutation({
    mutationFn: (g: DueDebtGroup) => apiPost<WaReceiptResult>(`/v1/customers/${g.customer_id}/debt-reminder`, { phone: g.whatsapp }),
    onSuccess: (r, g) => {
      setSentIds((s) => [...s, g.customer_id]);
      if (r.sent) toast.success(`Pengingat terkirim ke ${g.customer_name}`);
      else { toast.warning(`${r.reason}. Membuka WhatsApp…`); window.open(r.wa_link, "_blank", "noopener"); }
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const { data: birthdays = [] } = useQuery({ queryKey: ["customers", "birthdays-today"], queryFn: () => apiGet<Customer[]>("/v1/customers/birthdays-today") });
  const thisYear = new Date().getFullYear();
  const greet = useMutation({
    mutationFn: (c: Customer) => apiPost<WaReceiptResult>(`/v1/customers/${c.id}/birthday-greeting`, { phone: c.whatsapp }),
    onSuccess: (r, c) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      if (r.sent) toast.success(`Ucapan ulang tahun terkirim ke ${c.name}`);
      else { toast.warning(`${r.reason}. Membuka WhatsApp…`); window.open(r.wa_link, "_blank", "noopener"); }
    },
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
        <div className="flex gap-2"><ExportButtons entity="customers" />
        <Button variant="outline" size="sm" disabled={!customers.length || !settings} onClick={() => settings && printMemberCards(customers, settings)} data-testid="print-all-cards-button"><IdCard /> Cetak semua kartu</Button>
        <Button onClick={() => { setEditing(null); setForm({ ...EMPTY }); }} data-testid="add-customer-button"><Plus /> Tambah Pelanggan</Button></div>
      </div>
      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers" data-testid="tab-customers">Pelanggan</TabsTrigger>
          <TabsTrigger value="debts" data-testid="tab-debts">Piutang</TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-4 space-y-3">
          {birthdays.length > 0 && (
            <div className="rounded-2xl border border-pink-200 bg-pink-50/70 p-4 shadow-sm" data-testid="birthday-panel">
              <div className="mb-2 flex items-center gap-2">
                <Cake className="size-5 text-pink-600" />
                <h3 className="font-semibold text-pink-900">Ulang tahun hari ini ({birthdays.length} member)</h3>
              </div>
              <div className="divide-y divide-pink-200/70">
                {birthdays.map((c) => {
                  const greeted = c.birthday_greeted_year === thisYear;
                  return (
                    <div key={c.id} className="flex flex-wrap items-center gap-3 py-2" data-testid={`birthday-row-${c.name}`}>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{c.name} {greeted && <Badge className="ml-1 bg-emerald-100 text-emerald-800" data-testid={`birthday-greeted-${c.name}`}>Sudah diucapkan</Badge>}</div>
                        <div className="text-xs text-muted-foreground">{c.member_code} · {c.whatsapp || "tanpa nomor WA"}</div>
                      </div>
                      <Button size="sm" className="bg-pink-600 hover:bg-pink-700" disabled={!c.whatsapp || (greet.isPending && greet.variables?.id === c.id)}
                        onClick={() => greet.mutate(c)} data-testid={`birthday-greet-${c.name}`}>
                        <Send /> {greeted ? "Kirim Ulang" : "Kirim Ucapan"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="rounded-2xl border bg-white shadow-sm">
            <Table>
              <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Kode member</TableHead><TableHead>WhatsApp</TableHead><TableHead>Alamat</TableHead><TableHead className="text-right">Transaksi</TableHead><TableHead className="text-right">Poin</TableHead><TableHead className="text-right">Sisa hutang</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id} data-testid={`customer-row-${c.name}`}>
                    <TableCell className="font-semibold">{c.name}{c.birthday && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-normal text-pink-700" data-testid={`customer-birthday-${c.name}`}><Cake className="size-3" />{fmtBirthday(c.birthday)}</span>}{c.note && <div className="text-xs font-normal text-muted-foreground">{c.note}</div>}</TableCell>
                    <TableCell className="font-mono text-xs" data-testid={`customer-code-${c.name}`}>{c.member_code}</TableCell>
                    <TableCell className="font-mono text-sm">{c.whatsapp || "-"}</TableCell>
                    <TableCell className="max-w-48 truncate">{c.address || "-"}</TableCell>
                    <TableCell className="text-right">{c.transaction_count}</TableCell>
                    <TableCell className="text-right"><Badge className="bg-violet-100 text-violet-800" data-testid={`customer-points-${c.name}`}>{c.points ?? 0} poin</Badge></TableCell>
                    <TableCell className={cn("text-right font-semibold", c.debt_remaining > 0 && "text-amber-700")} data-testid={`customer-debt-${c.name}`}>{rupiah(c.debt_remaining)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon-sm" variant="ghost" title="Cetak kartu member" onClick={() => settings && printMemberCards([c], settings)} data-testid={`customer-card-${c.name}`}><IdCard /></Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => setHistory(c)} data-testid={`customer-history-${c.name}`}><History /></Button>
                        {me.role === "admin" && <><Button size="icon-sm" variant="ghost" onClick={() => { setEditing(c); setForm({ name: c.name, whatsapp: c.whatsapp, address: c.address, note: c.note, birthday: c.birthday ?? "" }); }} data-testid={`customer-edit-${c.name}`}><Pencil /></Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => confirm(`Hapus ${c.name}?`) && del.mutate(c.id)} data-testid={`customer-delete-${c.name}`}><Trash2 className="text-rose-600" /></Button></>}
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
          {dueToday.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm" data-testid="due-today-panel">
              <div className="mb-3 flex items-center gap-2">
                <BellRing className="size-5 text-amber-700" />
                <h3 className="font-semibold text-amber-900">Jatuh tempo hari ini ({dueToday.length} pelanggan)</h3>
                <span className="ml-auto text-sm font-semibold text-amber-900" data-testid="due-today-total">{rupiah(dueToday.reduce((a, g) => a + g.total_remaining, 0))}</span>
              </div>
              <div className="divide-y divide-amber-200/70">
                {dueToday.map((g) => (
                  <div key={g.customer_id} className="flex flex-wrap items-center gap-3 py-2" data-testid={`due-today-row-${g.customer_name}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{g.customer_name} {g.overdue && <Badge className="ml-1 bg-rose-100 text-rose-800">LEWAT TEMPO</Badge>}</div>
                      <div className="text-xs text-muted-foreground">{g.invoices.join(", ")} · {g.whatsapp || "tanpa nomor WA"}</div>
                    </div>
                    <div className="font-semibold text-amber-900" data-testid={`due-today-amount-${g.customer_name}`}>{rupiah(g.total_remaining)}</div>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={!g.whatsapp || (reminder.isPending && reminder.variables?.customer_id === g.customer_id)}
                      onClick={() => reminder.mutate(g)} data-testid={`due-today-remind-${g.customer_name}`}>
                      <Send /> {sentIds.includes(g.customer_id) ? "Kirim Ulang" : "Kirim Pengingat"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
              <div className="space-y-1">
                <Label>Tanggal lahir (opsional)</Label>
                <div className="flex gap-2">
                  <select value={form.birthday.slice(3)} onChange={(e) => { const d = e.target.value; const m = form.birthday.slice(0, 2) || "01"; setForm({ ...form, birthday: d ? `${m}-${d}` : "" }); }} className="h-9 w-24 rounded-md border bg-white px-2 text-sm" data-testid="customer-birthday-day-select">
                    <option value="">Tgl</option>
                    {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => <option key={d} value={d}>{Number(d)}</option>)}
                  </select>
                  <select value={form.birthday.slice(0, 2)} onChange={(e) => { const m = e.target.value; const d = form.birthday.slice(3) || "01"; setForm({ ...form, birthday: m ? `${m}-${d}` : "" }); }} className="h-9 flex-1 rounded-md border bg-white px-2 text-sm" data-testid="customer-birthday-month-select">
                    <option value="">Bulan</option>
                    {MONTHS.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}
                  </select>
                </div>
              </div>
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
