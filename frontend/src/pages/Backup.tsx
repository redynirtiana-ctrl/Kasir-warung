import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DatabaseBackup, Download, RotateCcw, Trash2, Upload, ShieldAlert, Moon } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiUpload } from "@/lib/api";
import type { BackupInfo } from "@/lib/types";
import { errMsg, fmtDateTime } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const SOURCE: Record<string, string> = { manual: "Manual", auto: "Otomatis", "pre-restore": "Sebelum restore" };
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default function Backup() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<{ backup?: BackupInfo; file?: File } | null>(null);
  const [typed, setTyped] = useState("");
  const { data: backups = [] } = useQuery({ queryKey: ["backups"], queryFn: () => apiGet<BackupInfo[]>("/v1/backups") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["backups"] });

  const create = useMutation({
    mutationFn: () => apiPost<BackupInfo>("/v1/backups"),
    onSuccess: (b) => { toast.success(`Backup berhasil: ${b.filename}`); refresh(); },
    onError: (e) => toast.error(`Backup gagal: ${errMsg(e)}`),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/backups/${id}`),
    onSuccess: () => { toast.success("Backup dihapus"); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const restore = useMutation({
    mutationFn: () => {
      if (confirm?.file) {
        const f = new FormData();
        f.append("file", confirm.file);
        return apiUpload<{ success: boolean }>("/v1/backups/restore-upload", f);
      }
      return apiPost<{ success: boolean }>(`/v1/backups/${confirm!.backup!.id}/restore`);
    },
    onSuccess: () => {
      toast.success("Restore berhasil. Data dimuat ulang…");
      setConfirm(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(`Restore gagal: ${errMsg(e)}`),
  });

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Backup Database</h1>
          <p className="text-sm text-muted-foreground">Backup manual, otomatis tiap malam (23:59 WIB, simpan 14 terakhir), unduh & restore</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".gz,.json" className="hidden" data-testid="restore-file-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setTyped(""); setConfirm({ file: f }); } e.target.value = ""; }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="restore-upload-button"><Upload /> Restore dari file</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending} data-testid="backup-now-button"><DatabaseBackup /> {create.isPending ? "Membuat…" : "Backup Sekarang"}</Button>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <Moon className="size-4" /> Backup otomatis berjalan setiap malam. Unduh backup secara berkala dan simpan di flashdisk / Google Drive untuk keamanan ekstra.
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader><TableRow><TableHead>Waktu</TableHead><TableHead>Jenis</TableHead><TableHead>Isi</TableHead><TableHead className="text-right">Ukuran</TableHead><TableHead>Oleh</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {backups.map((b) => (
              <TableRow key={b.id} data-testid={`backup-row-${b.id}`}>
                <TableCell className="font-medium">{fmtDateTime(b.created_at)}</TableCell>
                <TableCell><Badge variant={b.source === "auto" ? "secondary" : "outline"}>{SOURCE[b.source]}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{b.collections.products ?? 0} produk · {b.collections.sales ?? 0} transaksi · {b.collections.customers ?? 0} pelanggan</TableCell>
                <TableCell className="text-right font-mono text-sm">{kb(b.size)}</TableCell>
                <TableCell>{b.username}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <a className={buttonVariants({ size: "icon-sm", variant: "ghost" })} href={`/api/v1/backups/${b.id}/download`} title="Unduh" data-testid={`backup-download-${b.id}`}><Download /></a>
                    <Button size="icon-sm" variant="ghost" title="Restore" onClick={() => { setTyped(""); setConfirm({ backup: b }); }} data-testid={`backup-restore-${b.id}`}><RotateCcw /></Button>
                    <Button size="icon-sm" variant="ghost" title="Hapus" onClick={() => window.confirm("Hapus backup ini?") && del.mutate(b.id)} data-testid={`backup-delete-${b.id}`}><Trash2 className="text-rose-600" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {backups.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Belum ada backup</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-rose-700"><ShieldAlert /> Restore Database</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="rounded-lg bg-rose-50 p-3 text-rose-900"><b>PERINGATAN:</b> semua data saat ini (produk, transaksi, stok, pelanggan, dll) akan <b>diganti</b> dengan isi backup
              {confirm?.backup ? ` tanggal ${fmtDateTime(confirm.backup.created_at)}` : ` dari file ${confirm?.file?.name}`}. Sistem otomatis membuat backup "Sebelum restore" dulu.</p>
            <p>Ketik <b>RESTORE</b> untuk melanjutkan:</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="restore-confirm-input" />
          </div>
          <DialogFooter>
            <Button variant="destructive" disabled={typed !== "RESTORE" || restore.isPending} onClick={() => restore.mutate()} data-testid="restore-confirm-button">{restore.isPending ? "Memulihkan…" : "Restore Sekarang"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
