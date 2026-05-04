import { createFileRoute, Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/hooks/use-locale";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3,
  Package,
  TrendingUp,
  Cpu,
  Sliders,
  FileText,
  Settings,
  Menu,
  X,
  LogOut,
  User,
  Building,
  BookOpen,
  Zap,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

type MenuItem = {
  to:
    | "/dashboard"
    | "/dashboard/skus"
    | "/dashboard/silvery"
    | "/dashboard/connectors"
    | "/dashboard/forecasting"
    | "/dashboard/solver"
    | "/dashboard/whatif"
    | "/dashboard/pos"
    | "/dashboard/settings"
    | "/dashboard/methodologie";
  labelKey: string;
  icon: typeof BarChart3;
  exact?: boolean;
};

const MENU: MenuItem[] = [
  { to: "/dashboard", labelKey: "nav.overview", icon: BarChart3, exact: true },
  { to: "/dashboard/skus", labelKey: "nav.skus", icon: Package },
  { to: "/dashboard/silvery", labelKey: "nav.silvery", icon: Zap },
  { to: "/dashboard/connectors", labelKey: "nav.connectors", icon: Plug },
  { to: "/dashboard/forecasting", labelKey: "nav.forecasting", icon: TrendingUp },
  { to: "/dashboard/solver", labelKey: "nav.solver", icon: Cpu },
  { to: "/dashboard/whatif", labelKey: "nav.whatif", icon: Sliders },
  { to: "/dashboard/pos", labelKey: "nav.pos", icon: FileText },
  { to: "/dashboard/methodologie", labelKey: "nav.methodology", icon: BookOpen },
  { to: "/dashboard/settings", labelKey: "nav.settings", icon: Settings },
];

function DashboardLayout() {
  const { user, loading } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-muted-foreground">
        <Cpu className="h-10 w-10 text-primary animate-spin mb-4" />
        <span className="font-mono text-xs">Chargement du moteur FlowStockAI…</span>
      </div>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Déconnexion réussie");
    navigate({ to: "/" });
  }

  const activeLabel =
    MENU.find((m) => (m.exact ? location.pathname === m.to : location.pathname.startsWith(m.to)))
      ?.labelKey ?? "Dashboard";
  const activeLabel = activeKey ? t(activeKey) : "Dashboard";

  const orgName = (user.user_metadata?.company as string | undefined) ?? "Mon Organisation";
  const initials = (user.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* SIDEBAR DESKTOP */}
      <aside className="hidden lg:flex flex-col w-64 bg-sidebar border-r border-sidebar-border flex-shrink-0">
        <div className="h-16 flex items-center gap-2 border-b border-sidebar-border px-6">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
            <Cpu className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="text-base font-bold tracking-tight text-sidebar-foreground">
            FlowStock<span className="text-primary">AI</span>
          </span>
        </div>

        <div className="px-6 py-4 border-b border-sidebar-border bg-sidebar-accent/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-sidebar-accent border border-sidebar-border flex items-center justify-center text-sidebar-foreground font-bold font-mono text-xs">
              {initials}
            </div>
            <div className="overflow-hidden">
              <h4 className="text-xs font-bold text-sidebar-foreground truncate">{user.email}</h4>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <Building className="h-3 w-3" /> {orgName}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {MENU.map((item) => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium border transition-all",
                  active
                    ? "bg-sidebar-accent border-sidebar-border text-primary font-bold"
                    : "bg-transparent border-transparent text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40",
                )}
              >
                <Icon
                  className={cn("h-4 w-4", active ? "text-primary" : "text-sidebar-foreground/50")}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border space-y-2">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-colors"
          >
            <LogOut className="h-4 w-4" /> Déconnexion
          </button>
          <div className="text-[10px] text-muted-foreground font-mono text-center">
            v1.0.0-standalone © 2026
          </div>
        </div>
      </aside>

      {/* MOBILE HEADER */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-sidebar border-b border-sidebar-border flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center">
            <Cpu className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-bold text-sidebar-foreground">
            FlowStock<span className="text-primary">AI</span>
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-1.5 rounded-lg border border-sidebar-border text-sidebar-foreground/70 bg-sidebar-accent/40"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div onClick={() => setMobileOpen(false)} className="fixed inset-0 bg-black/80" />
          <aside className="relative flex flex-col w-64 bg-sidebar border-r border-sidebar-border h-full">
            <div className="h-14 flex items-center border-b border-sidebar-border px-4">
              <span className="text-sm font-bold text-sidebar-foreground">FlowStockAI Menu</span>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {MENU.map((item) => {
                const active = item.exact
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium border transition-all",
                      active
                        ? "bg-sidebar-accent border-sidebar-border text-primary font-bold"
                        : "bg-transparent border-transparent text-sidebar-foreground/70 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <button
              onClick={signOut}
              className="m-3 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-colors border border-sidebar-border"
            >
              <LogOut className="h-4 w-4" /> Déconnexion
            </button>
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col min-h-screen pt-14 lg:pt-0 overflow-x-hidden">
        <header className="hidden lg:flex h-16 items-center justify-between border-b border-border px-8 bg-background/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="text-sm font-bold text-foreground">{activeLabel}</div>
          <div className="text-[11px] font-mono font-bold text-muted-foreground flex items-center gap-2 bg-card px-3 py-1.5 border border-border rounded-lg">
            <User className="h-3 w-3 text-primary" /> {user.email}
            <span className="text-muted-foreground/60">@</span>
            <Building className="h-3 w-3 text-muted-foreground" /> {orgName}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
