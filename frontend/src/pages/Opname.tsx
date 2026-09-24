import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, ScanBarcode, Search, Trash2, History } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import type { Opname as OpnameResult, OpnameIn, Product } from "@/lib/types";
import { errMsg, fmtDateTime, num, rupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STORAGE = "wbc-opname";
type Counts = Record<string, number>; // product_id -> counted qty

function loadCounts(): Counts {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? "{}") as Counts;
  } catch {
    return {};
  }
}

export default function Opname() {
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState<Counts>(loadCounts);
  const [scan, setScan] = useState("");
  const [q, setQ] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<OpnameResult | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  const { data: products = [] } = useQuery({ queryKey: ["products", "all"], queryFn: () => apiGet<Product[]>("/v1/products") });
  const { data: history = [] } = useQuery({ queryKey: ["opname"], queryFn: () => apiGet<OpnameResult[]>("/v1/stock/opname") });
  useEffect(() => localStorage.setItem(STORAGE, JSON.stringify(counts)), [counts]);
  useEffect(() => scanRef.current?.focus(), []);

  const byBarcode = useMemo(() => new Map(products.filter((p) => p.barcode).map((p) => [p.barcode as string, p])), [products]);
  const counted = products.filter((p) => counts[p.id] !== undefined);
  const diffs = counted.filter((p) => counts[p.id] !== p.stock);
  const valueDiff = diffs.reduce((a, p) => a + (counts[p.id] - p.stock) * p.buy_price, 0);

  const onScan = (e: FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (!code) return;
    const p = byBarcode.get(code) ?? products.find((x) => x.sku.toLowerCase() === code.toLowerCase());
    if (!p) return void toast.error(`Barcode ${code} belum terdaftar`);
    setCounts((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }));
    setLastScanned(p.id);
  };

  const commit = useMutation({
    mutationFn: () => apiPost<OpnameResult>("/v1/stock/opname", { items: counted.map((p) => ({ product_id: p.id, counted: counts[p.id] })), note } satisfies OpnameIn),
    onSuccess: (r) => {
      toast.success(`Stok opname tersimpan: ${r.adjusted_count} produk disesuaikan`);
      setResult(r);
      setCounts({});
      setConfirmOpen(false);
      setNote("");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["opname"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const term = q.trim().toLowerCase();
  const rows = products
    .filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (p.barcode ?? "").includes(term))
    .filter((p) => !onlyDiff || (counts[p.id] !== undefined && counts[p.id] !== p.stock))
    .sort((a, b) => (a.id === lastScanned ? -1 : b.id === lastScanned ? 1 : Number(counts[b.id] !== undefined) - Number(counts[a.id] !== undefined)));

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stok Opname</h1>
          <p className="text-sm text-muted-foreground">Scan setiap barang fisik (1 scan = 1 unit) atau ketik jumlahnya, lalu sesuaikan semua selisih sekaligus</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!counted.length} onClick={() => window.confirm("Hapus semua hitungan?") && setCounts({})} data-testid="opname-reset-button"><Trash2 /> Reset hitungan</Button>
          <Button disabled={!counted.length} onClick={() => setConfirmOpen(true)} data-testid="opname-commit-button"><ClipboardCheck /> Sesuaikan Stok ({counted.length})</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <form onSubmit={onScan} className="flex gap-2 md:col-span-2">
          <div className="relative flex-1">
            <ScanBarcode className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-green-700" />
            <Input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan barcode / ketik SKU lalu Enter" className="h-11 pl-10 font-mono" data-testid="opname-scan-input" />
          </div>
          <Button type="submit" className="h-11" data-testid="opname-scan-button">Hitung</Button>
        </form>
        <div className="rounded-xl border bg-white p-3 text-sm"><div className="text-muted-foreground">Dihitung / selisih</div><b data-testid="opname-counted-summary">{counted.length} produk · {diffs.length} selisih</b></div>
        <div className={cn("rounded-xl border p-3 text-sm", valueDiff < 0 ? "bg-rose-50 text-rose-900" : "bg-green-50 text-green-900")}><div className="opacity-80">Selisih nilai (harga beli)</div><b data-testid="opname-value-diff">{rupiah(valueDiff)}</b></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk" className="pl-9" data-testid="opname-search-input" /></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={onlyDiff} onCheckedChange={(v) => setOnlyDiff(Boolean(v))} data-testid="opname-only-diff-checkbox" /> Hanya yang selisih</label>
        <span className="text-xs text-muted-foreground">Produk yang tidak dihitung tidak diubah.</span>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead className="text-right">Stok sistem</TableHead><TableHead className="w-40 text-right">Hitung fisik</TableHead><TableHead className="text-right">Selisih</TableHead><TableHead className="text-right">Nilai selisih</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((p) => {
              const c = counts[p.id];
              const d = c === undefined ? null : c - p.stock;
              return (
                <TableRow key={p.id} className={cn(p.id === lastScanned && "bg-green-50")} data-testid={`opname-row-${p.sku}`}>
                  <TableCell><div className="font-semibold">{p.name}</div><div className="font-mono text-xs text-muted-foreground">{p.sku} · {p.barcode}</div></TableCell>
                  <TableCell className="text-right font-mono">{num(p.stock)} {p.unit}</TableCell>
                  <TableCell className="text-right">
                    <Input type="number" min={0} value={c ?? ""} placeholder="-" className="ml-auto h-8 w-24 text-right"
                      onChange={(e) => setCounts((s) => { const n = { ...s }; if (e.target.value === "") delete n[p.id]; else n[p.id] = Math.max(0, Number(e.target.value)); return n; })}
                      data-testid={`opname-count-${p.sku}`} />
                  </TableCell>
                  <TableCell className={cn("text-right font-semibold", d && d < 0 && "text-rose-700", d && d > 0 && "text-green-700")} data-testid={`opname-diff-${p.sku}`}>{d === null ? "-" : d > 0 ? `+${num(d)}` : num(d)}</TableCell>
                  <TableCell className="text-right text-sm">{d ? rupiah(d * p.buy_price) : "-"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h3 className="mb-2 flex items-center gap-2 font-semibold"><History className="size-4" /> Riwayat opname</h3>
        <div className="divide-y text-sm">
          {history.map((h) => (
            <div key={h.id} className="flex justify-between py-2" data-testid={`opname-history-${h.id}`}>
              <span>{fmtDateTime(h.created_at)} · {h.username} · {h.note}</span>
              <span>{h.lines.length} dihitung · <b>{h.adjusted_count} disesuaikan</b> · {rupiah(h.value_diff)}</span>
            </div>
          ))}
          {history.length === 0 && <p className="py-3 text-muted-foreground">Belum ada opname</p>}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Sesuaikan stok {counted.length} produk?</DialogTitle></DialogHeader>
          <p className="text-sm">Stok sistem akan diganti dengan hasil hitung fisik. <b>{diffs.length}</b> produk memiliki selisih (nilai {rupiah(valueDiff)}). Semua perubahan tercatat di riwayat stok.</p>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (mis. Opname akhir bulan)" data-testid="opname-note-input" />
          <DialogFooter><Button onClick={() => commit.mutate()} disabled={commit.isPending} data-testid="opname-confirm-button">{commit.isPending ? "Menyimpan…" : "Ya, sesuaikan"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Hasil Stok Opname</DialogTitle></DialogHeader>
          <div className="max-h-80 divide-y overflow-y-auto text-sm" data-testid="opname-result">
            {result?.lines.filter((l) => l.diff).map((l) => (
              <div key={l.product_id} className="flex justify-between py-1.5"><span>{l.name}</span><span>{num(l.system_stock)} → <b>{num(l.counted)}</b> ({l.diff > 0 ? "+" : ""}{num(l.diff)})</span></div>
            ))}
            {result && result.adjusted_count === 0 && <p className="py-2">Semua stok sudah sesuai.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
