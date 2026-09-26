import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DatabaseBackup, Download, RotateCcw, Trash2, Upload, ShieldAlert, Moon, Usb, RefreshCw, Cloud, CloudUpload } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from "@/lib/api";
import type { BackupInfo, GdriveStatus, GdriveUploadResult, UsbCopyResult, UsbStatus } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
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

  const usb = useQuery({ queryKey: ["backups", "usb"], queryFn: () => apiGet<UsbStatus>("/v1/backups/usb"), refetchInterval: 10000 });
  const drives = usb.data?.drives ?? [];
  const [drivePath, setDrivePath] = useState("");
  const target = drives.find((d) => d.path === drivePath) ?? drives[0];
  const toUsb = useMutation({
    mutationFn: (b: BackupInfo) => apiPost<UsbCopyResult>(`/v1/backups/${b.id}/copy-to-usb`, { path: target!.path }),
    onSuccess: (r) => { toast.success(`Tersalin ke flashdisk ${r.label} (${kb(r.size)}). Aman untuk dicabut.`); refresh(); },
    onError: (e) => toast.error(`Gagal salin ke flashdisk: ${errMsg(e)}`),
  });
  const backupToUsb = useMutation({
    mutationFn: async () => { const b = await apiPost<BackupInfo>("/v1/backups"); return apiPost<UsbCopyResult>(`/v1/backups/${b.id}/copy-to-usb`, { path: target!.path }); },
    onSuccess: (r) => { toast.success(`Backup baru tersimpan di flashdisk ${r.label}. Aman untuk dicabut.`); refresh(); },
    onError: (e) => { toast.error(`Gagal: ${errMsg(e)}`); refresh(); },
  });
  const autoUsb = useMutation({
    mutationFn: (v: boolean) => apiPut<UsbStatus>("/v1/backups/usb/auto", { auto_copy: v }),
    onSuccess: (s) => { toast.success(s.auto_copy ? "Backup malam akan otomatis disalin ke flashdisk" : "Salin otomatis ke flashdisk dimatikan"); qc.invalidateQueries({ queryKey: ["backups", "usb"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const gd = useQuery({ queryKey: ["backups", "gdrive"], queryFn: () => apiGet<GdriveStatus>("/v1/backups/gdrive"), staleTime: 60000 });
  const gdOk = gd.data?.connected ?? false;
  const toDrive = useMutation({
    mutationFn: (b: BackupInfo) => apiPost<GdriveUploadResult>(`/v1/backups/${b.id}/copy-to-gdrive`),
    onSuccess: (r) => { toast.success(`Terunggah ke Google Drive: ${r.uploaded}${r.deleted.length ? ` (${r.deleted.length} backup lama dihapus)` : ""}`); refresh(); },
    onError: (e) => { toast.error(`Gagal unggah ke Google Drive: ${errMsg(e)}`); qc.invalidateQueries({ queryKey: ["backups", "gdrive"] }); },
  });
  const backupToDrive = useMutation({
    mutationFn: async () => { const b = await apiPost<BackupInfo>("/v1/backups"); return apiPost<GdriveUploadResult>(`/v1/backups/${b.id}/copy-to-gdrive`); },
    onSuccess: (r) => { toast.success(`Backup baru tersimpan di Google Drive: ${r.uploaded}`); refresh(); },
    onError: (e) => { toast.error(`Gagal: ${errMsg(e)}`); refresh(); },
  });
  const autoDrive = useMutation({
    mutationFn: (v: boolean) => apiPut<GdriveStatus>("/v1/backups/gdrive/auto", { auto_copy: v }),
    onSuccess: (s) => { qc.setQueryData(["backups", "gdrive"], s); toast.success(s.auto_copy ? "Backup malam akan otomatis diunggah ke Google Drive" : "Unggah otomatis ke Google Drive dimatikan"); },
    onError: (e) => toast.error(errMsg(e)),
  });

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
        <Moon className="size-4" /> Backup otomatis berjalan setiap malam. Simpan salinan di flashdisk (panel di bawah) atau Google Drive supaya data aman walau komputer server rusak.
      </div>
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 shadow-sm" data-testid="usb-panel">
        <div className="flex flex-wrap items-center gap-3">
          <Usb className="size-5 text-sky-700" />
          <h3 className="font-semibold text-sky-900">Flashdisk di server</h3>
          <Button size="sm" variant="ghost" onClick={() => usb.refetch()} data-testid="usb-refresh-button"><RefreshCw className={usb.isFetching ? "animate-spin" : ""} /> Cek ulang</Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {drives.length > 1 && (
              <select value={target?.path ?? ""} onChange={(e) => setDrivePath(e.target.value)} className="h-8 rounded-md border bg-white px-2 text-sm" data-testid="usb-drive-select">
                {drives.map((d) => <option key={d.path} value={d.path}>{`${d.label} (sisa ${kb(d.free_bytes)})`}</option>)}
              </select>
            )}
            <Button size="sm" className="bg-sky-700 hover:bg-sky-800" disabled={!target || !target.writable || backupToUsb.isPending} onClick={() => backupToUsb.mutate()} data-testid="usb-backup-now-button">
              <Usb /> {backupToUsb.isPending ? "Menyalin…" : "Backup ke Flashdisk"}
            </Button>
          </div>
        </div>
        <div className="mt-2 text-sm" data-testid="usb-status">
          {drives.length === 0
            ? <span className="text-muted-foreground">Belum ada flashdisk terdeteksi. Colokkan flashdisk ke <b>komputer server</b> (bukan komputer kasir), tunggu beberapa detik, lalu klik Cek ulang.</span>
            : <span className="text-sky-900">Terdeteksi: {drives.map((d) => `${d.label} — sisa ${kb(d.free_bytes)} dari ${kb(d.total_bytes)}${d.writable ? "" : " (tidak bisa ditulisi)"}`).join(" · ")}. File disimpan di folder <b>WARUNG-BACKUP</b> (30 terakhir).</span>}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-sky-950">
          <Checkbox checked={usb.data?.auto_copy ?? false} disabled={autoUsb.isPending || !usb.data} onCheckedChange={(v) => autoUsb.mutate(Boolean(v))} data-testid="usb-auto-checkbox" />
          Salin otomatis backup malam (23:59) ke flashdisk yang sedang tercolok
        </label>
      </div>
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm" data-testid="gdrive-panel">
        <div className="flex flex-wrap items-center gap-3">
          <Cloud className="size-5 text-indigo-700" />
          <h3 className="font-semibold text-indigo-950">Google Drive pemilik</h3>
          <Badge className={gdOk ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"} data-testid="gdrive-status-badge">
            {gd.isLoading ? "Memeriksa…" : gdOk ? "Terhubung" : gd.data?.configured ? "Tidak tersambung" : "Belum dihubungkan"}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => gd.refetch()} data-testid="gdrive-refresh-button"><RefreshCw className={gd.isFetching ? "animate-spin" : ""} /> Cek ulang</Button>
          <Button size="sm" className="ml-auto bg-indigo-700 hover:bg-indigo-800" disabled={!gdOk || backupToDrive.isPending} onClick={() => backupToDrive.mutate()} data-testid="gdrive-backup-now-button">
            <CloudUpload /> {backupToDrive.isPending ? "Mengunggah…" : "Backup ke Google Drive"}
          </Button>
        </div>
        <div className="mt-2 text-sm" data-testid="gdrive-status-text">
          {gd.data && (gdOk
            ? <span className="text-indigo-950">Folder <b>{gd.data.folder}</b> di Google Drive · 30 backup terakhir disimpan{gd.data.quota_free != null ? ` · sisa kuota ${kb(gd.data.quota_free)}` : ""}{gd.data.last_upload_at ? ` · unggahan terakhir ${fmtDateTime(gd.data.last_upload_at)}` : ""}</span>
            : <span className="text-muted-foreground">{gd.data.reason}. Ikuti panduan <b>docs/GOOGLE-DRIVE.md</b> (sekali setup di server, ±5 menit).</span>)}
          {gd.data?.last_error && <div className="mt-1 text-rose-700" data-testid="gdrive-last-error">Gagal terakhir: {gd.data.last_error}</div>}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-indigo-950">
          <Checkbox checked={gd.data?.auto_copy ?? false} disabled={autoDrive.isPending || !gd.data} onCheckedChange={(v) => autoDrive.mutate(Boolean(v))} data-testid="gdrive-auto-checkbox" />
          Unggah otomatis backup malam (23:59) ke Google Drive
        </label>
      </div>
      <div className="rounded-2xl border bg-white shadow-sm">
        <Table>
          <TableHeader><TableRow><TableHead>Waktu</TableHead><TableHead>Jenis</TableHead><TableHead>Isi</TableHead><TableHead className="text-right">Ukuran</TableHead><TableHead>Oleh</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {backups.map((b) => (
              <TableRow key={b.id} data-testid={`backup-row-${b.id}`}>
                <TableCell className="font-medium">{fmtDateTime(b.created_at)}{b.usb_copied_to?.length > 0 && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-normal text-sky-700" title={`Sudah disalin ke: ${b.usb_copied_to.join(", ")}`} data-testid={`backup-usb-copied-${b.id}`}><Usb className="size-3" />{b.usb_copied_to.join(", ")}</span>}{b.gdrive_uploaded && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-normal text-indigo-700" title="Sudah ada di Google Drive" data-testid={`backup-gdrive-uploaded-${b.id}`}><Cloud className="size-3" />Drive</span>}</TableCell>
                <TableCell><Badge variant={b.source === "auto" ? "secondary" : "outline"}>{SOURCE[b.source]}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{b.collections.products ?? 0} produk · {b.collections.sales ?? 0} transaksi · {b.collections.customers ?? 0} pelanggan</TableCell>
                <TableCell className="text-right font-mono text-sm">{kb(b.size)}</TableCell>
                <TableCell>{b.username}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" title={target ? `Salin ke flashdisk ${target.label}` : "Colokkan flashdisk ke server"} disabled={!target || !target.writable || toUsb.isPending} onClick={() => toUsb.mutate(b)} data-testid={`backup-usb-${b.id}`}><Usb className="text-sky-700" /></Button>
                    <Button size="icon-sm" variant="ghost" title={gdOk ? "Unggah ke Google Drive" : "Google Drive belum terhubung"} disabled={!gdOk || toDrive.isPending} onClick={() => toDrive.mutate(b)} data-testid={`backup-gdrive-${b.id}`}><CloudUpload className="text-indigo-700" /></Button>
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
