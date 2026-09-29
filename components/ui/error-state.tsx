export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div role="alert" className="rounded-xl border border-danger/15 bg-danger-subtle px-4 py-3">
      <h2 className="text-[15px] font-semibold text-danger">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-ink">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
