import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Category, CategoryIn } from "@/lib/types";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function Categories() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState<CategoryIn | null>(null);
  const { data: cats = [] } = useQuery({ queryKey: ["categories"], queryFn: () => apiGet<Category[]>("/v1/categories") });

  const done = (msg: string) => {
    toast.success(msg);
    setForm(null);
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };
  const save = useMutation({
    mutationFn: (b: CategoryIn) => (editing ? apiPut<Category>(`/v1/categories/${editing.id}`, b) : apiPost<Category>("/v1/categories", b)),
    onSuccess: (c) => done(`Kategori ${c.name} disimpan`),
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/categories/${id}`),
    onSuccess: () => done("Kategori dihapus"),
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kategori</h1>
          <p className="text-sm text-muted-foreground">{cats.length} kategori</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ name: "", description: "" }); }} data-testid="add-category-button"><Plus /> Tambah Kategori</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cats.map((c, i) => (
          <div key={c.id} className="group rounded-2xl border bg-white p-5 shadow-sm transition-shadow duration-150 hover:shadow-md" data-testid={`category-card-${c.name}`}>
            <div className="flex items-start justify-between">
              <div className={`grid size-10 place-items-center rounded-xl ${i % 2 ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}><Tag className="size-5" /></div>
              <div className="flex gap-1 opacity-70 group-hover:opacity-100">
                <Button size="icon-sm" variant="ghost" onClick={() => { setEditing(c); setForm({ name: c.name, description: c.description }); }} data-testid={`category-edit-${c.name}`}><Pencil /></Button>
                <Button size="icon-sm" variant="ghost" onClick={() => confirm(`Hapus kategori ${c.name}?`) && del.mutate(c.id)} data-testid={`category-delete-${c.name}`}><Trash2 className="text-rose-600" /></Button>
              </div>
            </div>
            <div className="mt-3 font-heading text-lg font-semibold">{c.name}</div>
            <div className="text-sm text-muted-foreground">{c.product_count} produk</div>
          </div>
        ))}
      </div>
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Kategori" : "Tambah Kategori"}</DialogTitle></DialogHeader>
          {form && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              <div className="space-y-1"><Label>Nama</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="category-name-input" /></div>
              <div className="space-y-1"><Label>Deskripsi</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="category-description-input" /></div>
              <DialogFooter><Button type="submit" disabled={save.isPending} data-testid="category-save-button">Simpan</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
