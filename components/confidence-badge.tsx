import { cn } from "@/lib/utils";

export function ConfidenceDot({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium tabular-nums",
        pct >= 90
          ? "text-green-600"
          : pct >= 70
            ? "text-amber-600"
            : "text-zinc-400"
      )}
      title={`${pct}% confidence`}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          pct >= 90
            ? "bg-green-500"
            : pct >= 70
              ? "bg-amber-500"
              : "bg-zinc-300"
        )}
      />
      {pct}%
    </span>
  );
}
