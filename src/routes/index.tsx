import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ArrowRight, BarChart3, Boxes, TrendingUp, Shield, Zap, LineChart } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FlowStock Pro — AI-powered inventory optimization" },
      { name: "description", content: "Forecast demand, calculate safety stock, and automate reorder points. The modern SaaS for SKU optimization." },
      { property: "og:title", content: "FlowStock Pro — Smart inventory optimization" },
      { property: "og:description", content: "Forecast demand, calculate safety stock, and automate reorder points." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 backdrop-blur-md bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-3">
            <Link to="/login"><Button variant="ghost" size="sm">Sign in</Button></Link>
            <Link to="/signup"><Button variant="hero" size="sm">Get started</Button></Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[var(--gradient-subtle)]" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-primary/10 blur-3xl" />
        <div className="container mx-auto px-6 py-24 md:py-32 relative">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-6 border border-primary/20">
              <Zap className="h-3 w-3" /> Real-time inventory intelligence
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground mb-6 leading-[1.05]">
              Stop guessing.<br />
              <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                Optimize every SKU.
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              FlowStock Pro forecasts demand, calculates safety stock, and tells you exactly when and how much to reorder — backed by proven inventory science.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/signup">
                <Button variant="hero" size="lg" className="gap-2 w-full sm:w-auto">
                  Start free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="outline" size="lg" className="w-full sm:w-auto">
                  Sign in
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-20 max-w-5xl mx-auto">
            <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-elegant)] overflow-hidden">
              <div className="bg-sidebar p-3 flex items-center gap-2 border-b border-sidebar-border">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                  <div className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                  <div className="h-2.5 w-2.5 rounded-full bg-success/70" />
                </div>
                <div className="text-xs text-sidebar-foreground/60 font-mono ml-2">flowstock.app/dashboard</div>
              </div>
              <div className="grid grid-cols-3 gap-4 p-6 bg-card">
                {[
                  { label: "Active SKUs", value: "1,284", icon: Boxes, color: "text-primary" },
                  { label: "To reorder", value: "37", icon: TrendingUp, color: "text-warning" },
                  { label: "Inventory value", value: "$2.4M", icon: BarChart3, color: "text-success" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border p-4 bg-background">
                    <s.icon className={`h-5 w-5 ${s.color} mb-2`} />
                    <div className="text-2xl font-bold text-foreground">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-6 py-24">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-4xl font-bold tracking-tight mb-4">Everything you need to run lean</h2>
          <p className="text-muted-foreground text-lg">Built on proven inventory science — no spreadsheets, no guesswork.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: LineChart, title: "Demand forecasting", desc: "Statistical models analyze your sales history to predict future demand with confidence intervals." },
            { icon: Shield, title: "Safety stock", desc: "Service-level driven safety stock calculations protect against stockouts during lead time variability." },
            { icon: Zap, title: "Smart reorders", desc: "Automated reorder points and quantities — respecting MOQs, lead times, and your service-level targets." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-border p-6 bg-card hover:shadow-[var(--shadow-elegant)] transition-shadow">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center mb-4">
                <f.icon className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container mx-auto px-6 py-24">
        <div className="rounded-3xl bg-gradient-to-br from-primary to-primary-glow p-12 md:p-16 text-center shadow-[var(--shadow-glow)]">
          <h2 className="text-4xl md:text-5xl font-bold text-primary-foreground mb-4">Ready to optimize?</h2>
          <p className="text-primary-foreground/80 text-lg mb-8 max-w-xl mx-auto">
            Join teams replacing Excel chaos with intelligent inventory decisions.
          </p>
          <Link to="/signup">
            <Button size="lg" variant="secondary" className="gap-2">
              Create free account <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-6 flex justify-between items-center text-sm text-muted-foreground">
          <Logo />
          <div>© {new Date().getFullYear()} FlowStock Pro</div>
        </div>
      </footer>
    </div>
  );
}
