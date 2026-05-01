import { Link } from "@tanstack/react-router";
import { Cpu } from "lucide-react";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2 group">
      <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary to-primary-glow shadow-[var(--shadow-elegant)] flex items-center justify-center">
        <Cpu className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <span className={`font-bold text-base tracking-tight ${inverted ? "text-sidebar-foreground" : "text-foreground"}`}>
        FlowStock<span className="text-primary">AI</span>
      </span>
    </Link>
  );
}
