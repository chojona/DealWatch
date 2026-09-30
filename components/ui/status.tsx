import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-surface-subtle text-ink-secondary",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
  brand: "bg-brand-subtle text-brand",
} as const;

export type StatusTone = keyof typeof tones;

export function Status({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-[15px]", tones[tone], className)}>
      {children}
    </span>
  );
}
