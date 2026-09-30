import { Status, type StatusTone } from "@/components/ui/status";

const kinds = {
  "needs-you": { label: "Needs you", tone: "warning" },
  waiting: { label: "Waiting on them", tone: "info" },
  both: { label: "Both sides", tone: "warning" },
  clear: { label: "Nothing outstanding", tone: "success" },
  unclear: { label: "Not clear yet", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: StatusTone }>;

export type ActionStateKind = keyof typeof kinds;

export function ActionState({
  kind,
  summary,
  who,
  when,
  source,
}: {
  kind: ActionStateKind;
  summary: string;
  who?: string;
  when?: string;
  source?: React.ReactNode;
}) {
  const meta = [who, when].filter(Boolean).join(" · ");
  const state = kinds[kind];
  return (
    <div>
      <Status tone={state.tone}>{state.label}</Status>
      <p className="mt-2 text-sm font-semibold leading-snug text-ink">{summary}</p>
      {meta ? <p className="mt-1 text-[13px] text-ink-secondary">{meta}</p> : null}
      {source ? <div className="mt-2">{source}</div> : null}
    </div>
  );
}
