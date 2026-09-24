import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, History, Truck } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Purchase, Supplier, SupplierIn } from "@/lib/types";
import { errMsg, num, rupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ExportButtons from "@/components/ExportButtons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EMPTY: SupplierIn = { name: "", contact_name: "", phone: "", address: "", note: "" };

export default function Suppliers() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierIn | null>(null);
  const [history, setHistory] = useState<Supplier | null>(null);
  const { data: sups = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => apiGet<Supplier[]>("/v1/suppliers") });
  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases", "supplier", history?.id],
    queryFn: () => apiGet<Purchase[]>(`/v1/purchases?supplier_id=${history!.id}`),
    enabled: !!history,
  });

  const done = (msg: string) => { toast.success(msg); setForm(null); qc.invalidateQueries({ queryKey: ["suppliers"] }); };
  const save = useMutation({
    mutationFn: (b: SupplierIn) => (editing ? apiPut<Supplier>(`/v1/suppliers/${editing.id}`, b) : apiPost<Supplier>("/v1/suppliers", b)),
    onSuccess: (s) => done(`Supplier ${s.name} disimpan`),
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/suppliers/${id}`),
    onSuccess: () => done("Supplier dihapus"),
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Supplier</h1>
          <p className="text-sm text-muted-foreground">{sups.length} supplier</p>
        </div>
        <div className="flex gap-2"><ExportButtons entity="suppliers" />
        <Button onClick={() => { setEditing(null); setForm({ ...EMPTY }); }} data-testid="add-supplier-button"><Plus /> Tambah Supplier</Button></div>
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead><TableHead>Kontak</TableHead><TableHead>Alamat</TableHead>
              <TableHead className="text-right">Pembelian</TableHead><TableHead className="text-right">Total</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sups.map((s) => (
              <TableRow key={s.id} data-testid={`supplier-row-${s.name}`}>
                <TableCell><div className="flex items-center gap-2 font-semibold"><Truck className="size-4 text-green-700" />{s.name}</div>{s.note && <div className="text-xs text-muted-foreground">{s.note}</div>}</TableCell>
                <TableCell>{s.contact_name || "-"}<div className="text-xs text-muted-foreground">{s.phone}</div></TableCell>
                <TableCell className="max-w-56 truncate">{s.address || "-"}</TableCell>
                <TableCell className="text-right">{num(s.purchase_count)}x</TableCell>
                <TableCell className="text-right font-semibold" data-testid={`supplier-total-${s.name}`}>{rupiah(s.purchase_total)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" title="Riwayat pembelian" onClick={() => setHistory(s)} data-testid={`supplier-history-${s.name}`}><History /></Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => { setEditing(s); setForm({ name: s.name, contact_name: s.contact_name, phone: s.phone, address: s.address, note: s.note }); }} data-testid={`supplier-edit-${s.name}`}><Pencil /></Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => confirm(`Hapus supplier ${s.name}?`) && del.mutate(s.id)} data-testid={`supplier-delete-${s.name}`}><Trash2 className="text-rose-600" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sups.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Belum ada supplier</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Supplier" : "Tambah Supplier"}</DialogTitle></DialogHeader>
          {form && (
            <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <div className="col-span-2 space-y-1"><Label>Nama supplier</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="supplier-name-input" /></div>
              <div className="space-y-1"><Label>Nama kontak</Label><Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} data-testid="supplier-contact-input" /></div>
              <div className="space-y-1"><Label>Telepon</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="supplier-phone-input" /></div>
              <div className="col-span-2 space-y-1"><Label>Alamat</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="supplier-address-input" /></div>
              <div className="col-span-2 space-y-1"><Label>Catatan</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="supplier-note-input" /></div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={save.isPending} data-testid="supplier-save-button">Simpan</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Riwayat Pembelian — {history?.name}</DialogTitle></DialogHeader>
          <div className="max-h-96 divide-y overflow-y-auto" data-testid="supplier-history-list">
            {purchases.map((p) => (
              <div key={p.id} className="py-2.5 text-sm">
                <div className="flex justify-between"><span className="font-mono font-medium">{p.invoice_no}</span><span className="font-semibold">{rupiah(p.total)}</span></div>
                <div className="text-xs text-muted-foreground">{p.date} · {p.items.map((i) => `${i.name} x${num(i.qty)}`).join(", ")}</div>
              </div>
            ))}
            {purchases.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada pembelian</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
