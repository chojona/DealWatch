import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/formatters";

interface DealHeaderProps {
  dealId?: string;
  activeSection?: "overview" | "negotiation" | "knowledge" | "connections";
  name: string;
  company: string;
  property: string;
  propertyHref?: string | null;
  stage: string;
  status: string;
  estimatedValue: number | null;
  createdAt: Date;
}

const stageColors: Record<string, string> = {
  Prospect: "border-zinc-200 bg-zinc-50 text-zinc-600",
  "Market Survey": "border-blue-200 bg-blue-50 text-blue-700",
  Tour: "border-blue-200 bg-blue-50 text-blue-700",
  LOI: "border-purple-200 bg-purple-50 text-purple-700",
  Negotiation: "border-amber-200 bg-amber-50 text-amber-700",
  "Lease Execution": "border-green-200 bg-green-50 text-green-700",
  Closed: "border-green-200 bg-green-50 text-green-700",
};

export function DealHeader({
  dealId,
  activeSection = "overview",
  name,
  company,
  property,
  propertyHref,
  stage,
  status,
  estimatedValue,
  createdAt,
}: DealHeaderProps) {
  const stageClass =
    stageColors[stage] ?? "border-zinc-200 bg-zinc-50 text-zinc-600";

  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Link href="/dashboard" className="hover:text-zinc-600">
                Dashboard
              </Link>
              <span>/</span>
              <span className="text-zinc-600">{company}</span>
            </div>
            <h1 className="text-xl font-semibold text-zinc-900">{name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {propertyHref ? <Link href={propertyHref} className="text-sm text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800">{property}</Link> : <span className="text-sm text-zinc-500">{property}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${stageClass}`}
              >
                {stage}
              </span>
              <Badge variant={status === "ACTIVE" ? "default" : "secondary"}>
                {status}
              </Badge>
            </div>
            {estimatedValue && (
              <span className="text-sm font-medium text-zinc-500 tabular-nums">
                {formatCurrency(estimatedValue)}
              </span>
            )}
            <span className="text-[10px] text-zinc-400">
              Since {formatDate(createdAt)}
            </span>
          </div>
        </div>
        {dealId && (
          <nav className="mt-4 -mb-4 flex gap-5 border-t border-zinc-100 pt-3">
            <Link
              href={`/deals/${dealId}`}
              className={`border-b-2 pb-2.5 text-xs font-medium ${activeSection === "overview" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-700"}`}
            >
              Deal overview
            </Link>
            <Link
              href={`/deals/${dealId}/negotiation`}
              className={`border-b-2 pb-2.5 text-xs font-medium ${activeSection === "negotiation" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-700"}`}
            >
              Negotiation intelligence
            </Link>
            <Link
              href={`/deals/${dealId}/knowledge`}
              className={`border-b-2 pb-2.5 text-xs font-medium ${activeSection === "knowledge" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-700"}`}
            >
              Knowledge
            </Link>
            <Link
              href={`/deals/${dealId}/connections`}
              className={`border-b-2 pb-2.5 text-xs font-medium ${activeSection === "connections" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-400 hover:text-zinc-700"}`}
            >
              Connection map
            </Link>
          </nav>
        )}
      </div>
    </div>
  );
}
