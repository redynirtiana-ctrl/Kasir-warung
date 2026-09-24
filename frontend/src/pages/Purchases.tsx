import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Eye, PackagePlus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import type { Product, Purchase, PurchaseIn, Supplier } from "@/lib/types";
import { errMsg, num, rupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export default function Purchases() {
  const qc = useQueryClient();
  const [form, setForm] = useState<PurchaseIn | null>(null);
  const [pick, setPick] = useState("");
  const [view, setView] = useState<Purchase | null>(null);
  const [filterSup, setFilterSup] = useState("");

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases", "list", filterSup],
    queryFn: () => apiGet<Purchase[]>(`/v1/purchases?supplier_id=${filterSup}`),
  });
  const { data: sups = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => apiGet<Supplier[]>("/v1/suppliers") });
  const { data: products = [] } = useQuery({ queryKey: ["products", "list", ""], queryFn: () => apiGet<Product[]>("/v1/products?q=") });
  const byId = new Map(products.map((p) => [p.id, p]));

  const save = useMutation({
    mutationFn: (b: PurchaseIn) => apiPost<Purchase>("/v1/purchases", b),
    onSuccess: (p) => {
      toast.success(`Pembelian ${p.invoice_no} disimpan — stok bertambah`);
      setForm(null);
      ["purchases", "suppliers", "products", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const addItem = (pid: string) => {
    const p = byId.get(pid);
    if (!p || !form) return;
    if (form.items.some((i) => i.product_id === pid)) return toast.info("Produk sudah ada di daftar");
    setForm({ ...form, items: [...form.items, { product_id: pid, qty: 1, buy_price: p.buy_price }] });
    setPick("");
  };
  const setItem = (idx: number, patch: Partial<PurchaseIn["items"][number]>) =>
    setForm((f) => (f ? { ...f, items: f.items.map((i, k) => (k === idx ? { ...i, ...patch } : i)) } : f));
  const total = form?.items.reduce((s, i) => s + i.qty * i.buy_price, 0) ?? 0;

  const submit = () => {
    if (!form) return;
    if (!form.supplier_id) return toast.error("Pilih supplier");
    if (!form.invoice_no.trim()) return toast.error("Isi nomor invoice");
    if (!form.items.length) return toast.error("Tambahkan minimal 1 produk");
    if (form.items.some((i) => i.qty <= 0)) return toast.error("Qty harus lebih dari 0");
    save.mutate(form);
  };

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pembelian Barang</h1>
          <p className="text-sm text-muted-foreground">Catat barang masuk dari supplier — stok otomatis bertambah</p>
        </div>
        <Button onClick={() => { if (!sups.length) toast.info("Tambahkan supplier terlebih dahulu"); setForm({ supplier_id: sups[0]?.id ?? "", invoice_no: "", date: todayLocal(), items: [], note: "", update_buy_price: true }); }} data-testid="add-purchase-button">
          <Plus /> Catat Pembelian
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <select value={filterSup} onChange={(e) => setFilterSup(e.target.value)} className="h-9 rounded-md border bg-white px-2 text-sm" data-testid="purchase-filter-supplier">
          <option value="">Semua supplier</option>
          {sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Badge className="h-8 bg-green-100 px-3 text-green-900" data-testid="purchase-sum">Total {rupiah(purchases.reduce((a, p) => a + p.total, 0))}</Badge>
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Tanggal</TableHead><TableHead>Invoice</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Item</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Oleh</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {purchases.map((p) => (
              <TableRow key={p.id} data-testid={`purchase-row-${p.invoice_no}`}>
                <TableCell>{p.date}</TableCell>
                <TableCell className="font-mono font-medium">{p.invoice_no}</TableCell>
                <TableCell>{p.supplier_name}</TableCell>
                <TableCell className="text-right">{p.items.length}</TableCell>
                <TableCell className="text-right font-semibold">{rupiah(p.total)}</TableCell>
                <TableCell>{p.username}</TableCell>
                <TableCell className="text-right"><Button size="icon-sm" variant="ghost" onClick={() => setView(p)} data-testid={`purchase-view-${p.invoice_no}`}><Eye /></Button></TableCell>
              </TableRow>
            ))}
            {purchases.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Belum ada pembelian</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle><PackagePlus className="mr-2 inline size-5" />Catat Pembelian</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Supplier</Label>
                  <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} className="h-9 w-full rounded-md border bg-white px-2 text-sm" data-testid="purchase-supplier-select">
                    <option value="">- Pilih -</option>
                    {sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><Label>No. invoice</Label><Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} data-testid="purchase-invoice-input" /></div>
                <div className="space-y-1"><Label>Tanggal</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="purchase-date-input" /></div>
              </div>
              <div className="space-y-1">
                <Label>Tambah produk</Label>
                <select value={pick} onChange={(e) => addItem(e.target.value)} className="h-9 w-full rounded-md border bg-white px-2 text-sm" data-testid="purchase-product-select">
                  <option value="">- Pilih produk -</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{`${p.name} (${p.sku}) · stok ${num(p.stock)}`}</option>)}
                </select>
              </div>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-36">Harga beli</TableHead><TableHead className="text-right">Subtotal</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {form.items.map((i, idx) => {
                      const p = byId.get(i.product_id);
                      return (
                        <TableRow key={i.product_id} data-testid={`purchase-item-${p?.sku}`}>
                          <TableCell>{p?.name}<div className="text-xs text-muted-foreground">stok {num(p?.stock ?? 0)} → {num((p?.stock ?? 0) + i.qty)}</div></TableCell>
                          <TableCell><Input type="number" min={0} value={i.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} data-testid={`purchase-qty-${p?.sku}`} /></TableCell>
                          <TableCell><Input type="number" min={0} value={i.buy_price} onChange={(e) => setItem(idx, { buy_price: Number(e.target.value) })} data-testid={`purchase-price-${p?.sku}`} /></TableCell>
                          <TableCell className="text-right">{rupiah(i.qty * i.buy_price)}</TableCell>
                          <TableCell><Button size="icon-sm" variant="ghost" onClick={() => setForm({ ...form, items: form.items.filter((_, k) => k !== idx) })} data-testid={`purchase-remove-${p?.sku}`}><Trash2 className="text-rose-600" /></Button></TableCell>
                        </TableRow>
                      );
                    })}
                    {form.items.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">Belum ada produk</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
              <Input placeholder="Catatan (opsional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="purchase-note-input" />
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.update_buy_price} onCheckedChange={(v) => setForm({ ...form, update_buy_price: Boolean(v) })} data-testid="purchase-update-price-checkbox" /> Perbarui harga beli produk sesuai pembelian ini</label>
              <div className="flex items-center justify-between rounded-xl bg-green-100 px-4 py-3 text-green-900">
                <span className="font-semibold">TOTAL</span><span className="font-heading text-2xl font-bold" data-testid="purchase-total">{rupiah(total)}</span>
              </div>
              <DialogFooter><Button onClick={submit} disabled={save.isPending} data-testid="purchase-save-button">{save.isPending ? "Menyimpan…" : "Simpan Pembelian"}</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        {view && (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{view.invoice_no} · {view.supplier_name}</DialogTitle></DialogHeader>
            <div className="divide-y text-sm" data-testid="purchase-detail">
              {view.items.map((i) => (
                <div key={i.product_id} className="flex justify-between py-2"><span>{i.name} — {num(i.qty)} {i.unit} x {rupiah(i.buy_price)}</span><span className="font-semibold">{rupiah(i.subtotal)}</span></div>
              ))}
              <div className="flex justify-between py-2 font-bold"><span>Total</span><span>{rupiah(view.total)}</span></div>
            </div>
            {view.note && <p className="text-sm text-muted-foreground">Catatan: {view.note}</p>}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
