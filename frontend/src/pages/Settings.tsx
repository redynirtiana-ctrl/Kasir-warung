import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Send } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import type { FonnteStatus, NotificationLog, Sale, Settings as SettingsData } from "@/lib/types";
import { errMsg, fmtDateTime, PAYMENT_LABELS } from "@/lib/format";
import { printReceipt } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

function testSale(): Sale {
  return {
    id: "test", invoice_no: "TEST-PRINT", subtotal: 111000, discount: 0, tax: 0, total: 111000, payment_method: "cash",
    amount_paid: 120000, change: 9000, cashier_name: "Test", status: "completed", void_reason: null, customer_id: null, customer_name: null, points_earned: 0, points_redeemed: 0, points_discount: 0,
    date: "", created_at: new Date().toISOString(), store_id: "main", wa_receipt_queued: false,
    items: [
      { product_id: "1", name: "Beras", unit: "karung", qty: 1, price: 75000, buy_price: 0, discount: 0, subtotal: 75000, normal_price: 0, price_type: "normal", factor: 1 },
      { product_id: "2", name: "Minyak", unit: "pcs", qty: 2, price: 18000, buy_price: 0, discount: 0, subtotal: 36000, normal_price: 0, price_type: "normal", factor: 1 },
    ],
  };
}

function SettingsForm({ initial }: { initial: SettingsData }) {
  const qc = useQueryClient();
  const [f, setF] = useState<SettingsData>(initial);
  const save = useMutation({
    mutationFn: (b: SettingsData) => apiPut<SettingsData>("/v1/settings", b),
    onSuccess: () => { toast.success("Pengaturan disimpan"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const toggleMethod = (m: string) =>
    setF((s) => ({ ...s, payment_methods: s.payment_methods.includes(m) ? s.payment_methods.filter((x) => x !== m) : [...s.payment_methods, m] }));

  return (
    <form className="grid max-w-3xl gap-4 rounded-2xl border bg-white p-6 shadow-sm md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(f); }} data-testid="settings-form">
      <div className="space-y-1 md:col-span-2"><Label>Nama toko</Label><Input value={f.store_name} onChange={(e) => setF({ ...f, store_name: e.target.value })} data-testid="settings-store-name-input" /></div>
      <div className="space-y-1 md:col-span-2"><Label>Alamat</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="settings-address-input" /></div>
      <div className="space-y-1"><Label>Nomor WhatsApp</Label><Input value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} data-testid="settings-whatsapp-input" /></div>
      <div className="space-y-1">
        <Label>Ukuran kertas struk</Label>
        <select value={f.paper_size} onChange={(e) => setF({ ...f, paper_size: e.target.value as SettingsData["paper_size"] })} className="h-9 w-full rounded-md border px-2 text-sm" data-testid="settings-paper-select">
          <option value="58">58 mm</option><option value="80">80 mm</option>
        </select>
      </div>
      <div className="space-y-1"><Label>WhatsApp pemilik (tujuan laporan)</Label><Input value={f.owner_whatsapp} onChange={(e) => setF({ ...f, owner_whatsapp: e.target.value })} placeholder="08xxxxxxxxxx" data-testid="settings-owner-wa-input" /></div>
      <div className="space-y-1"><Label>Kategori pengeluaran (pisahkan koma)</Label><Input value={f.expense_categories.join(", ")} onChange={(e) => setF({ ...f, expense_categories: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} data-testid="settings-expense-categories-input" /></div>
      <label className="flex items-center gap-2 text-sm md:col-span-2"><Checkbox checked={f.morning_summary_enabled} onCheckedChange={(v) => setF({ ...f, morning_summary_enabled: Boolean(v) })} data-testid="settings-morning-summary-checkbox" /> Kirim ringkasan pagi otomatis ke WhatsApp pemilik (07:00 WIB, via Fonnte)</label>
      <label className="flex items-center gap-2 text-sm md:col-span-2"><Checkbox checked={f.auto_wa_receipt} onCheckedChange={(v) => setF({ ...f, auto_wa_receipt: Boolean(v) })} data-testid="settings-auto-wa-receipt-checkbox" /> Kirim struk otomatis ke WhatsApp member setiap transaksi selesai (via Fonnte, kasir bisa matikan per transaksi)</label>
      <label className="flex items-center gap-2 text-sm md:col-span-2"><Checkbox checked={f.birthday_greeting_enabled} onCheckedChange={(v) => setF({ ...f, birthday_greeting_enabled: Boolean(v) })} data-testid="settings-birthday-greeting-checkbox" /> Kirim ucapan ulang tahun otomatis ke WhatsApp member (07:00 WIB, via Fonnte)</label>
      <div className="space-y-1"><Label>Batas diskon kasir tanpa PIN admin (%)</Label><Input type="number" min={0} max={100} value={f.max_cashier_discount_percent} onChange={(e) => setF({ ...f, max_cashier_discount_percent: Number(e.target.value) })} data-testid="settings-max-discount-input" /></div>
      <div className="space-y-1"><Label>Peringatan kedaluwarsa (hari sebelumnya)</Label><Input type="number" min={1} max={365} value={f.expiry_warning_days} onChange={(e) => setF({ ...f, expiry_warning_days: Number(e.target.value) })} data-testid="settings-expiry-days-input" /></div>
      <div className="space-y-1"><Label>Pajak (%)</Label><Input type="number" min={0} max={100} value={f.tax_percent} onChange={(e) => setF({ ...f, tax_percent: Number(e.target.value) })} data-testid="settings-tax-input" /></div>
      <div className="space-y-1"><Label>Prefix nomor transaksi</Label><Input value={f.invoice_prefix} onChange={(e) => setF({ ...f, invoice_prefix: e.target.value })} data-testid="settings-prefix-input" /></div>
      <div className="space-y-1 md:col-span-2"><Label>Footer struk</Label><Textarea value={f.receipt_footer} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} data-testid="settings-footer-input" /></div>
      <div className="grid gap-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4 md:col-span-2 md:grid-cols-4">
        <label className="flex items-center gap-2 text-sm font-medium md:col-span-4"><Checkbox checked={f.loyalty_enabled} onCheckedChange={(v) => setF({ ...f, loyalty_enabled: Boolean(v) })} data-testid="settings-loyalty-checkbox" /> Poin pelanggan aktif</label>
        <div className="space-y-1"><Label>Belanja Rp per 1 poin</Label><Input type="number" min={1} value={f.points_per_amount} onChange={(e) => setF({ ...f, points_per_amount: Number(e.target.value) })} data-testid="settings-points-per-amount-input" /></div>
        <div className="space-y-1"><Label>Nilai 1 poin (Rp)</Label><Input type="number" min={0} value={f.point_value} onChange={(e) => setF({ ...f, point_value: Number(e.target.value) })} data-testid="settings-point-value-input" /></div>
        <div className="space-y-1"><Label>Minimal tukar (poin)</Label><Input type="number" min={0} value={f.min_redeem_points} onChange={(e) => setF({ ...f, min_redeem_points: Number(e.target.value) })} data-testid="settings-min-redeem-input" /></div>
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label>Metode pembayaran aktif</Label>
        <div className="flex flex-wrap gap-4">
          {Object.entries(PAYMENT_LABELS).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><Checkbox checked={f.payment_methods.includes(k)} onCheckedChange={() => toggleMethod(k)} data-testid={`settings-method-${k}`} /> {l}</label>
          ))}
        </div>
      </div>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={save.isPending} data-testid="settings-save-button">Simpan</Button>
        <Button type="button" variant="outline" onClick={() => printReceipt(testSale(), f)} data-testid="settings-test-print-button"><Printer /> Test Print</Button>
      </div>
    </form>
  );
}

function FonnteSection() {
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const { data: st } = useQuery({ queryKey: ["fonnte"], queryFn: () => apiGet<FonnteStatus>("/v1/integrations/fonnte") });
  const { data: logs = [] } = useQuery({ queryKey: ["notification-logs"], queryFn: () => apiGet<NotificationLog[]>("/v1/notifications/logs") });
  const saveToken = useMutation({
    mutationFn: (t: string) => apiPut<FonnteStatus>("/v1/integrations/fonnte", { token: t }),
    onSuccess: (r) => { toast.success(r.configured ? "Token Fonnte disimpan" : "Token Fonnte dihapus"); setToken(""); qc.invalidateQueries({ queryKey: ["fonnte"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const test = useMutation({
    mutationFn: () => apiPost<NotificationLog>("/v1/integrations/fonnte/test"),
    onSuccess: (r) => { r.status ? toast.success("Pesan tes terkirim — cek WhatsApp pemilik") : toast.error(`Gagal: ${r.reason}`); qc.invalidateQueries({ queryKey: ["notification-logs"] }); },
  });
  return (
    <div className="max-w-3xl space-y-4 rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm" data-testid="fonnte-section">
      <div>
        <h2 className="text-lg font-semibold">WhatsApp Otomatis (Fonnte)</h2>
        <p className="text-sm text-muted-foreground">Ringkasan pagi (hutang jatuh tempo, barang kedaluwarsa, stok) dikirim otomatis setiap 07:00 WIB ke nomor WhatsApp pemilik. Token: fonnte.com → Device → Token.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={st?.configured ? "rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800" : "rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-900"} data-testid="fonnte-status">
          {st?.configured ? `Token aktif${st.source === "env" ? " (dari .env)" : ""}` : "Token belum diatur"}
        </span>
        <span className="text-muted-foreground">Tujuan: {st?.owner_whatsapp || "— isi WhatsApp pemilik di atas"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input type="password" placeholder={st?.configured ? "Ganti token…" : "Tempel token device Fonnte"} value={token} onChange={(e) => setToken(e.target.value)} className="max-w-sm" data-testid="fonnte-token-input" />
        <Button disabled={!token.trim() || saveToken.isPending} onClick={() => saveToken.mutate(token)} data-testid="fonnte-save-button">Simpan Token</Button>
        {st?.source === "database" && <Button variant="outline" onClick={() => saveToken.mutate("")} data-testid="fonnte-remove-button">Hapus</Button>}
        <Button variant="outline" disabled={!st?.configured || test.isPending} onClick={() => test.mutate()} data-testid="fonnte-test-button"><Send /> Kirim Tes</Button>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-medium">Riwayat pengiriman</h3>
        <ul className="divide-y rounded-lg border text-sm" data-testid="notification-logs">
          {logs.map((l, i) => (
            <li key={i} className="flex justify-between gap-2 px-3 py-2">
              <span>{l.kind === "morning_summary" ? "Ringkasan pagi" : "Tes"} · {l.source === "cron" ? "otomatis" : "manual"} · <span className="text-muted-foreground">{fmtDateTime(l.created_at)}</span></span>
              <span className={l.status ? "text-emerald-700" : "text-rose-700"}>{l.status ? "Terkirim" : l.reason}</span>
            </li>
          ))}
          {logs.length === 0 && <li className="px-3 py-2 text-muted-foreground">Belum ada pengiriman</li>}
        </ul>
      </div>
    </div>
  );
}

export default function Settings() {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<SettingsData>("/v1/settings") });
  return (
    <div className="space-y-5 p-4 md:p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pengaturan Toko & Struk</h1>
        <p className="text-sm text-muted-foreground">Struk dicetak lewat dialog print browser ke printer thermal (58/80mm).</p>
      </div>
      {data ? <SettingsForm key={JSON.stringify(data)} initial={data} /> : <div className="h-64 max-w-3xl animate-pulse rounded-2xl bg-muted" />}
      <FonnteSection />
    </div>
  );
}
