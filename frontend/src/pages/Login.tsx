import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Store, ScanBarcode, Receipt, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/session";
import { errMsg } from "@/lib/format";

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const u = await login(username, password);
      navigate(u.role === "kasir" ? "/pos" : "/", { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-green-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-amber-500"><Store /></div>
          <span className="font-heading text-xl font-bold">WARUNG BU CUCUN</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="font-heading text-5xl font-bold leading-tight">Kasir cepat untuk warung sembako.</h1>
          <p className="mt-4 text-slate-300">Scan barcode, hitung kembalian, cetak struk thermal — semua dalam hitungan detik.</p>
          <div className="mt-10 grid gap-4">
            {[
              [ScanBarcode, "Scan barcode USB langsung ke keranjang"],
              [Boxes, "Stok otomatis berkurang & peringatan stok menipis"],
              [Receipt, "Struk thermal 58mm / 80mm"],
            ].map(([Icon, t], i) => {
              const I = Icon as typeof Store;
              return (
                <div key={i} className="flex items-center gap-3 text-sm text-slate-200">
                  <div className="grid size-9 place-items-center rounded-lg bg-white/10"><I className="size-4" /></div>
                  {t as string}
                </div>
              );
            })}
          </div>
        </div>
        <div className="relative text-xs text-slate-500">POS v1.0 · Phase 1</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" data-testid="login-form">
          <div>
            <h2 className="font-heading text-3xl font-bold">Masuk</h2>
            <p className="mt-1 text-sm text-muted-foreground">Gunakan akun admin atau kasir.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus className="h-11" data-testid="login-username-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" data-testid="login-password-input" />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="login-error">{error}</p>}
          <Button type="submit" className="h-11 w-full text-base" disabled={busy} data-testid="login-submit-button">
            {busy ? "Memproses…" : "Masuk"}
          </Button>
          <div className="flex gap-2 text-xs">
            <button type="button" className="rounded-full border px-3 py-1 hover:bg-muted" onClick={() => { setUsername("admin"); setPassword("admin123"); }} data-testid="demo-admin-chip">Demo admin</button>
            <button type="button" className="rounded-full border px-3 py-1 hover:bg-muted" onClick={() => { setUsername("kasir"); setPassword("kasir123"); }} data-testid="demo-kasir-chip">Demo kasir</button>
          </div>
        </form>
      </div>
    </div>
  );
}
