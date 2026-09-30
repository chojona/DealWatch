import { StatusChip } from "@/components/ui/status-chip";
import { toneForObligationStatus, type StatusTone } from "@/lib/ui/status-tones";
import type { ObligationStatus } from "@/types";

const statusConfig: Record<ObligationStatus, string> = {
  OVERDUE: "Overdue",
  WAITING: "Waiting",
  OPEN: "Open",
  COMPLETED: "Completed",
};

export function StatusBadge({ status }: { status: string }) {
  const label = statusConfig[status as ObligationStatus] ?? statusConfig.OPEN;
  const tone = status in statusConfig ? toneForObligationStatus(status) : toneForObligationStatus("OPEN");
  return (
    <StatusChip tone={tone} status={status}>
      {label}
    </StatusChip>
  );
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, { label: string; tone: StatusTone }> = {
    HIGH: { label: "High Priority", tone: "danger" },
    MEDIUM: { label: "Medium Priority", tone: "warning" },
    LOW: { label: "Low Priority", tone: "neutral" },
  };
  const config = map[urgency] ?? map.LOW;
  return <StatusChip tone={config.tone}>{config.label}</StatusChip>;
}
