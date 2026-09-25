import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Pencil, Plus, Trash2, Star } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Store, StoreIn } from "@/lib/types";
import { errMsg, num, rupiah } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EMPTY: StoreIn = { code: "", name: "", address: "", phone: "", active: true };

export default function Stores() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Store | null>(null);
  const [form, setForm] = useState<StoreIn | null>(null);
  const { data: stores = [], isLoading } = useQuery({ queryKey: ["stores"], queryFn: () => apiGet<Store[]>("/v1/stores") });

  const done = (msg: string) => { toast.success(msg); setForm(null); qc.invalidateQueries({ queryKey: ["stores"] }); };
  const save = useMutation({
    mutationFn: (b: StoreIn) => (editing ? apiPut<Store>(`/v1/stores/${editing.id}`, b) : apiPost<Store>("/v1/stores", b)),
    onSuccess: (s) => done(`Cabang ${s.name} disimpan`),
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/stores/${id}`),
    onSuccess: () => done("Cabang dihapus"),
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Toko & Cabang</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Fondasi multi-cabang. Semua produk, transaksi, pembelian dan histori stok saat ini tercatat di <b>Cabang Utama</b>.
            Cabang baru bisa disiapkan dari sekarang untuk warung berikutnya.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ ...EMPTY }); }} data-testid="add-store-button"><Plus /> Tambah Cabang</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="store-list">
        {isLoading && <div className="text-sm text-muted-foreground">Memuat…</div>}
        {stores.map((s) => (
          <div key={s.id} className={`rounded-2xl border bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md ${s.is_main ? "border-emerald-300 ring-1 ring-emerald-200" : ""}`} data-testid={`store-card-${s.code}`}>
            <div className="flex items-start gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Building2 className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold" data-testid={`store-name-${s.code}`}>{s.name}</span>
                  <Badge variant="secondary" className="font-mono">{s.code}</Badge>
                  {s.is_main && <Badge className="bg-emerald-600"><Star className="size-3" /> Utama</Badge>}
                  {!s.active && <Badge className="bg-stone-200 text-stone-700">Nonaktif</Badge>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.address || "Alamat belum diisi"}{s.phone ? ` · ${s.phone}` : ""}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-stone-50 p-2"><div className="text-xs text-muted-foreground">Produk</div><div className="font-semibold" data-testid={`store-products-${s.code}`}>{num(s.product_count)}</div></div>
              <div className="rounded-lg bg-stone-50 p-2"><div className="text-xs text-muted-foreground">Transaksi</div><div className="font-semibold" data-testid={`store-sales-${s.code}`}>{num(s.sales_count)}</div></div>
              <div className="rounded-lg bg-stone-50 p-2"><div className="text-xs text-muted-foreground">Omzet</div><div className="truncate text-sm font-semibold">{rupiah(s.sales_total)}</div></div>
            </div>
            <div className="mt-3 flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setForm({ code: s.code, name: s.name, address: s.address, phone: s.phone, active: s.active }); }} data-testid={`store-edit-${s.code}`}><Pencil /> Edit</Button>
              {!s.is_main && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => confirm(`Hapus cabang ${s.name}?`) && del.mutate(s.id)} data-testid={`store-delete-${s.code}`}><Trash2 /> Hapus</Button>}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        {form && (
          <DialogContent data-testid="store-dialog">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Cabang" : "Tambah Cabang"}</DialogTitle>
              <DialogDescription>Kode singkat dipakai untuk penanda data cabang (mis. UTAMA, CBG2).</DialogDescription>
            </DialogHeader>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label>Kode</Label><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-testid="store-code-input" /></div>
                <div className="col-span-2 space-y-1"><Label>Nama cabang</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="store-name-input" /></div>
              </div>
              <div className="space-y-1"><Label>Alamat</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="store-address-input" /></div>
              <div className="space-y-1"><Label>Nomor telepon / WA</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="store-phone-input" /></div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.active} disabled={editing?.is_main} onCheckedChange={(v) => setForm({ ...form, active: Boolean(v) })} data-testid="store-active-checkbox" /> Aktif</label>
              <DialogFooter><Button type="submit" disabled={save.isPending} data-testid="store-save-button">Simpan</Button></DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
