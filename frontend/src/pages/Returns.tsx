import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2, Plus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import type { Purchase, Return, ReturnIn, Sale } from "@/lib/types";
import { errMsg, fmtDateTime, num, rupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type RType = "sale" | "purchase";
interface Line { product_id: string; name: string; orig: number; remaining: number; price: number }

export default function Returns() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<RType>("sale");
  const [open, setOpen] = useState(false);
  const [refId, setRefId] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");

  const { data: returns = [] } = useQuery({ queryKey: ["returns", tab], queryFn: () => apiGet<Return[]>(`/v1/returns?type=${tab}`) });
  const { data: sales = [] } = useQuery({ queryKey: ["sales", "", "", ""], queryFn: () => apiGet<Sale[]>("/v1/sales?start=&end=&q="), enabled: open && tab === "sale" });
  const { data: purchases = [] } = useQuery({ queryKey: ["purchases", "list", ""], queryFn: () => apiGet<Purchase[]>("/v1/purchases?supplier_id="), enabled: open && tab === "purchase" });
  const { data: returned = {} } = useQuery({ queryKey: ["returns", "returned", refId], queryFn: () => apiGet<Record<string, number>>(`/v1/returns/returned/${refId}`), enabled: !!refId });

  const refs = tab === "sale"
    ? sales.filter((s) => s.status === "completed").map((s) => ({ id: s.id, label: `${s.invoice_no} · ${rupiah(s.total)}` }))
    : purchases.map((p) => ({ id: p.id, label: `${p.invoice_no} · ${p.supplier_name} · ${rupiah(p.total)}` }));

  const lines: Line[] = (() => {
    if (tab === "sale") {
      const s = sales.find((x) => x.id === refId);
      return s ? s.items.map((i) => ({ product_id: i.product_id, name: i.name, orig: i.qty, remaining: i.qty - (returned[i.product_id] ?? 0), price: i.subtotal / i.qty })) : [];
    }
    const p = purchases.find((x) => x.id === refId);
    return p ? p.items.map((i) => ({ product_id: i.product_id, name: i.name, orig: i.qty, remaining: i.qty - (returned[i.product_id] ?? 0), price: i.buy_price })) : [];
  })();
  const total = lines.reduce((a, l) => a + (qty[l.product_id] ?? 0) * l.price, 0);

  const save = useMutation({
    mutationFn: (b: ReturnIn) => apiPost<Return>("/v1/returns", b),
    onSuccess: (r) => {
      toast.success(`Retur ${r.return_no} disimpan — stok disesuaikan`);
      setOpen(false);
      ["returns", "products", "dashboard", "sales", "purchases", "shift", "reports"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = () => {
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([product_id, q]) => ({ product_id, qty: q }));
    if (!refId) return toast.error("Pilih transaksi asal");
    if (!items.length) return toast.error("Isi qty retur minimal 1 produk");
    if (reason.trim().length < 3) return toast.error("Isi alasan retur");
    save.mutate({ type: tab, ref_id: refId, items, reason });
  };

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Retur Barang</h1>
          <p className="text-sm text-muted-foreground">Retur penjualan menambah stok · retur pembelian mengurangi stok</p>
        </div>
        <Button onClick={() => { setRefId(""); setQty({}); setReason(""); setOpen(true); }} data-testid="add-return-button"><Plus /> Buat Retur {tab === "sale" ? "Penjualan" : "Pembelian"}</Button>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as RType)}>
        <TabsList>
          <TabsTrigger value="sale" data-testid="returns-tab-sale">Retur Penjualan</TabsTrigger>
          <TabsTrigger value="purchase" data-testid="returns-tab-purchase">Retur Pembelian</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader><TableRow><TableHead>No. Retur</TableHead><TableHead>Waktu</TableHead><TableHead>Transaksi asal</TableHead><TableHead>Barang</TableHead><TableHead>Alasan</TableHead><TableHead className="text-right">Nilai</TableHead></TableRow></TableHeader>
          <TableBody>
            {returns.map((r) => (
              <TableRow key={r.id} data-testid={`return-row-${r.return_no}`}>
                <TableCell className="font-mono font-medium">{r.return_no}</TableCell>
                <TableCell>{fmtDateTime(r.created_at)}</TableCell>
                <TableCell className="font-mono">{r.ref_no}</TableCell>
                <TableCell className="text-sm">{r.items.map((i) => `${i.name} x${num(i.qty)}`).join(", ")}</TableCell>
                <TableCell className="text-sm">{r.reason}</TableCell>
                <TableCell className="text-right font-semibold">{rupiah(r.total)}</TableCell>
              </TableRow>
            ))}
            {returns.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Belum ada retur</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle><Undo2 className="mr-2 inline size-5" />Retur {tab === "sale" ? "Penjualan" : "Pembelian"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{tab === "sale" ? "Transaksi penjualan" : "Pembelian"}</Label>
              <select value={refId} onChange={(e) => { setRefId(e.target.value); setQty({}); }} className="h-9 w-full rounded-md border bg-white px-2 text-sm" data-testid="return-ref-select">
                <option value="">- Pilih -</option>
                {refs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            {lines.length > 0 && (
              <div className="divide-y rounded-lg border px-3">
                {lines.map((l) => (
                  <div key={l.product_id} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid={`return-line-${l.product_id}`}>
                    <div>
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">Dibeli {num(l.orig)} · bisa diretur {num(l.remaining)} · {rupiah(l.price)}/unit</div>
                    </div>
                    <Input type="number" min={0} max={l.remaining} disabled={l.remaining <= 0} value={qty[l.product_id] ?? ""} className="w-24"
                      onChange={(e) => setQty({ ...qty, [l.product_id]: Math.min(Math.max(0, Number(e.target.value)), l.remaining) })}
                      data-testid="return-qty-input" />
                  </div>
                ))}
              </div>
            )}
            <Input placeholder="Alasan retur (wajib)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="return-reason-input" />
            <div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 text-amber-900">
              <span className="font-semibold">{tab === "sale" ? "Uang dikembalikan" : "Nilai retur ke supplier"}</span>
              <span className="font-heading text-xl font-bold" data-testid="return-total">{rupiah(total)}</span>
            </div>
            {tab === "sale" && <Badge variant="secondary">Stok barang akan bertambah kembali</Badge>}
            {tab === "purchase" && <Badge variant="secondary">Stok barang akan berkurang</Badge>}
          </div>
          <DialogFooter><Button onClick={submit} disabled={save.isPending} data-testid="return-save-button">Simpan Retur</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
