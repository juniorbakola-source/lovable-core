import { Link } from "@tanstack/react-router";

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2 group">
      <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-primary-glow shadow-[var(--shadow-elegant)] flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
          <path d="M3 7l9 4 9-4M12 11v10" opacity="0.6" />
        </svg>
      </div>
      <span className={`font-bold text-lg tracking-tight ${inverted ? "text-sidebar-foreground" : "text-foreground"}`}>
        FlowStock<span className="text-primary">Pro</span>
      </span>
    </Link>
  );
}
