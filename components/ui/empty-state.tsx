export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="py-8">
      <h2 className="section-title">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-ink-secondary">{description}</p>
      {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
