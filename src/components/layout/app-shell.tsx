"use client";

import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {children}
        <RemoteLogoutButton />
      </SidebarInset>
    </SidebarProvider>
  );
}

function RemoteLogoutButton() {
  const t = useTranslations("common");
  const remote = useSyncExternalStore(
    () => () => undefined,
    () => window.location.protocol === "https:",
    () => false
  );

  if (!remote) return null;

  return (
    <button
      type="button"
      className="fixed end-4 top-3 z-40 rounded-md border border-border/70 bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
      onClick={async () => {
        await fetch("/__spent/remote/logout", {
          method: "POST",
          credentials: "same-origin",
        }).catch(() => undefined);
        // The login page is served by the HTTPS boundary, outside Next's app router.
        window.location.assign("/__spent/remote/login");
      }}
    >
      {t("logout")}
    </button>
  );
}

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-4 px-4 md:h-16 md:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger className="-ms-1 md:hidden" />
          <h1 className="truncate font-serif text-2xl leading-none tracking-tight">
            {title}
          </h1>
          {meta && (
            <>
              <span className="text-sm text-muted-foreground">·</span>
              <span className="truncate text-sm text-muted-foreground">
                {meta}
              </span>
            </>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
