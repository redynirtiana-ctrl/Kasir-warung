import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Barcode, Printer, Search, PackagePlus, Wand2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Category, Product, ProductIn, StockAdjustIn, User } from "@/lib/types";
import { errMsg, num, rupiah, stockStatus } from "@/lib/format";
import { barcodeSvg, printLabels } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EMPTY: ProductIn = {
  sku: "", barcode: "", name: "", category_id: null, unit: "pcs", buy_price: 0, sell_price: 0,
  stock: 0, min_stock: 0, supplier: "", photo_url: "", active: true,
};

function StatusBadge({ p }: { p: Product }) {
  const st = stockStatus(p.stock, p.min_stock);
  if (st === "habis") return <Badge className="bg-rose-100 text-rose-800">STOK HABIS</Badge>;
  if (st === "menipis") return <Badge className="bg-amber-100 text-amber-800">STOK MENIPIS</Badge>;
  return <Badge className="bg-green-100 text-green-800">Aman</Badge>;
}

export default function Products() {
  const me = useOutletContext<User>();
  const isAdmin = me.role === "admin";
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductIn | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelSize, setLabelSize] = useState({ widthMm: 50, heightMm: 30, copies: 1 });
  const [adjust, setAdjust] = useState<{ product: Product; body: StockAdjustIn } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const nb = params.get("new");
    if (nb !== null && isAdmin) {
      setEditing(null);
      setForm({ ...EMPTY, barcode: nb });
      setParams({}, { replace: true });
    }
  }, [params, setParams, isAdmin]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "list", debounced],
    queryFn: () => apiGet<Product[]>(`/v1/products?q=${encodeURIComponent(debounced)}`),
  });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => apiGet<Category[]>("/v1/categories") });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const save = useMutation({
    mutationFn: (body: ProductIn) => (editing ? apiPut<Product>(`/v1/products/${editing.id}`, body) : apiPost<Product>("/v1/products", body)),
    onSuccess: (p) => {
      toast.success(`Produk ${p.name} disimpan`);
      setForm(null);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/products/${id}`),
    onSuccess: () => { toast.success("Produk dihapus"); invalidate(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const adj = useMutation({
    mutationFn: (body: StockAdjustIn) => apiPost<Product>("/v1/stock/adjustment", body),
    onSuccess: (p) => { toast.success(`Stok ${p.name}: ${num(p.stock)}`); setAdjust(null); invalidate(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const genBarcode = async () => {
    try {
      const { barcode } = await apiGet<{ barcode: string }>("/v1/barcode/generate");
      setForm((f) => (f ? { ...f, barcode } : f));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const selectedProducts = useMemo(() => products.filter((p) => selected.has(p.id)), [products, selected]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const set = <K extends keyof ProductIn>(k: K, v: ProductIn[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Produk & Stok</h1>
          <p className="text-sm text-muted-foreground">{products.length} produk</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!selected.size} onClick={() => setLabelOpen(true)} data-testid="print-labels-button">
              <Printer /> Cetak Label ({selected.size})
            </Button>
            <Button onClick={() => { setEditing(null); setForm({ ...EMPTY }); }} data-testid="add-product-button"><Plus /> Tambah Produk</Button>
          </div>
        )}
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, SKU, barcode, kategori" className="pl-9" data-testid="product-search-input" />
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && <TableHead className="w-8" />}
              <TableHead>Produk</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Harga Beli</TableHead>
              <TableHead className="text-right">Harga Jual</TableHead>
              <TableHead className="text-right">Stok</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead className="text-right">Aksi</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id} className={p.active ? "" : "opacity-50"} data-testid={`product-row-${p.sku}`}>
                {isAdmin && <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} data-testid={`product-select-${p.sku}`} /></TableCell>}
                <TableCell>
                  <div className="font-semibold">{p.name} {!p.active && <Badge variant="outline">Nonaktif</Badge>}</div>
                  <div className="font-mono text-xs text-muted-foreground">{p.sku} · {p.barcode}</div>
                </TableCell>
                <TableCell>{p.category_name ?? "-"}</TableCell>
                <TableCell className="text-right">{rupiah(p.buy_price)}</TableCell>
                <TableCell className="text-right font-semibold">{rupiah(p.sell_price)}</TableCell>
                <TableCell className="text-right font-mono" data-testid={`product-stock-${p.sku}`}>{num(p.stock)} {p.unit}</TableCell>
                <TableCell><StatusBadge p={p} /></TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" title="Stok" onClick={() => setAdjust({ product: p, body: { product_id: p.id, type: "stock_in", qty: 0, note: "" } })} data-testid={`product-adjust-${p.sku}`}><PackagePlus /></Button>
                      <Button size="icon-sm" variant="ghost" title="Edit" onClick={() => { setEditing(p); setForm({ ...p }); }} data-testid={`product-edit-${p.sku}`}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" title="Hapus" onClick={() => confirm(`Hapus ${p.name}?`) && del.mutate(p.id)} data-testid={`product-delete-${p.sku}`}><Trash2 className="text-rose-600" /></Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!isLoading && products.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Belum ada produk</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit Produk" : "Tambah Produk"}</DialogTitle></DialogHeader>
          {form && (
            <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...form, barcode: form.barcode || null }); }} data-testid="product-form">
              <div className="col-span-2 space-y-1"><Label>Nama produk</Label><Input required value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="product-name-input" /></div>
              <div className="space-y-1"><Label>SKU</Label><Input required value={form.sku} onChange={(e) => set("sku", e.target.value)} data-testid="product-sku-input" /></div>
              <div className="space-y-1">
                <Label>Barcode (kosongkan = otomatis)</Label>
                <div className="flex gap-1">
                  <Input value={form.barcode ?? ""} onChange={(e) => set("barcode", e.target.value)} className="font-mono" data-testid="product-barcode-input" />
                  <Button type="button" variant="outline" size="icon" onClick={genBarcode} title="Generate barcode" data-testid="product-generate-barcode-button"><Wand2 /></Button>
                </div>
              </div>
              {form.barcode && (
                <div className="col-span-2 flex justify-center rounded-lg border bg-white p-2" data-testid="product-barcode-preview" dangerouslySetInnerHTML={{ __html: barcodeSvg(form.barcode) }} />
              )}
              <div className="space-y-1">
                <Label>Kategori</Label>
                <select value={form.category_id ?? ""} onChange={(e) => set("category_id", e.target.value || null)} className="h-9 w-full rounded-md border bg-white px-2 text-sm" data-testid="product-category-select">
                  <option value="">- Tanpa kategori -</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label>Satuan</Label><Input value={form.unit} onChange={(e) => set("unit", e.target.value)} data-testid="product-unit-input" /></div>
              <div className="space-y-1"><Label>Harga beli</Label><Input type="number" min={0} value={form.buy_price} onChange={(e) => set("buy_price", Number(e.target.value))} data-testid="product-buy-price-input" /></div>
              <div className="space-y-1"><Label>Harga jual</Label><Input type="number" min={0} value={form.sell_price} onChange={(e) => set("sell_price", Number(e.target.value))} data-testid="product-sell-price-input" /></div>
              <div className="space-y-1"><Label>Stok</Label><Input type="number" min={0} value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} data-testid="product-stock-input" /></div>
              <div className="space-y-1"><Label>Stok minimum</Label><Input type="number" min={0} value={form.min_stock} onChange={(e) => set("min_stock", Number(e.target.value))} data-testid="product-min-stock-input" /></div>
              <div className="space-y-1"><Label>Supplier</Label><Input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} data-testid="product-supplier-input" /></div>
              <div className="space-y-1"><Label>URL foto</Label><Input value={form.photo_url} onChange={(e) => set("photo_url", e.target.value)} data-testid="product-photo-input" /></div>
              <label className="col-span-2 flex items-center gap-2 text-sm"><Checkbox checked={form.active} onCheckedChange={(v) => set("active", Boolean(v))} data-testid="product-active-checkbox" /> Produk aktif</label>
              {form.sell_price < form.buy_price && <p className="col-span-2 text-sm text-amber-700">Harga jual lebih rendah dari harga beli.</p>}
              <DialogFooter className="col-span-2">
                <Button type="submit" disabled={save.isPending} data-testid="product-save-button">{save.isPending ? "Menyimpan…" : "Simpan"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjust} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Penyesuaian Stok — {adjust?.product.name}</DialogTitle></DialogHeader>
          {adjust && (
            <div className="space-y-3">
              <p className="text-sm">Stok saat ini: <b>{num(adjust.product.stock)} {adjust.product.unit}</b></p>
              <select value={adjust.body.type} onChange={(e) => setAdjust({ ...adjust, body: { ...adjust.body, type: e.target.value as StockAdjustIn["type"] } })} className="h-9 w-full rounded-md border px-2 text-sm" data-testid="adjust-type-select">
                <option value="stock_in">Stock In (tambah)</option>
                <option value="stock_out">Stock Out (kurangi)</option>
                <option value="adjustment">Adjustment (set stok menjadi)</option>
              </select>
              <Input type="number" min={0} placeholder="Jumlah" value={adjust.body.qty || ""} onChange={(e) => setAdjust({ ...adjust, body: { ...adjust.body, qty: Number(e.target.value) } })} data-testid="adjust-qty-input" />
              <Input placeholder="Catatan" value={adjust.body.note} onChange={(e) => setAdjust({ ...adjust, body: { ...adjust.body, note: e.target.value } })} data-testid="adjust-note-input" />
              <DialogFooter><Button onClick={() => adj.mutate(adjust.body)} disabled={adj.isPending} data-testid="adjust-save-button">Simpan</Button></DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={labelOpen} onOpenChange={setLabelOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle><Barcode className="mr-2 inline size-5" />Cetak Label Barcode</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1"><Label>Lebar (mm)</Label><Input type="number" value={labelSize.widthMm} onChange={(e) => setLabelSize({ ...labelSize, widthMm: Number(e.target.value) })} data-testid="label-width-input" /></div>
            <div className="space-y-1"><Label>Tinggi (mm)</Label><Input type="number" value={labelSize.heightMm} onChange={(e) => setLabelSize({ ...labelSize, heightMm: Number(e.target.value) })} data-testid="label-height-input" /></div>
            <div className="space-y-1"><Label>Salinan</Label><Input type="number" min={1} value={labelSize.copies} onChange={(e) => setLabelSize({ ...labelSize, copies: Math.max(1, Number(e.target.value)) })} data-testid="label-copies-input" /></div>
          </div>
          <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto" data-testid="label-preview">
            {selectedProducts.map((p) => (
              <div key={p.id} className="flex flex-col items-center rounded border border-dashed p-1 text-center" style={{ width: `${labelSize.widthMm * 3}px` }}>
                <div className="truncate text-[10px] font-bold">{p.name}</div>
                <div className="[&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg(p.barcode ?? "", { height: 30, width: 1.2, fontSize: 10 }) }} />
                <div className="text-xs font-bold">{rupiah(p.sell_price)}</div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => printLabels(selectedProducts.map((product) => ({ product, copies: labelSize.copies })), labelSize)} data-testid="label-print-button"><Printer /> Cetak</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
