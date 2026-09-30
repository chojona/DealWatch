import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-chip px-2 py-1 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-surface-subtle text-ink",
        secondary: "bg-surface-subtle text-ink-secondary",
        destructive: "bg-danger-subtle text-danger",
        outline: "border border-line-strong text-ink-secondary",
        overdue: "bg-danger-subtle text-danger",
        waiting: "bg-warning-subtle text-warning",
        open: "bg-info-subtle text-info",
        completed: "bg-success-subtle text-success",
        high: "bg-danger-subtle text-danger",
        medium: "bg-warning-subtle text-warning",
        low: "bg-surface-subtle text-ink-secondary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
