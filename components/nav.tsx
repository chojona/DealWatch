import Link from "next/link";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/analyze", label: "Analyze Thread" },
];

interface NavProps {
  active?: string;
}

export function Nav({ active }: NavProps) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-12 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-zinc-900">
                DealWatch
              </span>
              <span className="rounded-sm bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                CRE
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
                    active === link.href
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-zinc-200 text-[10px] font-semibold flex items-center justify-center text-zinc-600">
              JC
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
