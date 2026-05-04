import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { LocaleProvider } from "@/hooks/use-locale";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "FlowStock Pro — Smart inventory optimization" },
      { name: "description", content: "Forecast demand, calculate safety stock, and automate reorder points. The modern SaaS for SKU optimization." },
      { name: "author", content: "FlowStock Pro" },
      { property: "og:title", content: "FlowStock Pro — Smart inventory optimization" },
      { property: "og:description", content: "Forecast demand, calculate safety stock, and automate reorder points." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "FlowStock Pro" },
      { name: "twitter:description", content: "Smart inventory optimization for modern teams." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e24becd0-8e33-471a-aee3-bea8217cd3e0/id-preview-07d914d9--daa35126-5727-4b5b-9142-e77ef15b1208.lovable.app-1777424963539.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e24becd0-8e33-471a-aee3-bea8217cd3e0/id-preview-07d914d9--daa35126-5727-4b5b-9142-e77ef15b1208.lovable.app-1777424963539.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <LocaleProvider>
      <Outlet />
      <Toaster />
    </LocaleProvider>
  );
}
