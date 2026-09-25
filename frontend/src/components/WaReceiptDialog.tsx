import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Send, ExternalLink } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { errMsg } from "@/lib/format";
import type { Sale, WaReceiptIn, WaReceiptPreview, WaReceiptResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const waLink = (phone: string, text: string) => {
  const d = phone.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("0") ? "62" + d.slice(1) : d}?text=${encodeURIComponent(text)}`;
};

/** Kirim struk digital ke WhatsApp pelanggan: Fonnte (otomatis) dengan cadangan tautan wa.me. */
export default function WaReceiptDialog({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const { data: preview, isLoading } = useQuery({
    queryKey: ["wa-receipt", sale?.id],
    queryFn: () => apiGet<WaReceiptPreview>(`/v1/sales/${sale!.id}/whatsapp`),
    enabled: !!sale,
  });
  useEffect(() => { setPhone(preview?.phone ?? ""); }, [preview]);

  const valid = phone.replace(/\D/g, "").length >= 8;
  const send = useMutation({
    mutationFn: (body: WaReceiptIn) => apiPost<WaReceiptResult>(`/v1/sales/${sale!.id}/whatsapp`, body),
    onSuccess: (r) => {
      if (r.sent) {
        toast.success(`Struk terkirim ke WhatsApp ${r.target}`);
        onClose();
      } else {
        toast.warning(`${r.reason}. Membuka WhatsApp…`);
        window.open(r.wa_link, "_blank", "noopener");
      }
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="wa-receipt-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageCircle className="size-5 text-emerald-600" /> Kirim Struk via WhatsApp</DialogTitle>
          <DialogDescription>
            {sale?.invoice_no}
            {preview?.customer_name ? ` · Member: ${preview.customer_name}` : " · Tanpa member"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wa-phone">Nomor WhatsApp pelanggan</Label>
            <Input id="wa-phone" inputMode="tel" placeholder="08xxxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="wa-receipt-phone-input" />
            {!isLoading && preview && !preview.phone && <p className="text-xs text-amber-700" data-testid="wa-receipt-no-phone">Member belum punya nomor WA — isi manual.</p>}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Pengiriman:</span>
            {preview?.fonnte_configured
              ? <Badge className="bg-emerald-600" data-testid="wa-receipt-mode">Otomatis (Fonnte)</Badge>
              : <Badge variant="secondary" data-testid="wa-receipt-mode">Tautan wa.me (token Fonnte belum diatur)</Badge>}
          </div>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-dashed bg-emerald-50/60 p-3 font-mono text-[11px] leading-relaxed" data-testid="wa-receipt-preview">
            {isLoading ? "Memuat struk…" : preview?.text}
          </pre>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={!valid || !preview} onClick={() => preview && window.open(waLink(phone, preview.text), "_blank", "noopener")} data-testid="wa-receipt-open-link-button">
            <ExternalLink /> Buka WhatsApp
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!valid || !preview || send.isPending} onClick={() => send.mutate({ phone })} data-testid="wa-receipt-send-button">
            <Send /> {send.isPending ? "Mengirim…" : "Kirim Struk"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
