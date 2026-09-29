import Link from "next/link";
import { GlobalSearch } from "@/components/global-search";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/dashboard", label: "Home" },
  { href: "/deals", label: "Deals" },
  { href: "/inbox", label: "Inbox" },
];

interface NavProps {
  active?: string;
}

export function Nav({ active }: NavProps) {
  return (
    <aside className="app-nav" aria-label="DealWatch">
      <div className="flex items-center justify-between gap-3 md:block">
        <Link href="/dashboard" className="text-[15px] font-semibold tracking-tight text-white">
          DealWatch
        </Link>
        <Link
          href="/deals/new"
          className="inline-flex h-8 items-center rounded-md bg-white px-2.5 text-xs font-semibold text-[#16323a] hover:bg-[#e7f3f4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:mt-4 md:w-full md:justify-center"
        >
          New deal
        </Link>
      </div>
      <nav className="flex gap-1 overflow-x-auto md:mt-6 md:flex-col" aria-label="Primary">
        {navLinks.map((link) => {
          const current = active === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                current ? "bg-white/15 text-white" : "text-[#c5d5d8] hover:bg-white/10 hover:text-white"
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto min-w-[9rem] max-w-xs flex-1 md:ml-0 md:mt-6 md:max-w-none">
        <GlobalSearch />
      </div>
    </aside>
  );
}
