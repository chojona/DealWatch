"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Inbox, Menu, Rows3, X } from "lucide-react";
import { GlobalSearch } from "@/components/global-search";
import { NewDealLink, primaryNav } from "@/components/nav";
import { cn } from "@/lib/utils";

const icons = {
  "/dashboard": Home,
  "/deals": Rows3,
  "/inbox": Inbox,
} as const;

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/" || pathname === "/dashboard";
  if (href === "/deals") {
    return pathname === "/deals" || (pathname.startsWith("/deals/") && pathname !== "/deals/new");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function contextLabel(pathname: string) {
  if (pathname === "/deals/new") return "New deal";
  if (pathname.startsWith("/deals/")) {
    const section = pathname.split("/")[3];
    const labels: Record<string, string> = {
      documents: "Documents",
      messages: "Messages",
      negotiation: "Negotiation",
      knowledge: "Knowledge",
      connections: "Connections",
      activity: "Activity",
    };
    return labels[section] ?? "Overview";
  }
  if (pathname.startsWith("/deals")) return "Deals";
  if (pathname.startsWith("/inbox")) return "Inbox";
  if (pathname.startsWith("/dashboard") || pathname === "/") return "Home";
  if (pathname.startsWith("/analyze")) return "Analyze";
  if (pathname.startsWith("/documents")) return "Document";
  if (pathname.startsWith("/messages")) return "Message";
  if (pathname.startsWith("/people")) return "Person";
  if (pathname.startsWith("/companies")) return "Company";
  if (pathname.startsWith("/properties")) return "Property";
  return "DealWatch";
}

function SidebarNav({ onNavigate, onClose, searchId }: { onNavigate?: () => void; onClose?: () => void; searchId: string }) {
  const pathname = usePathname();
  const creating = pathname === "/deals/new";

  return (
    <div className="flex h-full flex-col px-3 py-4">
      <div className="flex items-center justify-between gap-2 px-2.5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="text-[15px] font-semibold tracking-tight text-sidebar-text"
        >
          DealWatch
        </Link>
        {onClose ? (
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sidebar-text"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Close navigation</span>
          </button>
        ) : null}
      </div>
      <NewDealLink
        onClick={onNavigate}
        aria-current={creating ? "page" : undefined}
        className={cn(
          "mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-surface px-3 text-sm font-medium text-brand transition-colors duration-150 hover:bg-brand-subtle",
          creating && "ring-2 ring-sidebar-text/40"
        )}
      />
      <nav aria-label="Primary" className="mt-5 flex flex-col gap-1">
        {primaryNav.map((link) => {
          const active = isActive(pathname, link.href);
          const Icon = icons[link.href];
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex h-9 items-center gap-2 rounded-md px-2.5 text-sm transition-colors duration-150",
                active
                  ? "bg-sidebar-raised font-medium text-sidebar-text"
                  : "text-sidebar-muted hover:bg-white/5 hover:text-sidebar-text"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="px-2.5 pb-2 text-xs font-medium text-sidebar-muted">Search</p>
        <GlobalSearch variant="sidebar" id={searchId} />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const setOpen = (next: boolean) => setOpenPath(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPath(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar hidden h-dvh w-[232px] shrink-0 bg-sidebar lg:block">
        <SidebarNav searchId="global-search" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Open navigation</span>
          </button>
          <Link href="/dashboard" className="text-[15px] font-semibold tracking-tight text-ink">
            DealWatch
          </Link>
          <p className="ml-auto truncate text-[13px] text-ink-secondary">{contextLabel(pathname)}</p>
        </header>
        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Dismiss navigation"
              className="absolute inset-0 bg-ink/40"
              onClick={() => setOpen(false)}
            />
            <div
              id="mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="sidebar absolute inset-y-0 left-0 flex w-[240px] max-w-[85vw] flex-col bg-sidebar"
            >
              <SidebarNav searchId="mobile-global-search" onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
            </div>
          </div>
        ) : null}
        <div id="main-content" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
