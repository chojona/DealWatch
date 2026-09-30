export function EvidenceQuote({
  quote,
  citation,
}: {
  quote: string;
  citation?: React.ReactNode;
}) {
  return (
    <figure className="min-w-0">
      <blockquote className="break-words text-xs leading-4 text-ink">“{quote}”</blockquote>
      {citation ? (
        <figcaption className="mt-1 break-words text-[11px] leading-[15px] text-ink-muted">{citation}</figcaption>
      ) : null}
    </figure>
  );
}
