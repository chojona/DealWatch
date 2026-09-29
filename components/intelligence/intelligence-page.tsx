import Link from "next/link";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { EvidencePanel } from "@/components/knowledge/evidence-panel";
import type { ActivityPage } from "@/lib/activity/types";
import type {
  CompanyIntelligence,
  IntelligenceAssertion,
  IntelligenceEntityRef,
  PersonIntelligence,
  PropertyIntelligence,
} from "@/lib/intelligence/types";

function EntityLink({ entity }: { entity: IntelligenceEntityRef }) {
  return (
    <Link href={entity.href} className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
      {entity.name}
    </Link>
  );
}

function validityText(assertion: IntelligenceAssertion) {
  if (!assertion.validity) return null;
  const { validFrom, validTo, current } = assertion.validity;
  if (!validFrom && !validTo) return current ? "Current" : "Historical";
  const format = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
  return `${validFrom ? format(validFrom) : "Unknown start"} – ${validTo ? format(validTo) : "present"}`;
}

function AssertionRow({ assertion, note }: { assertion: IntelligenceAssertion; note?: string }) {
  const period = validityText(assertion);
  return (
    <li className="border-b border-zinc-100 px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 text-sm text-zinc-800">
          <EntityLink entity={assertion.subject} />
          <span className="mx-1.5 text-zinc-400">{assertion.label.toLowerCase()}</span>
          <EntityLink entity={assertion.object} />
          {assertion.context && (
            <span className="text-zinc-500"> · <EntityLink entity={assertion.context} /></span>
          )}
          {assertion.representedCompany && assertion.representedCompany.id !== assertion.object.id && (
            <span className="text-zinc-500"> · represents <EntityLink entity={assertion.representedCompany} /></span>
          )}
          {assertion.detail && <p className="mt-0.5 text-xs text-zinc-500">{assertion.detail}</p>}
          {note && <p className="mt-1 text-[11px] text-amber-700">{note}</p>}
        </div>
        <div className="shrink-0 text-right">
          <span className="rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {assertion.kind.replace(/([a-z])([A-Z])/g, "$1 $2")}
          </span>
          {period && <p className="mt-1 text-[10px] text-zinc-400">{period}</p>}
        </div>
      </div>
      <EvidencePanel evidence={assertion.evidence} />
    </li>
  );
}

function Section({ title, rows, empty, note }: { title: string; rows: IntelligenceAssertion[]; empty: string; note?: string }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
        <span className="text-[10px] tabular-nums text-zinc-400">{rows.length}</span>
      </div>
      <ul className="overflow-hidden rounded-sm border border-zinc-200 bg-white">
        {rows.length ? rows.map((row) => <AssertionRow key={`${row.kind}:${row.id}:${row.label}`} assertion={row} note={note} />) : <li className="px-4 py-5 text-xs text-zinc-500">{empty}</li>}
      </ul>
    </section>
  );
}

function EvidenceSection({ rows }: { rows: IntelligenceAssertion[] }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Evidence</h2>
        <span className="text-[10px] text-zinc-400">Canonical assertions only</span>
      </div>
      <div className="space-y-2 rounded-sm border border-zinc-200 bg-white p-3">
        {rows.length ? rows.map((row) => <EvidencePanel key={`evidence:${row.kind}:${row.id}:${row.label}`} evidence={row.evidence} embedded />) : <p className="px-1 py-2 text-xs text-zinc-500">No confirmed assertions are available for evidence review yet.</p>}
      </div>
    </section>
  );
}

function Pending({ count, hrefs }: { count: number; hrefs: string[] }) {
  if (!count) return null;
  return (
    <section className="rounded-sm border border-dashed border-zinc-300 bg-white px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Pending intelligence</h2>
      <p className="mt-1 text-xs text-zinc-600">
        {count} unresolved or unpromoted {count === 1 ? "observation is" : "observations are"} associated with linked deals. These are not shown as confirmed knowledge.
      </p>
      {hrefs.length > 0 && <Link href={hrefs[0]} className="mt-2 inline-block text-xs font-medium text-zinc-900 underline">Review in Deal Knowledge</Link>}
    </section>
  );
}

function Header({ type, name, subtitle, details, connectionsHref }: { type: string; name: string; subtitle?: string | null; details: string[]; connectionsHref: string }) {
  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-6 px-6 py-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Confirmed canonical {type}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">{name}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>}
          {details.length > 0 && <p className="mt-2 text-xs text-zinc-500">{details.join(" · ")}</p>}
        </div>
        <Link href={connectionsHref} className="shrink-0 rounded-sm border border-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50">
          View connections
        </Link>
      </div>
    </div>
  );
}

export function PersonIntelligencePage({ data, activity }: { data: PersonIntelligence; activity: ActivityPage }) {
  const identifiers = [...data.person.identifiers.map((row) => `${row.kind}: ${row.value}`), ...data.person.externalIdentifiers.map((row) => `${row.scheme}: ${row.value}`)];
  return (
    <>
      <Header type="person" name={data.person.name} subtitle={data.person.primaryTitle} details={identifiers} connectionsHref={data.connectionsHref} />
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Section title="Companies" rows={data.employments} empty="No confirmed company affiliations yet." />
          <Section title="Deals" rows={data.deals} empty="No confirmed deal participation yet." />
          <Section title="Properties" rows={data.properties} empty="No direct confirmed property relationships exist in the canonical model." />
          <Section title="Relationships" rows={data.relationships} empty="No confirmed canonical relationships yet." />
          <ActivityTimeline initialPage={activity} rootType="PERSON" />
        </div>
        <aside className="space-y-6"><Pending count={data.pending.count} hrefs={data.pending.reviewHrefs} /><OriginEvidence evidence={data.origin} /><EvidenceSection rows={data.relationships} /></aside>
      </main>
    </>
  );
}

function OriginEvidence({ evidence }: { evidence: PersonIntelligence["origin"] }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Record provenance</h2>
      <div className="rounded-sm border border-zinc-200 bg-white p-3">
        <EvidencePanel evidence={evidence} embedded />
      </div>
    </section>
  );
}

export function CompanyIntelligencePage({ data, activity }: { data: CompanyIntelligence; activity: ActivityPage }) {
  const details = [data.company.legalName && data.company.legalName !== data.company.name ? data.company.legalName : null, data.company.primaryDomain, ...data.company.identifiers.map((row) => `${row.kind}: ${row.value}`), ...data.company.externalIdentifiers.map((row) => `${row.scheme}: ${row.value}`)].filter((value): value is string => Boolean(value));
  return (
    <>
      <Header type="company" name={data.company.name} subtitle={data.company.website} details={details} connectionsHref={data.connectionsHref} />
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Section title="People" rows={data.people} empty="No confirmed people affiliations yet." />
          <Section title="Deals" rows={data.deals} empty="No confirmed deal participation yet." />
          <Section title="Properties" rows={data.properties} empty="No confirmed property relationships yet." />
          <Section title="Representation" rows={data.representation} empty="No confirmed representation relationships yet." />
          <Section title="Relationships" rows={data.relationships} empty="No confirmed canonical relationships yet." />
          <ActivityTimeline initialPage={activity} rootType="COMPANY" />
        </div>
        <aside className="space-y-6"><Pending count={data.pending.count} hrefs={data.pending.reviewHrefs} /><OriginEvidence evidence={data.origin} /><EvidenceSection rows={data.relationships} /></aside>
      </main>
    </>
  );
}

export function PropertyIntelligencePage({ data, activity }: { data: PropertyIntelligence; activity: ActivityPage }) {
  const details = [data.property.assetType !== "UNKNOWN" ? data.property.assetType.replaceAll("_", " ") : null, ...data.property.externalIdentifiers.map((row) => `${row.scheme}: ${row.value}`)].filter((value): value is string => Boolean(value));
  return (
    <>
      <Header type="property" name={data.property.name} subtitle={data.property.address || null} details={details} connectionsHref={data.connectionsHref} />
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Section title="Ownership / Management" rows={data.stakes} empty="No confirmed ownership or management relationships yet." />
          <Section title="Deals" rows={data.deals} empty="No confirmed deals point to this property yet." />
          <Section title="Deal participants" rows={data.participants} empty="No confirmed participants on this property's deals yet." note="Shown through a confirmed deal; this is not a direct property relationship." />
          <Section title="Relationships" rows={data.relationships} empty="No confirmed canonical relationships yet." />
          <ActivityTimeline initialPage={activity} rootType="PROPERTY" />
        </div>
        <aside className="space-y-6"><Pending count={data.pending.count} hrefs={data.pending.reviewHrefs} /><OriginEvidence evidence={data.origin} /><EvidenceSection rows={data.relationships} /></aside>
      </main>
    </>
  );
}
