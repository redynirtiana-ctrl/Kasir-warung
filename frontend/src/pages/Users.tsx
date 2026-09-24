import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import type { Role, User, UserCreate, Permission, PermissionInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Form extends UserCreate { active: boolean; permissions: Permission[] }

export default function Users() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => apiGet<User[]>("/v1/users") });
  const { data: catalog = [] } = useQuery({ queryKey: ["permissions"], queryFn: () => apiGet<PermissionInfo[]>("/v1/auth/permissions") });
  const defaults = catalog.filter((p) => p.default).map((p) => p.key);

  const save = useMutation({
    mutationFn: (f: Form) =>
      editing
        ? apiPut<User>(`/v1/users/${editing.id}`, { full_name: f.full_name, role: f.role, active: f.active, password: f.password || null, permissions: f.permissions })
        : apiPost<User>("/v1/users", { username: f.username, full_name: f.full_name, role: f.role, password: f.password, permissions: f.permissions }),
    onSuccess: (u) => { toast.success(`Pengguna ${u.username} disimpan`); setForm(null); qc.invalidateQueries({ queryKey: ["users"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pengguna</h1>
          <p className="text-sm text-muted-foreground">Kelola akun admin & kasir</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ username: "", full_name: "", role: "kasir", password: "", active: true, permissions: defaults }); }} data-testid="add-user-button"><Plus /> Tambah Pengguna</Button>
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader><TableRow><TableHead>Username</TableHead><TableHead>Nama</TableHead><TableHead>Role</TableHead><TableHead>Hak akses</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} data-testid={`user-row-${u.username}`}>
                <TableCell className="font-mono">{u.username}</TableCell>
                <TableCell>{u.full_name}</TableCell>
                <TableCell><Badge className={u.role === "admin" ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"}>{u.role === "admin" ? "Admin / Owner" : "Kasir"}</Badge></TableCell>
                <TableCell className="max-w-72 text-xs text-muted-foreground" data-testid={`user-perms-${u.username}`}>{u.role === "admin" ? "Semua akses" : catalog.filter((p) => u.permissions.includes(p.key)).map((p) => p.label.split(" (")[0]).join(", ") || "Transaksi saja"}</TableCell>
                <TableCell>{u.active ? "Aktif" : <Badge variant="outline">Nonaktif</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon-sm" variant="ghost" onClick={() => { setEditing(u); setForm({ username: u.username, full_name: u.full_name, role: u.role, password: "", active: u.active, permissions: u.permissions }); }} data-testid={`user-edit-${u.username}`}><Pencil /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.username}` : "Tambah Pengguna"}</DialogTitle></DialogHeader>
          {form && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
              {!editing && <div className="space-y-1"><Label>Username</Label><Input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="user-username-input" /></div>}
              <div className="space-y-1"><Label>Nama lengkap</Label><Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} data-testid="user-fullname-input" /></div>
              <div className="space-y-1">
                <Label>Role</Label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className="h-9 w-full rounded-md border px-2 text-sm" data-testid="user-role-select">
                  <option value="kasir">Kasir</option><option value="admin">Admin / Owner</option>
                </select>
              </div>
              <div className="space-y-1"><Label>{editing ? "Password baru (opsional)" : "Password (min 6)"}</Label><Input type="password" required={!editing} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-password-input" /></div>
              <div className="space-y-2 rounded-lg border border-green-200 bg-green-50/60 p-3" data-testid="user-permissions">
                <Label>Hak akses {form.role === "admin" ? "(Admin otomatis punya semua akses)" : "kasir"}</Label>
                {catalog.map((p) => (
                  <label key={p.key} className={cn("flex items-center gap-2 text-sm", form.role === "admin" && "opacity-50")}>
                    <Checkbox disabled={form.role === "admin"} checked={form.role === "admin" || form.permissions.includes(p.key)} data-testid={`user-perm-${p.key}`}
                      onCheckedChange={(v) => setForm({ ...form, permissions: v ? [...form.permissions, p.key] : form.permissions.filter((x) => x !== p.key) })} />
                    {p.label}
                  </label>
                ))}
              </div>
              {editing && <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: Boolean(v) })} data-testid="user-active-checkbox" /> Aktif</label>}
              <DialogFooter><Button type="submit" disabled={save.isPending} data-testid="user-save-button">Simpan</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
