import Link from "next/link";

export function SourceLink({
  href,
  label = "View source",
}: {
  href: string | null;
  label?: string;
}) {
  if (!href) {
    return <span className="text-[13px] text-ink-muted">Source link unavailable</span>;
  }
  return (
    <Link href={href} className="source-link">
      {label}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
