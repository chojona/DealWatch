import Link from "next/link";
import { Nav } from "@/components/nav";
import { ConnectionMap } from "@/components/connections/connection-map";
import type { ConnectionGraph } from "@/lib/graph/types";

export function EntityConnections({ graph, title, type, backHref, firm }: { graph: ConnectionGraph; title: string; type: string; backHref: string; firm: { id: string; label: string } | null }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <div className="border-b border-zinc-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{type} connection map</p>
            <h1 className="text-lg font-semibold text-zinc-950">{title}</h1>
          </div>
          <Link href={backHref} className="text-xs font-medium text-zinc-700 underline">Back to intelligence record</Link>
        </div>
      </div>
      <main className="min-h-0 flex-1"><ConnectionMap initialGraph={graph} firmCompanyId={firm?.id ?? null} firmLabel={firm?.label ?? null} /></main>
    </div>
  );
}
