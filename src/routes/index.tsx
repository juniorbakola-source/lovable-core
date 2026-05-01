import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { ArrowRight, Cpu, TrendingUp, Sparkles, Shield, Zap, Boxes } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FlowStockAI — Optimisation intelligente des stocks" },
      { name: "description", content: "Prévision de demande, calcul du stock de sécurité, automatisation des bons de commande. Le SaaS multi-tenant pour optimiser chaque SKU." },
      { property: "og:title", content: "FlowStockAI — Optimisation intelligente des stocks" },
      { property: "og:description", content: "Prévision de demande, calcul du stock de sécurité, automatisation des bons de commande." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 backdrop-blur-md bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-3">
            <Link to="/login" className="px-3 py-1.5 text-sm text-foreground/80 hover:text-foreground">Connexion</Link>
            <Link to="/signup" className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-bold text-sm hover:shadow-[var(--shadow-elegant)] transition-all">
              Démarrer
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[var(--gradient-subtle)]" />
        <div className="container mx-auto px-6 py-24 md:py-32 relative">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono font-bold mb-6 border border-primary/20">
              <Zap className="h-3 w-3" /> Intelligence inventaire temps réel
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-[1.05]">
              Stop aux ruptures.<br />
              <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                Optimise chaque SKU.
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              FlowStockAI prévoit ta demande, calcule le stock de sécurité, et te dit exactement quand et combien commander — propulsé par un moteur IA.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/signup" className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-primary to-primary-glow text-primary-foreground font-bold hover:shadow-[var(--shadow-elegant)] transition-all">
                Créer un compte gratuit <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login" className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-border bg-card hover:border-primary/40 transition-all">
                Connexion
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-6 py-24">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-4xl font-bold tracking-tight mb-4">Tout pour piloter ton stock</h2>
          <p className="text-muted-foreground text-lg">Bâti sur la science éprouvée de l'inventaire — fini Excel, fini les approximations.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: TrendingUp, title: "Prévision IA", desc: "Modèles statistiques + agents IA pour prédire ta demande à 30 jours avec intervalle d'incertitude." },
            { icon: Shield, title: "Stock de sécurité", desc: "Calcul piloté par le niveau de service, qui te protège contre les ruptures pendant le délai de livraison." },
            { icon: Cpu, title: "Solveur Engine", desc: "Réapprovisionnement automatique respectant MOQ, lead times et tes objectifs de service." },
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

      <section className="container mx-auto px-6 pb-24">
        <div className="rounded-3xl bg-gradient-to-br from-primary to-primary-glow p-12 md:p-16 text-center shadow-[var(--shadow-glow)]">
          <h2 className="text-4xl md:text-5xl font-bold text-primary-foreground mb-4">Prêt à optimiser ?</h2>
          <p className="text-primary-foreground/80 text-lg mb-8 max-w-xl mx-auto">
            Rejoins les équipes qui remplacent le chaos Excel par des décisions intelligentes.
          </p>
          <Link to="/signup" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-background text-foreground font-bold hover:scale-105 transition-transform">
            <Sparkles className="h-4 w-4" /> Commencer maintenant
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-6 flex justify-between items-center text-sm text-muted-foreground">
          <Logo />
          <div className="font-mono text-xs">© {new Date().getFullYear()} FlowStockAI · v1.0.0-standalone</div>
        </div>
      </footer>
    </div>
  );
}

void Boxes;
