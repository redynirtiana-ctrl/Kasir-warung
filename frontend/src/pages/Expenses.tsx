import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Expense, ExpenseIn, Settings } from "@/lib/types";
import { errMsg, rupiah, todayLocal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const monthStart = () => todayLocal().slice(0, 8) + "01";

export default function Expenses() {
  const qc = useQueryClient();
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(todayLocal());
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseIn | null>(null);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/v1/settings") });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses", start, end], queryFn: () => apiGet<Expense[]>(`/v1/expenses?start=${start}&end=${end}`) });
  const cats = settings?.expense_categories ?? ["Operasional"];

  const refresh = () => { qc.invalidateQueries({ queryKey: ["expenses"] }); qc.invalidateQueries({ queryKey: ["reports"] }); };
  const save = useMutation({
    mutationFn: (b: ExpenseIn) => (editing ? apiPut<Expense>(`/v1/expenses/${editing.id}`, b) : apiPost<Expense>("/v1/expenses", b)),
    onSuccess: () => { toast.success("Pengeluaran disimpan"); setForm(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/expenses/${id}`),
    onSuccess: () => { toast.success("Pengeluaran dihapus"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const byCat: Record<string, number> = {};
  expenses.forEach((e) => { byCat[e.category] = (byCat[e.category] ?? 0) + e.amount; });
  const total = expenses.reduce((a, e) => a + e.amount, 0);

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pengeluaran Toko</h1>
          <p className="text-sm text-muted-foreground">Masuk ke laporan laba rugi harian</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ category: cats[0], amount: 0, date: todayLocal(), note: "" }); }} data-testid="add-expense-button"><Plus /> Catat Pengeluaran</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" data-testid="expense-start-input" />
        <span className="text-muted-foreground">s/d</span>
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" data-testid="expense-end-input" />
        <Badge className="h-8 bg-rose-100 px-3 text-rose-900" data-testid="expense-total">Total {rupiah(total)}</Badge>
        {Object.entries(byCat).map(([k, v]) => <Badge key={k} variant="secondary" className="h-8 px-3">{k}: {rupiah(v)}</Badge>)}
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Kategori</TableHead><TableHead>Keterangan</TableHead><TableHead>Oleh</TableHead><TableHead className="text-right">Nominal</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {expenses.map((e) => (
              <TableRow key={e.id} data-testid={`expense-row-${e.id}`}>
                <TableCell>{e.date}</TableCell>
                <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                <TableCell>{e.note || "-"}</TableCell>
                <TableCell>{e.username}</TableCell>
                <TableCell className="text-right font-semibold">{rupiah(e.amount)}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon-sm" variant="ghost" onClick={() => { setEditing(e); setForm({ category: e.category, amount: e.amount, date: e.date, note: e.note }); }} data-testid={`expense-edit-${e.id}`}><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => confirm("Hapus pengeluaran ini?") && del.mutate(e.id)} data-testid={`expense-delete-${e.id}`}><Trash2 className="text-rose-600" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {expenses.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Belum ada pengeluaran</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Pengeluaran" : "Catat Pengeluaran"}</DialogTitle></DialogHeader>
          {form && (
            <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <div className="space-y-1">
                <Label>Kategori</Label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-9 w-full rounded-md border bg-white px-2 text-sm" data-testid="expense-category-select">
                  {[...new Set([...cats, form.category])].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label>Tanggal</Label><Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="expense-date-input" /></div>
              <div className="col-span-2 space-y-1"><Label>Nominal</Label><Input type="number" min={1} required value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} data-testid="expense-amount-input" /></div>
              <div className="col-span-2 space-y-1"><Label>Keterangan</Label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="expense-note-input" /></div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={save.isPending} data-testid="expense-save-button">Simpan</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
