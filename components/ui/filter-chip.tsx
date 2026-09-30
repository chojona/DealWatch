import { cn } from "@/lib/utils";

export function filterChipClass(selected: boolean): string {
  return cn(
    "inline-flex items-center rounded-control px-2 py-1 text-[13px] font-medium transition-colors duration-150",
    selected
      ? "bg-brand-subtle text-brand"
      : "text-ink-secondary hover:bg-surface-subtle hover:text-ink",
  );
}

export function FilterChip({
  pressed,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(filterChipClass(pressed), className)}
      {...props}
    >
      {children}
    </button>
  );
}
