import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, Megaphone, RefreshCw, Send, XCircle } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { errMsg, fmtDateTime, rupiah, waLink } from "@/lib/format";
import type { PromoCampaign, PromoDraft, PromoSendIn } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const personalize = (text: string, name: string) => text.replaceAll("{nama}", name);

/** Dashboard card + dialog: kirim info promo mingguan ke semua member (Fonnte bertahap, atau wa.me satu per satu). */
export default function PromoBroadcast() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const [linkMode, setLinkMode] = useState(false);

  const { data: draft } = useQuery({ queryKey: ["promo-draft"], queryFn: () => apiGet<PromoDraft>("/v1/promo/broadcast") });
  useEffect(() => { if (open && draft && !text) setText(draft.text); }, [open, draft, text]);

  const { data: campaign } = useQuery({
    queryKey: ["promo-campaign", campaignId],
    queryFn: () => apiGet<PromoCampaign>(`/v1/promo/campaigns/${campaignId}`),
    enabled: !!campaignId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });
  useEffect(() => {
    if (campaign && campaign.status === "done") qc.invalidateQueries({ queryKey: ["promo-draft"] });
  }, [campaign, qc]);

  const send = useMutation({
    mutationFn: (body: PromoSendIn) => apiPost<PromoCampaign>("/v1/promo/broadcast", body),
    onSuccess: (c) => {
      if (c.status === "link") { setLinkMode(true); toast.info("Buka WhatsApp untuk tiap member di daftar"); }
      else { setCampaignId(c.id); toast.success(`Mengirim promo ke ${c.total} member secara bertahap…`); }
      qc.invalidateQueries({ queryKey: ["promo-draft"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const recipients = draft?.recipients ?? [];
  const last = draft?.last_campaign;
  const confirmWeekly = () => !draft?.sent_this_week || confirm("Promo sudah dikirim minggu ini. Kirim ulang ke semua member?");
  const start = (mode: PromoSendIn["mode"]) => { if (text.trim().length >= 10 && confirmWeekly()) send.mutate({ text, mode }); };
  const close = () => { setOpen(false); setLinkMode(false); setOpened([]); if (campaign?.status !== "running") setCampaignId(null); };
  const progress = campaign ? Math.round(((campaign.sent + campaign.failed) / Math.max(campaign.total, 1)) * 100) : 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-rose-50 p-5" data-testid="promo-card">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold text-orange-900"><Megaphone className="size-4" /> PROMO MEMBER MINGGU INI</h3>
          <p className="text-sm text-orange-900/80" data-testid="promo-card-stats">
            {draft?.promo_products.length ?? 0} produk promo aktif · {recipients.length} member ber-WA
          </p>
          <p className="text-xs text-muted-foreground" data-testid="promo-card-last">
            {last ? `Terakhir dikirim ${fmtDateTime(last.created_at)} oleh ${last.username}${last.status === "link" ? " (manual)" : ` · ${last.sent}/${last.total} terkirim`}` : "Belum pernah dikirim"}
            {draft?.sent_this_week && <Badge className="ml-2 bg-emerald-100 text-emerald-800">Sudah dikirim minggu ini</Badge>}
          </p>
        </div>
        <Button className="bg-orange-600 hover:bg-orange-700" onClick={() => setOpen(true)} data-testid="promo-open-button"><Send /> Kirim Promo ke Member</Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-xl" data-testid="promo-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Megaphone className="size-5 text-orange-600" /> Kirim Promo via WhatsApp</DialogTitle>
            <DialogDescription>Ke {recipients.length} member yang punya nomor WA. Tulis <code className="rounded bg-muted px-1">{"{nama}"}</code> untuk menyapa member dengan namanya.</DialogDescription>
          </DialogHeader>

          {campaign ? (
            <div className="space-y-3" data-testid="promo-progress">
              <div className="flex items-center justify-between text-sm">
                <span>{campaign.status === "running" ? "Mengirim bertahap (ada jeda antar pesan)…" : "Selesai"}</span>
                <span className="font-semibold" data-testid="promo-progress-count">{campaign.sent + campaign.failed}/{campaign.total}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-orange-100"><div className="h-full bg-orange-500 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
              <div className="flex gap-3 text-sm">
                <span className="text-emerald-700" data-testid="promo-sent-count"><CheckCircle2 className="mr-1 inline size-4" />{campaign.sent} terkirim</span>
                <span className="text-rose-700" data-testid="promo-failed-count"><XCircle className="mr-1 inline size-4" />{campaign.failed} gagal</span>
              </div>
              <div className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm">
                {campaign.results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5">
                    <span>{r.name} <span className="text-xs text-muted-foreground">{r.target}</span></span>
                    {r.ok ? <Badge className="bg-emerald-100 text-emerald-800">Terkirim</Badge> : <span className="text-xs text-rose-700">{r.reason}</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : linkMode ? (
            <div className="space-y-2" data-testid="promo-link-list">
              <p className="text-sm text-muted-foreground">Klik tiap member untuk membuka WhatsApp dengan pesan terisi ({opened.length}/{recipients.length} dibuka).</p>
              <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {recipients.map((r) => (
                  <div key={r.customer_id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>{r.name} <span className="text-xs text-muted-foreground">{r.whatsapp}</span></span>
                    <Button size="sm" variant={opened.includes(r.customer_id) ? "secondary" : "outline"} data-testid={`promo-link-${r.name}`}
                      onClick={() => { window.open(waLink(r.whatsapp, personalize(text, r.name)), "_blank", "noopener"); setOpened((o) => [...new Set([...o, r.customer_id])]); }}>
                      <ExternalLink /> {opened.includes(r.customer_id) ? "Sudah dibuka" : "Buka WA"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {draft?.sent_this_week && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="promo-weekly-warning">
                  <AlertTriangle className="size-4" /> Promo sudah dikirim minggu ini. Hindari mengirim terlalu sering agar member tidak terganggu.
                </div>
              )}
              {draft && draft.promo_products.length > 0 && (
                <div className="flex flex-wrap gap-1.5" data-testid="promo-products">
                  {draft.promo_products.map((p) => <Badge key={p.name} variant="secondary">{p.name} {rupiah(p.promo_price)}</Badge>)}
                </div>
              )}
              <Textarea rows={11} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" data-testid="promo-text-input" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{draft?.fonnte_configured ? "Dikirim otomatis via Fonnte, bertahap" : "Token Fonnte belum diatur — kirim manual lewat wa.me"}</span>
                <button className="inline-flex items-center gap-1 font-medium text-orange-700 hover:underline" onClick={() => draft && setText(draft.text)} data-testid="promo-regenerate-button"><RefreshCw className="size-3" /> Buat ulang dari produk promo</button>
              </div>
            </div>
          )}

          {!campaign && !linkMode && (
            <DialogFooter className="gap-2">
              <Button variant="outline" disabled={!recipients.length || text.trim().length < 10 || send.isPending} onClick={() => start("link")} data-testid="promo-send-link-button"><ExternalLink /> Kirim Manual (wa.me)</Button>
              {draft?.fonnte_configured && (
                <Button className="bg-orange-600 hover:bg-orange-700" disabled={!recipients.length || text.trim().length < 10 || send.isPending} onClick={() => start("fonnte")} data-testid="promo-send-fonnte-button">
                  <Send /> Kirim ke {recipients.length} Member
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
