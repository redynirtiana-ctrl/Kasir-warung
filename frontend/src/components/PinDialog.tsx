import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** True when the API refused an action because it needs (or got a wrong) admin PIN. */
export const needsPin = (msg: string) => msg.startsWith("Butuh PIN admin") || msg === "PIN admin salah";

/** Admin types their PIN at the cashier to approve an over-limit discount or a void on the spot. */
export default function PinDialog({ reason, onSubmit, onClose, pending }: {
  reason: string | null;
  onSubmit: (pin: string) => void;
  onClose: () => void;
  pending?: boolean;
}) {
  const [pin, setPin] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pin.length >= 4) onSubmit(pin);
  };
  return (
    <Dialog open={!!reason} onOpenChange={(o) => { if (!o) { setPin(""); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-amber-600" /> Persetujuan Admin</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="pin-reason">{reason}</p>
          <Input autoFocus type="password" inputMode="numeric" maxLength={6} placeholder="PIN admin (4–6 angka)" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="text-center font-mono text-2xl tracking-[0.5em]" data-testid="pin-input" />
          <DialogFooter><Button type="submit" disabled={pin.length < 4 || pending} className="w-full" data-testid="pin-submit-button">{pending ? "Memeriksa…" : "Setujui"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
