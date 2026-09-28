import { Badge } from "@/components/ui/badge";
import type { ObligationStatus } from "@/types";

const statusConfig: Record<
  ObligationStatus,
  { label: string; variant: "overdue" | "waiting" | "open" | "completed" }
> = {
  OVERDUE: { label: "Overdue", variant: "overdue" },
  WAITING: { label: "Waiting", variant: "waiting" },
  OPEN: { label: "Open", variant: "open" },
  COMPLETED: { label: "Completed", variant: "completed" },
};

export function StatusBadge({ status }: { status: string }) {
  const config =
    statusConfig[status as ObligationStatus] ?? statusConfig.OPEN;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<
    string,
    { label: string; variant: "high" | "medium" | "low" }
  > = {
    HIGH: { label: "High Priority", variant: "high" },
    MEDIUM: { label: "Medium Priority", variant: "medium" },
    LOW: { label: "Low Priority", variant: "low" },
  };
  const config = map[urgency] ?? map.LOW;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
