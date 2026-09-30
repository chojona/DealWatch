import { cn } from "@/lib/utils";

export function EvidenceQuote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <blockquote className={cn("border-l-2 border-brand bg-surface-subtle px-3 py-2 text-[13px] leading-5 text-ink", className)}>
      {children}
    </blockquote>
  );
}
