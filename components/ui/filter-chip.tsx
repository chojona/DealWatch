import { cn } from "@/lib/utils";

/**
 * Compact selected-state control for filters and round choices.
 * Selected state uses brand green. Unselected stays on the light surface.
 */
export function FilterChip({
  pressed,
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(
        "rounded-md px-2 py-1 text-[13px] font-medium leading-[18px]",
        pressed
          ? "bg-brand text-white"
          : "bg-transparent text-ink-secondary hover:bg-surface-subtle hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}
