import { createFileRoute, Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, Boxes, LogOut, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  const nav = [
    { to: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
    { to: "/dashboard/skus", label: "SKUs", icon: Boxes },
  ];

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
        <div className="p-6 border-b border-sidebar-border"><Logo inverted /></div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => {
            const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
            return (
              <Link key={item.to} to={item.to} className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}>
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="px-3 py-2 text-xs text-sidebar-foreground/60 truncate">{user.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
