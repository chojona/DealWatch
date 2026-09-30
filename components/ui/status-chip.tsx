import { cn } from "@/lib/utils";
import {
  statusToneClass,
  toneForNegotiationStatus,
  type StatusTone,
} from "@/lib/ui/status-tones";

export function StatusChip({
  tone,
  status,
  children,
  className,
}: {
  tone?: StatusTone;
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const resolved = tone ?? (status ? toneForNegotiationStatus(status) : "neutral");
  return (
    <span
      data-status={status}
      data-tone={resolved}
      className={cn(
        "inline-flex items-center rounded-chip px-2 py-1 text-xs font-medium",
        statusToneClass[resolved],
        className,
      )}
    >
      {children}
    </span>
  );
}
