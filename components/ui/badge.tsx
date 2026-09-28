import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-zinc-900 text-white",
        secondary: "border-transparent bg-zinc-100 text-zinc-700",
        destructive: "border-transparent bg-red-600 text-white",
        outline: "border-zinc-300 text-zinc-700",
        overdue: "border-red-200 bg-red-50 text-red-700",
        waiting: "border-amber-200 bg-amber-50 text-amber-700",
        open: "border-blue-200 bg-blue-50 text-blue-700",
        completed: "border-green-200 bg-green-50 text-green-700",
        high: "border-red-200 bg-red-50 text-red-700",
        medium: "border-amber-200 bg-amber-50 text-amber-700",
        low: "border-zinc-200 bg-zinc-50 text-zinc-600",
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
