import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, Package, Tags, Receipt, Users, Settings as SettingsIcon, LogOut, Menu, Store, PackagePlus, Truck, Undo2, BarChart3, Clock, Contact, Wallet, DatabaseBackup, ClipboardCheck,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { logout, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Role, Permission, User } from "@/lib/types";
import { can } from "@/lib/types";

const NAV: { to: string; label: string; icon: typeof Store; roles: Role[]; key?: string; perm?: Permission }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "kasir"] },
  { to: "/pos", label: "Kasir", icon: ShoppingCart, roles: ["admin", "kasir"], key: "F1" },
  { to: "/products", label: "Produk & Stok", icon: Package, roles: ["admin", "kasir"] },
  { to: "/categories", label: "Kategori", icon: Tags, roles: ["admin"] },
  { to: "/opname", label: "Stok Opname", icon: ClipboardCheck, roles: ["admin"] },
  { to: "/purchases", label: "Pembelian", icon: PackagePlus, roles: ["admin"] },
  { to: "/suppliers", label: "Supplier", icon: Truck, roles: ["admin"] },
  { to: "/returns", label: "Retur", icon: Undo2, roles: ["admin"], perm: "process_returns" },
  { to: "/customers", label: "Pelanggan & Hutang", icon: Contact, roles: ["admin"], perm: "receive_debt_payment" },
  { to: "/expenses", label: "Pengeluaran", icon: Wallet, roles: ["admin"] },
  { to: "/reports", label: "Laporan", icon: BarChart3, roles: ["admin"], perm: "view_reports" },
  { to: "/shifts", label: "Shift", icon: Clock, roles: ["admin", "kasir"] },
  { to: "/sales", label: "Penjualan", icon: Receipt, roles: ["admin", "kasir"] },
  { to: "/users", label: "Pengguna", icon: Users, roles: ["admin"] },
  { to: "/backup", label: "Backup", icon: DatabaseBackup, roles: ["admin"] },
  { to: "/settings", label: "Pengaturan", icon: SettingsIcon, roles: ["admin"] },
];

function SideNav({ me, onNavigate }: { me: User; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.filter((n) => n.roles.includes(me.role) || (n.perm && can(me, n.perm))).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === "/"}
          onClick={onNavigate}
          data-testid={`nav-${n.to === "/" ? "dashboard" : n.to.slice(1)}`}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
              isActive ? "bg-sidebar-primary text-white shadow-sm" : "text-slate-300 hover:bg-sidebar-accent hover:text-white",
            )
          }
        >
          <n.icon className="size-4" />
          <span className="flex-1">{n.label}</span>
          {n.key && <kbd className="rounded bg-white/10 px-1.5 font-mono text-[10px]">{n.key}</kbd>}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppLayout() {
  const { data: me, isLoading, isError } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        navigate("/pos");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  if (isLoading) return <div className="grid h-screen place-items-center text-muted-foreground">Memuat…</div>;
  if (isError || !me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const doLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const brand = (
    <div className="flex items-center gap-3 px-5 py-5">
      <div className="grid size-10 place-items-center rounded-xl bg-amber-500 text-white shadow-md">
        <Store className="size-5" />
      </div>
      <div>
        <div className="font-heading text-base font-bold leading-tight text-white">WARUNG BU CUCUN</div>
        <div className="text-[11px] text-slate-400">Kasir & Toko Sembako</div>
      </div>
    </div>
  );
  const userBox = (
    <div className="mt-auto border-t border-sidebar-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white" data-testid="current-user-name">{me.full_name}</div>
          <Badge className="mt-1 bg-amber-500/20 text-amber-300" data-testid="current-user-role">{me.role === "admin" ? "Admin / Owner" : "Kasir"}</Badge>
        </div>
      </div>
      <Button variant="ghost" className="w-full justify-start text-slate-300 hover:bg-sidebar-accent hover:text-white" onClick={doLogout} data-testid="logout-button">
        <LogOut className="size-4" /> Keluar
      </Button>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar lg:flex">
        {brand}
        <SideNav me={me} />
        {userBox}
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-64 flex-col bg-sidebar p-0 text-white">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {brand}
          <SideNav me={me} onNavigate={() => setOpen(false)} />
          {userBox}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b bg-white px-4 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} data-testid="mobile-menu-button">
            <Menu />
          </Button>
          <span className="font-heading font-bold text-green-800">WARUNG BU CUCUN</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div key={location.pathname} className="h-full animate-fade-up">
            <Outlet context={me} />
          </div>
        </main>
      </div>
      <Toaster richColors />
    </div>
  );
}
