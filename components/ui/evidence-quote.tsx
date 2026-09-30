import { cn } from "@/lib/utils";

export function EvidenceQuote({
  children,
  className,
  quote,
  citation,
}: {
  children?: React.ReactNode;
  className?: string;
  quote?: string | null;
  citation?: React.ReactNode;
}) {
  if (quote) {
    return (
      <figure className={cn("min-w-0", className)}>
        <blockquote className="break-words text-xs leading-4 text-ink">“{quote}”</blockquote>
        {citation ? (
          <figcaption className="mt-1 break-words text-[11px] leading-[15px] text-ink-muted">{citation}</figcaption>
        ) : null}
      </figure>
    );
  }

  return (
    <blockquote className={cn("border-l-2 border-brand bg-surface-subtle px-3 py-2 text-[13px] leading-5 text-ink", className)}>
      {children}
    </blockquote>
  );
}
