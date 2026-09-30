import { StatusChip } from "@/components/ui/status-chip";
import type { StatusTone } from "@/lib/ui/status-tones";

export type { StatusTone };

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
    <StatusChip tone={tone} className={className}>
      {children}
    </StatusChip>
  );
}
