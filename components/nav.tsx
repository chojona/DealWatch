import type { ComponentProps } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

export const primaryNav = [
  { href: "/dashboard", label: "Home" },
  { href: "/deals", label: "Deals" },
  { href: "/inbox", label: "Inbox" },
] as const;

export function NewDealLink({ className, ...props }: Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link className={className} {...props} href="/deals/new">
      <Plus className="h-4 w-4" aria-hidden="true" />
      New deal
    </Link>
  );
}
