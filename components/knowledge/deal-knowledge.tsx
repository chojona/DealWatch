import { EvidencePanel } from "@/components/knowledge/evidence-panel";
import type { DealKnowledge } from "@/lib/promotion/types";

function stakeLabel(predicate: string): string {
  if (predicate === "OWNS") return "Owner";
  if (predicate === "MANAGES") return "Manager";
  if (predicate === "OCCUPIES") return "Tenant";
  if (predicate === "DEVELOPED") return "Developer";
  if (predicate === "LENDS_ON") return "Lender";
  return predicate;
}

export function DealKnowledgeView({ knowledge }: { knowledge: DealKnowledge }) {
  const property = knowledge.canonical.property;
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Canonical knowledge</h2>
        <p className="mt-1 max-w-2xl text-xs text-zinc-500">
          These assertions were approved by a reviewer. Confidence alone does not add them.
        </p>
        <div className="mt-4 rounded-sm border border-zinc-200 bg-white px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Property</p>
          <h3 className="mt-1 text-base font-semibold text-zinc-900">
            {property?.name ?? knowledge.propertyLabel}
          </h3>
          {property?.address && <p className="text-xs text-zinc-500">{property.address}</p>}
          {property && <EvidencePanel evidence={property.evidence} />}
          <dl className="mt-4 space-y-3">
            {knowledge.canonical.stakes.map((stake) => (
              <div key={stake.id}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {stakeLabel(stake.predicate)}
                </dt>
                <dd className="text-sm text-zinc-900">{stake.companyName}</dd>
                <EvidencePanel evidence={stake.evidence} />
              </div>
            ))}
            {knowledge.canonical.stakes.length === 0 && (
              <p className="text-xs text-zinc-500">No approved property relationships yet.</p>
            )}
          </dl>
        </div>

        <div className="mt-4 rounded-sm border border-zinc-200 bg-white px-4 py-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">People</h3>
          {knowledge.canonical.people.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">No approved people on this deal yet.</p>
          ) : (
            <ul className="mt-3 space-y-4">
              {knowledge.canonical.people.map((person) => (
                <li key={person.personId}>
                  <p className="text-sm font-medium text-zinc-900">{person.name}</p>
                  <p className="text-xs text-zinc-500">
                    {[...person.roles, ...person.employers.map((employer) => employer.companyName)].join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-sm border border-zinc-200 bg-white px-4 py-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Deal participants</h3>
            <ul className="mt-3 space-y-3">
              {knowledge.canonical.participations.map((participation) => (
                <li key={participation.id}>
                  <p className="text-sm text-zinc-900">{participation.actorName}</p>
                  <p className="text-xs text-zinc-500">
                    {participation.roleLabel ?? participation.role.replaceAll("_", " ")}
                    {participation.representsCompanyName ? ` · represents ${participation.representsCompanyName}` : ""}
                  </p>
                  <EvidencePanel evidence={participation.evidence} />
                </li>
              ))}
              {knowledge.canonical.participations.length === 0 && (
                <li className="text-xs text-zinc-500">No approved participants.</li>
              )}
            </ul>
          </section>
          <section className="rounded-sm border border-zinc-200 bg-white px-4 py-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Employment</h3>
            <ul className="mt-3 space-y-3">
              {knowledge.canonical.employments.map((employment) => (
                <li key={employment.id}>
                  <p className="text-sm text-zinc-900">
                    {employment.personName}
                    <span className="text-zinc-400"> works at </span>
                    {employment.companyName}
                  </p>
                  <p className="text-xs text-zinc-500">{employment.affiliationKind}</p>
                  <EvidencePanel evidence={employment.evidence} />
                </li>
              ))}
              {knowledge.canonical.employments.length === 0 && (
                <li className="text-xs text-zinc-500">No approved employment.</li>
              )}
            </ul>
          </section>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900">Pending observations</h2>
        <p className="mt-1 text-xs text-zinc-500">These mentions are not canonical until a reviewer promotes them.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <ul className="rounded-sm border border-dashed border-zinc-300 bg-white px-4 py-3">
            {knowledge.pending.entities.map((entity) => (
              <li key={entity.id} className="border-b border-zinc-100 py-2 last:border-0">
                <p className="text-sm text-zinc-900">{entity.surfaceForm}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{entity.observedType}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{entity.evidenceQuote}</p>
              </li>
            ))}
            {knowledge.pending.entities.length === 0 && (
              <li className="text-xs text-zinc-500">No unresolved entity observations on this deal.</li>
            )}
          </ul>
          <ul className="rounded-sm border border-dashed border-zinc-300 bg-white px-4 py-3">
            {knowledge.pending.relationships.map((relationship) => (
              <li key={relationship.id} className="border-b border-zinc-100 py-2 last:border-0">
                <p className="text-sm text-zinc-900">{relationship.headline}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {relationship.status.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">{relationship.evidenceQuote}</p>
              </li>
            ))}
            {knowledge.pending.relationships.length === 0 && (
              <li className="text-xs text-zinc-500">No pending relationship observations on this deal.</li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
