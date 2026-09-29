export function SectionHeader({
  title,
  description,
  action,
  as = "h2",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  as?: "h1" | "h2";
}) {
  const Title = as;
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <Title className={as === "h1" ? "page-title" : "section-title"}>{title}</Title>
        {description ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
