# Phase 6A — Entity intelligence and relationship ontology

Architecture only. This document does not authorize schema migrations,
extraction, entity resolution, graph visualization, or changes to negotiation
evaluation.

DealWatch already separates a negotiation **observation** (`NegotiationTerm`,
with page-level evidence) from **resolved deal state** (`resolveStructuredState`).
The knowledge graph uses the same split:

```text
Document / DocumentPage / Message
        ↓
EntityObservation  +  RelationshipObservation     (immutable evidence)
        ↓
EntityResolutionLink                               (which canonical entity)
        ↓
Person | Company | Property | Deal
Employment | PropertyStake | DealParticipation     (canonical assertions)
        ↓
graph_edge view                                    (query shape, not storage)
```

An extractor that reads "Sarah Chen, Senior Vice President, CBRE" writes
observations. It does not insert `Sarah Chen WORKS_AT CBRE` into the
canonical graph.

## 1. Current DealWatch architecture relevant to the graph

SQLite via Prisma 6. There is no workspace, user, or firm tenant. Every row
in the database is visible to every reader of that file.

### What exists

| Model | Graph-relevant shape |
| --- | --- |
| `Deal` | `name`, free-text `company`, free-text `property`, `stage`, `status`. No foreign keys to parties or buildings. |
| `Thread` / `Message` | `participants`, `sender`, and `recipients` are JSON strings or display strings such as `Sarah Chen <s.chen@jllboston.com>`. Not entities. |
| `Obligation` / `DealEvent` | Free-text `owner` / `counterparty`. Own `evidenceQuote` and a float `confidence`. Not page-linked. |
| `Document` | First-class file on a deal. Comment in `schema.prisma` already says a later phase may attach entity observations to the same pages, and that this model stores no Person, Company, or Property ids. `documentDate` and `negotiationSide` are document metadata. |
| `DocumentPage` | Stable id, `pageNumber`, extracted `text`. Unique `(documentId, pageNumber)`. |
| `NegotiationRound` | Optional `documentId`. Still stores full `documentText`. |
| `NegotiationTerm` | Evidence fields: `evidenceQuote`, `sourceLocation`, `documentPageId`, `evidenceStartOffset`, `evidenceEndOffset`, `provenanceStatus` (`EXACT` / `AMBIGUOUS` / `UNLOCATED`). `structuredPayload` is CRE term semantics only. |

`lib/documents/locateEvidence.ts` is the provenance rule: a quote is `EXACT`
only when it is a unique substring of one page. Ambiguous and missing quotes
do not get a page id. `attachEvidenceProvenance` drops model-supplied page
claims.

`lib/ai/negotiation/payloads.ts` forbids Person, Company, Property, Deal, and
Document ids inside structured term payloads. Free text inside a payload may
mention a party name; that string is not an entity reference. This ontology
does not relax that rule.

`Deal.company` and `Deal.property` are labels for the dashboard and analyzer
("200 Clarendon Lease — Acme Corp", property `"200 Clarendon Street, Boston MA"`).
Landlord, broker, and brokerage exist only inside document text, thread
strings, and obligation counterparty strings. Seed data already contains the
relationships this graph must eventually represent (Sarah Chen at JLL
representing Acme; Derek Hollis at Boston Properties) without storing them
as entities.

### What this phase does not redesign

Negotiation extraction, term catalog, structured payloads, round state
resolution, V1/V2 evals, document ingestion, and PDF storage stay as they
are. Entity observations cite `Document` and `DocumentPage`. They do not
cite `NegotiationTerm` as their provenance parent. A term and an entity
observation can share a page; neither embeds the other's id.

## 2. Design principles

1. **Truth is not the model's last sentence.** Observations are evidence.
   Canonical rows are assertions DealWatch is willing to answer with.
2. **Every assertion can answer "why?".** The path is canonical row →
   support join → observation → document page → quote and offsets.
3. **Observations are immutable.** Corrections are new rows plus an
   append-only supersession or disposition record.
4. **Roles are contextual.** "Landlord" and "tenant broker" are facts about
   a deal (or a time-bounded stake), not a permanent company type.
5. **Deal stays Deal.** It is already the deal node. It is not copied into
   a generic entity table.
6. **Typed tables where integrity matters.** Person, Company, and Property
   have different identity keys. Employment and property stakes have
   different endpoints. One generic `Entity` / `Relationship` table would
   make those constraints optional.
7. **Shared tables where the shape is the same.** Provenance columns are
   identical for every mention, so observations are shared and
   discriminated by `observedType`.
8. **The graph is a read model.** Storage is relational. Path queries use
   a SQL view over the canonical tables. No graph database.
9. **Workspace isolation is structural.** Private CRE intelligence is
   per firm. The same real-world CBRE in two workspaces is two `Company`
   rows. Nothing in the schema joins them.
10. **Unknown is null.** Missing `validFrom` means the start is unknown.
    It does not mean "since the document was written" and it does not mean
    "forever."
11. **Confidence is not a probability.** Scores are extractor or reviewer
    signals stored beside the evidence. They are not multiplied into a
    truth probability.
12. **Resolution is reversible.** Merges keep both ids. Observations are
    re-pointed by new resolution links, not by rewriting evidence.

## 3. Canonical entity model

Four node kinds. Three are new tables. Deal is the existing model.

### Recommendation: dedicated tables, not a generic `Entity`

A generic node (`Entity` with `type = PERSON | COMPANY | PROPERTY | DEAL`)
is a worse fit for this product than dedicated tables.

Dedicated `Person`, `Company`, and `Property` tables are better because:

- Identity keys differ. A person is resolved later by email, phone, and
  name-in-company context. A company is resolved by legal name, alias, and
  domain. A property is resolved by address and building alias. A single
  attribute JSON bag hides which fields are required for which type.
- Prisma relations and SQL foreign keys can be real. `Employment.personId`
  references `Person`, not "whatever this entity id points at."
- Invalid graphs become insert failures. A person cannot `OWNS` a property
  through the employment table.
- Queries the product actually asks ("people at CBRE", "owners of this
  building") are single-table filters plus one join.
- Deal already has a rich table (rounds, documents, obligations). Forcing
  it through a generic entity would duplicate it or leave a permanent
  special case anyway.

A generic `Entity` table is attractive only as a union key for edges. That
need is met by a **query view** (`graph_edge`) and by typing each edge
family, not by erasing the domain tables.

Shared generic tables are used where the row shape really is generic:
`EntityObservation`, `RelationshipObservation`, aliases, external ids,
merges, and resolution links. Those rows exist before, and outside, the
canonical type's identity rules.

Deal is not given a twin `Entity` row. Graph queries treat `Deal.id` as a
node id in the view.

### Person

| Field | Notes |
| --- | --- |
| `id` | cuid, stable across merges |
| `workspaceId` | required |
| `canonicalName` | display name, reviewer-controlled after resolution |
| `firstName`, `middleName`, `lastName` | nullable; populated when known, never parsed destructively from `canonicalName` as the only copy |
| `primaryTitle` | latest known title for display; historical titles live on `Employment.titleAtTime` and on observations |
| `status` | `ACTIVE`, `INACTIVE`, `MERGED` |
| `mergedIntoPersonId` | set when `status = MERGED`; the survivor is the row queries use |

No `linkedinUrl` column on day one. A later LinkedIn URL is an
`ExternalIdentifier` or `PersonIdentifier` of kind `LINKEDIN`, so it can
be evidenced and corrected without a schema change.

Email and phone are **not** single columns. People have several, and each
one is itself evidence. See `PersonIdentifier`.

### Company

| Field | Notes |
| --- | --- |
| `id` | cuid |
| `workspaceId` | required |
| `canonicalName` | display name ("CBRE", "JLL") |
| `legalName` | nullable ("CBRE, Inc.") |
| `website` | nullable |
| `primaryDomain` | nullable, normalized host (`cbre.com`); a convenience copy of one identifier, not the only domain |
| `status` | `ACTIVE`, `INACTIVE`, `MERGED` |
| `mergedIntoCompanyId` | same merge pattern as Person |

**Company category is not an intrinsic type.** Do not add
`Company.kind = OWNER | LANDLORD | TENANT | BROKERAGE | ...`.

The same organization is a landlord on one deal, a tenant on another, and
a brokerage on a third. Boston Properties is a landlord because it takes
the `LANDLORD` role on a deal or holds an `OWNS` stake in a property, not
because a column says so. CBRE is a brokerage because people `WORKS_AT`
it and it takes `TENANT_BROKERAGE` / `LANDLORD_BROKERAGE` participations.

A later, non-exclusive label ("this organization operates a brokerage
business") can be a derived count of participations. It is not in Phase 6.

### Property

| Field | Notes |
| --- | --- |
| `id` | cuid |
| `workspaceId` | required |
| `canonicalName` | display name, which may be a building name ("John Hancock Tower") or a street address |
| `addressLine1`, `addressLine2`, `city`, `region`, `postalCode`, `country` | structured address; any part may be null |
| `assetType` | `OFFICE`, `RETAIL`, `INDUSTRIAL`, `MULTIFAMILY`, `MIXED_USE`, `LAND`, `OTHER`, `UNKNOWN` |
| `status` | `ACTIVE`, `INACTIVE`, `MERGED` |
| `mergedIntoPropertyId` | same merge pattern |

`region` holds a US state or other first-level region. Naming it `state`
collides with status in application code.

"200 Clarendon", "200 Clarendon Street", and "John Hancock Tower" are
three surface forms. They become one `Property` only when resolution says
so. Until then they are separate observations, and after a confirmed merge
they are `PropertyAlias` rows on the survivor. Aliases are a **result** of
resolution, not the resolution algorithm.

### Deal

Keep the current `Deal` model, including string `company` and `property`,
through Phase 6B. Add:

| Field | Notes |
| --- | --- |
| `workspaceId` | required after backfill to the default workspace |
| `propertyId` | nullable FK to `Property`; the primary building this deal concerns |

`propertyId` is the canonical "deal concerns property" edge. A relationship
row would duplicate a fact the product already models as one building per
deal (dashboard, seed, and analyzer all assume a single property string).

Do not add `Deal.companyId`. The string `company` is the client's display
label. Parties, including that client, belong in `DealParticipation`.
Replacing the string is a UI migration, not an ontology requirement.

Multi-building deals are not in the current product. If one appears later,
add a `DealProperty` join and keep `propertyId` as the primary. Do not add
that join now.

### Identifiers and aliases

Aliases support display and future lookup. They are not the resolution
engine.

```text
PersonAlias        (personId, alias, normalizedAlias, workspaceId)
CompanyAlias       (companyId, alias, normalizedAlias, workspaceId)
PropertyAlias      (propertyId, alias, normalizedAlias, workspaceId)

PersonIdentifier   (personId, kind, value, normalizedValue, workspaceId)
CompanyIdentifier  (companyId, kind, value, normalizedValue, workspaceId)
ExternalIdentifier (workspaceId, scheme, value, exactly one entity FK)
```

`PersonIdentifier.kind`: `EMAIL`, `PHONE`, `LINKEDIN`.

`CompanyIdentifier.kind`: `DOMAIN`, `EMAIL_DOMAIN`. `DOMAIN` is a website
host. `EMAIL_DOMAIN` is observed on a person's address (`jllboston.com`)
and is a weak signal, stored only when a reviewer or a future rule copies
it. Phase 6B creates the table and does not infer domains from addresses.

`ExternalIdentifier.scheme` is an open string (`COST_AR`, `REGRID`, …).
Unique `(workspaceId, scheme, value)`. Phase 6B creates the table empty.
No provider integration.

`normalizedAlias` / `normalizedValue` use the light normalizer in §12.
Uniqueness is per workspace, per parent entity, on the normalized form.

### Workspace

```text
Workspace
  id
  name
  firmCompanyId   nullable FK → Company in the same workspace
  createdAt
```

`firmCompanyId` marks which `Company` is the firm that owns the workspace,
once that company exists. It is nullable because Phase 6B does not resolve
"our firm" from deal strings. Queries that mean "counterparties" exclude
this id when it is set. Until it is set, every deal in the workspace is
still "a deal this firm is working," because the workspace itself is the
firm boundary.

## 4. Entity observation model

`EntityObservation` is one table. The evidence shape does not vary by
type: a surface form, optional attributes, a source, a quote, offsets,
an extractor identity, and an extraction score. Splitting it into
`PersonObservation` / `CompanyObservation` / `PropertyObservation` would
copy the provenance columns three times and force relationship
observations to point at three nullable FKs.

The canonical tables stay dedicated. The observation table stays shared.
That is the boundary.

An observation is a **mention**, not an entity. Seventeen pages that say
"Sarah Chen" are seventeen observations. They may later resolve to one
`Person`.

### Columns

| Field | Mutability | Notes |
| --- | --- | --- |
| `id` | immutable | |
| `workspaceId` | immutable | must match the source deal's workspace |
| `observedType` | immutable | `PERSON`, `COMPANY`, `PROPERTY` |
| `surfaceForm` | immutable | as written: `Sarah Chen` |
| `normalizedName` | immutable | light normalizer, §12 |
| `title` | immutable | nullable, person mentions |
| `email` | immutable | nullable |
| `phone` | immutable | nullable |
| `domain` | immutable | nullable, company mentions |
| `addressLine1`, `city`, `region`, `postalCode`, `country` | immutable | nullable, property mentions; raw components the extractor emitted, not a geocode |
| `rawAttributes` | immutable | JSON overflow for fields without a column; never read as truth |
| `sourceKind` | immutable | `DOCUMENT_PAGE`, `MESSAGE`, `MANUAL` |
| `dealId` | immutable | required for `DOCUMENT_PAGE` and `MESSAGE`; nullable only for `MANUAL` |
| `documentId` | immutable | required for `DOCUMENT_PAGE` |
| `documentPageId` | immutable | nullable; set only for `EXACT` provenance, same rule as terms |
| `messageId` | immutable | required for `MESSAGE`; extraction from threads is not in 6B, the FK is |
| `evidenceQuote` | immutable | required, including manual entry (the analyst quotes what they relied on) |
| `evidenceStartOffset`, `evidenceEndOffset` | immutable | nullable |
| `provenanceStatus` | immutable | reuse `EvidenceProvenanceStatus` |
| `sourceLocation` | immutable | nullable section label, same meaning as on terms |
| `extractionConfidence` | immutable | nullable float; see §11 |
| `extractor` | immutable | e.g. `manual`, `phase7.entity-extractor` |
| `extractorVersion` | immutable | model or rule version string |
| `createdAt` | immutable | this is **extraction time** / record time |

No `updatedAt`. No canonical FK on this row.

Attribute columns are nullable for every type. A company observation must
not be rejected by the database for having a null `title`. Application
validation on insert: `PERSON` may fill `title`, `email`, `phone`;
`COMPANY` may fill `domain`; `PROPERTY` may fill address parts. Filled
columns that contradict `observedType` are an application error. A SQL
`CHECK` can enforce the cheap half (`COMPANY` has null person fields, and
so on) and is specified in §15.

### Disposition, supersession, resolution

These are separate append-only tables so the observation never changes.

```text
ObservationDisposition
  id
  entityObservationId     nullable
  relationshipObservationId nullable
  disposition               ACCEPTED | REJECTED
  actor                     USER | SYSTEM
  note                      nullable
  createdAt
```

Exactly one observation FK. The current disposition is the latest row.
No row means `PENDING`. `REJECTED` keeps the evidence and blocks promotion.

```text
ObservationSupersession
  id
  priorEntityObservationId          nullable
  successorEntityObservationId      nullable
  priorRelationshipObservationId    nullable
  successorRelationshipObservationId nullable
  createdAt
```

A re-run of an extractor inserts new observations and one supersession
row. Readers that want "current extraction" ignore priors that appear as
`prior*`. The prior remains for audit. Phase 6B does not run extractors.

Canonical linkage is `EntityResolutionLink` (§12), also append-only.

### What is in Phase 6 versus later

Phase 6B creates these tables and the constraints. It does not extract,
does not populate observations from existing deals, and does not resolve
them. Manual insert is allowed by the schema (`sourceKind = MANUAL`) so
Phase 7 and a later review UI have a place to write. Phase 6B does not
add that UI.

## 5. Relationship vocabulary

Two families. They are not interchangeable.

### Family A — durable binary assertions

These can be true outside any one deal, for an interval that may be
unknown.

**Employment** (`Person` → `Company`), predicate `WORKS_AT`.

Qualifiers, not extra predicates:

| `affiliationKind` | Meaning |
| --- | --- |
| `UNKNOWN` | the text only affiliates the person with the firm |
| `STAFF` | employee, no stronger claim |
| `BROKER` | practicing broker at that firm |
| `EXECUTIVE` | officer / principal / "SVP" class title is a hint, not an automatic mapping |
| `FOUNDER` | founded or co-founded |
| `COUNSEL` | attorney at that firm |
| `PROPERTY_MANAGER` | works at the firm in a management role |

`FOUNDED` and `EXECUTIVE_AT` are rejected as their own edges. They are the
same employment fact with a kind, and a second edge would double-count
"people at CBRE." A person may have several `Employment` rows (JLL then
CBRE, or two concurrent affiliations). Overlaps are allowed. Phase 6 does
not auto-close the previous job when a new one is observed.

`titleAtTime` is free text ("Senior Vice President"). It is not normalized
into `affiliationKind` by the schema.

**PropertyStake** (`Company` → `Property`), predicate:

| Predicate | Meaning |
| --- | --- |
| `OWNS` | ownership interest |
| `MANAGES` | property management |
| `OCCUPIES` | occupancy not tied only to an open deal |
| `DEVELOPED` | development role |
| `LENDS_ON` | financing interest in the asset |

A company may hold more than one stake in a property (owner and
developer). Each predicate is its own row.

### Family B — deal participation (the hyperedge)

Contextual facts use `DealParticipation`, not a binary edge.

| Role | Who | Notes |
| --- | --- | --- |
| `TENANT` | company | the proposed or actual tenant |
| `LANDLORD` | company | the proposed or actual landlord |
| `SUBTENANT` | company | |
| `SUBLANDLORD` | company | |
| `TENANT_BROKER` | person | `representsCompanyId` = tenant |
| `LANDLORD_BROKER` | person | `representsCompanyId` = landlord |
| `TENANT_BROKERAGE` | company | `representsCompanyId` = tenant |
| `LANDLORD_BROKERAGE` | company | `representsCompanyId` = landlord |
| `LENDER` | company | lender on this deal, which is not automatically `LENDS_ON` the property |
| `COUNSEL` | person or company | `representsCompanyId` = the party represented, when known |
| `PROPERTY_MANAGER` | person or company | on this deal |
| `GUARANTOR` | company | |
| `OTHER` | person or company | `roleLabel` required |

`INVOLVED_IN` is rejected. It cannot answer "who represented the tenant."

### Derived, not stored

| Asked-for edge | How it is answered |
| --- | --- |
| Person `REPRESENTS_TENANT` on a deal | `DealParticipation` role `TENANT_BROKER` or `COUNSEL` with a tenant principal |
| Person `BROKERED` a property | participations with a broker role on deals whose `propertyId` is that property |
| Company `TENANT_IN` / `LANDLORD_IN` a deal | participation roles `TENANT` / `LANDLORD` |
| Company `BROKERED` a deal | `TENANT_BROKERAGE` / `LANDLORD_BROKERAGE` |
| Deal `CONCERNS_PROPERTY` | `Deal.propertyId` |
| Person `CONTACT_FOR` a property | not stored; "who should I call" is a query over participations and current employment |
| Person `KNOWS` Person | not stored; shared employer and shared deals are the evidence |
| Company `REPRESENTS_*` a company with no deal | not stored; representation is deal-scoped |
| Person `MANAGES` a property directly | not stored in Phase 6; the company `MANAGES` and the person `WORKS_AT` that company, or the person has a `PROPERTY_MANAGER` participation |

`OCCUPIES` is not auto-created from a tenant participation. A proposal is
not occupancy. A future rule may assert `OCCUPIES` when a deal reaches an
executed stage and dates are known. That rule is not Phase 6.

`LENDS_ON` is not inferred from a `LENDER` participation.

### Person–person

No `KNOWS` edge. Co-occurrence on a page is recoverable by joining
observations on `documentPageId`. That is a resolution feature for Phase 7,
not a canonical relationship.

### Company–company

No parent/subsidiary predicate in Phase 6. `ExternalIdentifier` and aliases
cover "CBRE" versus "CBRE, Inc." as possible names of one company, which is
a merge problem, not a corporate-tree problem. Subsidiary structure can be
added later as its own table (`CompanyOwnership`) with the same observation
pattern. It should not be stuffed into `PropertyStake`.

## 6. Relationship observation model

`RelationshipObservation` is one immutable table for both families. The
claim is allowed to be wrong, incomplete, or ill-typed; that is why it is
not inserted into `Employment` or `DealParticipation` directly.

Endpoints are **entity observations** (mentions), plus the enclosing deal
when the claim is about a deal. They are not canonical ids. Promotion
happens only after both endpoints have accepted resolution links.

| Field | Notes |
| --- | --- |
| `id`, `workspaceId`, `createdAt` | immutable |
| `predicate` | `WORKS_AT`, `OWNS`, `MANAGES`, `OCCUPIES`, `DEVELOPED`, `LENDS_ON`, `PARTICIPATES_AS`, `CONCERNS_PROPERTY` |
| `subjectObservationId` | the person, company, or property mention the claim is about |
| `objectObservationId` | nullable; the other mention for binary claims |
| `participationRole` | required when predicate is `PARTICIPATES_AS`; otherwise null |
| `roleLabel` | required when role is `OTHER` |
| `affiliationKind` | nullable hint on `WORKS_AT`; canonical copy happens only if accepted |
| `principalObservationId` | nullable company mention being represented |
| `contextDealId` | the deal this evidence belongs to; required for `PARTICIPATES_AS` and `CONCERNS_PROPERTY`; also set for binary claims that were read inside a deal document, as context, not as the object of the edge |
| `statedValidFrom`, `statedValidTo` | nullable dates **the text asserted**; not copied to canonical rows automatically |
| `statedTitle` | nullable, for `WORKS_AT` |
| evidence columns | same set as entity observations: `sourceKind`, document/page/message, quote, offsets, `provenanceStatus`, `sourceLocation` |
| `extractionConfidence`, `extractor`, `extractorVersion` | same meaning as entity observations |

`CONCERNS_PROPERTY` subject is a property mention and `contextDealId` is
the deal. There is no object observation. On acceptance, promotion sets
`Deal.propertyId` only when the deal's `propertyId` is null or already
that property. A conflicting property is a contest, not a silent overwrite.
Contest handling is Phase 7; the schema records both observations either way.

Binary predicate domain (application check, and a SQL check where
practical):

| Predicate | Subject observation type | Object observation type |
| --- | --- | --- |
| `WORKS_AT` | `PERSON` | `COMPANY` |
| `OWNS`, `MANAGES`, `OCCUPIES`, `DEVELOPED`, `LENDS_ON` | `COMPANY` | `PROPERTY` |
| `PARTICIPATES_AS` | `PERSON` or `COMPANY` | null |
| `CONCERNS_PROPERTY` | `PROPERTY` | null |

A model that emits "John Smith OWNS 200 Clarendon" can still be stored as
an observation if we relax the check. **Do not relax it.** Ill-typed
extractor output is rejected at the observation boundary and counted as an
extractor error. The audit trail for a rejected payload is the extraction
log in Phase 7, not a canonical-shaped table full of impossible edges.
Phase 6B enforces this in the write path's validation function even though
that write path has no caller yet except tests.

Disposition and supersession reuse the tables in §4.

## 7. Canonical relationship model

Yes. DealWatch stores both observations and canonical assertions. Seventeen
documents that say Sarah Chen works at CBRE become seventeen
`RelationshipObservation` rows and **one** `Employment` row, linked by
`EmploymentSupport`.

Canonical rows are created only when a promotion rule accepts them:

- both endpoint observations have an `ACCEPTED` resolution link to
  canonical ids, and
- the relationship observation's latest disposition is `ACCEPTED`, and
- provenance is not a reason to auto-accept `UNLOCATED` evidence
  (policy in §10; the schema still allows a `MANUAL` assertion).

Phase 6B does not implement promotion. It creates the tables promotion
will write.

### Employment

```text
Employment
  id, workspaceId
  personId, companyId
  affiliationKind
  titleAtTime          nullable
  validFrom, validTo   nullable
  validFromPrecision, validToPrecision   DAY | MONTH | YEAR | UNKNOWN
  status               ASSERTED | RETIRED
  assertionSource      OBSERVATION | MANUAL
  createdAt, updatedAt
```

`RETIRED` means a reviewer ended the affiliation (`validTo` should be set
when the end date is known). It does not mean "a newer employer appeared."

Identity of the logical edge: one open `ASSERTED` row per
`(workspaceId, personId, companyId, affiliationKind)`. A second concurrent
kind (someone who is both `FOUNDER` and `EXECUTIVE`) is a second row.
Repeat evidence does not insert a second `STAFF` row; it adds support.

### PropertyStake

```text
PropertyStake
  id, workspaceId
  companyId, propertyId
  predicate            OWNS | MANAGES | OCCUPIES | DEVELOPED | LENDS_ON
  validFrom, validTo
  validFromPrecision, validToPrecision
  status               ASSERTED | RETIRED
  assertionSource
  createdAt, updatedAt
```

One open `ASSERTED` row per `(workspaceId, companyId, propertyId, predicate)`.

### Support joins

```text
EmploymentSupport
  employmentId
  relationshipObservationId
  createdAt
  @@unique([employmentId, relationshipObservationId])

PropertyStakeSupport
  propertyStakeId
  relationshipObservationId
  createdAt
  @@unique([propertyStakeId, relationshipObservationId])

DealParticipationSupport
  dealParticipationId
  relationshipObservationId
  createdAt
  @@unique([dealParticipationId, relationshipObservationId])
```

Support rows are the answer to "why does DealWatch believe this?".
Deleting an observation is not part of the design. Rejecting it removes
it from the default read by disposition, and a future compaction job may
mark the canonical row `RETIRED` when zero accepted supports remain.
Phase 6B does not cascade-delete canonical rows.

There is no `confidence` column on `Employment`, `PropertyStake`, or
`DealParticipation`. Strength is the set of supports (count, distinct
documents, date span), computed when queried.

### Why not one `Relationship` table

A single table with nullable `subjectPersonId`, `subjectCompanyId`,
`objectCompanyId`, `objectPropertyId`, `objectDealId`, and a predicate
enum can represent every edge. It cannot enforce the vocabulary with
foreign keys alone. Every query pays for a predicate filter and a pile
of nulls. Prisma clients become a switch statement.

The three canonical tables match the three shapes that survived the
vocabulary cut: person–company employment, company–property stake, and
the deal hyperedge. Adding a fourth shape later (company subsidiary) is
a new table, which is the correct cost for a new meaning.

`RelationshipObservation` stays unified because claims are not yet
assertions and share provenance.

## 8. Deal participation / context model

Commercial real estate facts are often n-ary. "John Smith represented
Acme Corp as tenant broker on the 200 Clarendon deal" is one fact with
four nodes and a role.

### Options considered

| Option | Result |
| --- | --- |
| A. Direct binary edges only | Loses the deal, or encodes it by exploding edges (`REPRESENTS_TENANT` from John to Acme) that stay true after the deal and collide with employment. |
| B. Binary edges plus a context JSON blob | Queryable only by scraping JSON. Prisma cannot FK into the blob. "All tenant brokers on this deal" becomes a filter over unstructured context. |
| C. Participation records | A real row with FKs to person or company, the principal company, and the deal. Role is a column. Time bounds are columns. Evidence hangs off the row through support. This is the hyperedge, stored relationally. |
| D. An event/node per fact (`RepresentationEvent`) plus edges to each participant | More general and more joins. Participation already is that event, specialized to a deal. A second event node would duplicate `Deal`. |

**Choice: C, implemented as `DealParticipation`.** It is also a disciplined
form of B (the context fields are real columns). The graph view projects
each participation into directed edges when a path query needs them.

```text
DealParticipation
  id, workspaceId
  dealId
  role
  roleLabel            nullable, required in app when role = OTHER
  personId             nullable
  companyId            nullable
  representsCompanyId  nullable FK → Company
  validFrom, validTo
  validFromPrecision, validToPrecision
  status               ASSERTED | RETIRED
  assertionSource
  createdAt, updatedAt
```

Exactly one of `personId` or `companyId` is set. Both set is a broker
"at a firm on a deal" collapsed into one row, which hides the employment
fact. The firm is a second participation (`TENANT_BROKERAGE`) and/or an
`Employment`. The person row points at the principal through
`representsCompanyId`.

`representsCompanyId` must not equal `companyId` (a tenant does not
represent itself). Broker and counsel roles should have a principal when
the document names one; null principal is allowed and means "represented
a side, principal not resolved."

Uniqueness for open `ASSERTED` rows:

- person roles: `(dealId, role, personId)`
- company roles: `(dealId, role, companyId)`

A replacement broker is a second row with `validFrom` / `validTo`, or the
first row `RETIRED` and a new row. Two open `TENANT_BROKER` rows for
different people are allowed (co-brokers). Two open rows for the same
person and role are not.

### Worked shape

John Smith represented Acme as tenant broker on Deal X at 200 Clarendon.
JLL is his firm. Boston Properties is the landlord. Derek Hollis works
there.

```text
Employment
  John Smith WORKS_AT JLL          affiliationKind BROKER
  Derek Hollis WORKS_AT Boston Properties

Property
  200 Clarendon Street
Deal.propertyId = that property

DealParticipation
  (Deal X, TENANT, company=Acme)
  (Deal X, LANDLORD, company=Boston Properties)
  (Deal X, TENANT_BROKER, person=John, represents=Acme)
  (Deal X, TENANT_BROKERAGE, company=JLL, represents=Acme)
  (Deal X, LANDLORD_BROKER, person=Derek, represents=Boston Properties)
```

No edge says John works at Acme. No edge says John represents Acme for
all time.

### Projection into the path view

Each participation emits:

- participant → deal, predicate = role
- when `representsCompanyId` is set: participant → that company, predicate
  `REPRESENTS_ON_DEAL`, with `dealId` on the view row so the edge is not
  timeless

`REPRESENTS_ON_DEAL` exists only in the view, not as a stored predicate
family. Employment and stakes are already stored as themselves.

## 9. Temporal semantics

Three clocks, never collapsed.

| Clock | Where | Meaning |
| --- | --- | --- |
| Record time | `EntityObservation.createdAt`, `RelationshipObservation.createdAt` | when DealWatch extracted or a person entered the row |
| Evidence time | `Document.documentDate`, `Message.sentAt` | when the source document or email is dated; joined, not copied onto the observation |
| Valid time | `validFrom` / `validTo` on `Employment`, `PropertyStake`, `DealParticipation` | when the world was like that, if known |

`statedValidFrom` / `statedValidTo` on a relationship observation are the
interval the **text** claimed ("owned since 2019"). They are evidence
about valid time. Promotion may copy them onto the canonical row only
under an explicit rule or a reviewer action. Phase 6B stores the columns
and does not copy them.

`validFromPrecision` prevents a year-only statement from looking like a
calendar day. `UNKNOWN` with a null date is the default.

Null `validTo` on an `ASSERTED` row means "no known end," not "current as
of today." UI copy later must say "no end date on file." A query for
"as of date D":

```text
(validFrom is null OR validFrom <= D)
AND (validTo is null OR validTo >= D)
AND status = ASSERTED
```

Rows with null `validFrom` **match** every as-of query. That is deliberate:
hiding them would hide most early data. The result can be labeled
"interval unknown."

Document date is **not** `validFrom`. A 2026 letterhead showing Sarah Chen
at CBRE supports "affiliated as of the document date." The read model can
expose `earliestEvidenceAt` / `latestEvidenceAt` by aggregating
`Document.documentDate` over supports. Those aggregates are not stored in
Phase 6B.

Conflicts (JLL in a 2024 document, CBRE in a 2026 document) are two
observations and, after resolution, possibly two `Employment` rows. The
schema does not close the JLL row. Whether the product should suggest
closing it is an unresolved product rule (§22).

Ownership sold in 2025 is a `PropertyStake` `OWNS` with `validTo`, plus
whatever new `OWNS` row evidence supports. The sale itself is not an event
entity in Phase 6. If a document only says "sold," the observation can
carry `statedValidTo` without naming the buyer. The buyer is a separate
observation when named.

## 10. Provenance model

Reuse Phase 5. Do not invent a parallel evidence store.

Shared pattern with `NegotiationTerm`:

- `evidenceQuote` — exact substring the claim rests on
- `documentPageId` — set only when `locateEvidence` returns `EXACT`
- `evidenceStartOffset`, `evidenceEndOffset` — into `DocumentPage.text`
- `provenanceStatus` — the existing `EvidenceProvenanceStatus` enum
- `sourceLocation` — optional section label, not a page number

`locateEvidence` and `attachEvidenceProvenance` stay the functions a future
extractor calls. Phase 6B does not change them. Observations should be
written only after that helper returns, so page assignment cannot come
from the model.

Extension beyond terms, because not every entity fact starts as a
negotiation PDF:

| `sourceKind` | Required links |
| --- | --- |
| `DOCUMENT_PAGE` | `documentId`, `dealId`; `documentPageId` iff `EXACT` |
| `MESSAGE` | `messageId`, `dealId`; quote must be a substring of `Message.body` (enforced in the future writer; column exists now) |
| `MANUAL` | quote required; document and message null; `provenanceStatus` null |

`UNLOCATED` and `AMBIGUOUS` observations are stored and default to no
disposition (pending). They must not be auto-promoted. A reviewer can
`ACCEPT` one, which is an explicit choice to assert without a unique page
span. The support join still points at that weaker observation, so the
"why?" trail shows the weakness.

Canonical "why?" path:

```text
Employment
  → EmploymentSupport
    → RelationshipObservation (quote, offsets, provenanceStatus)
      → subject/object EntityObservation
      → DocumentPage
        → Document (filename, documentDate)
          → Deal
```

Same path for `PropertyStakeSupport` and `DealParticipationSupport`.

Negotiation terms stay on their own path (`NegotiationTerm` →
`DocumentPage`). A concession question joins **from the company
participation to the deal's terms**, then uses term provenance. It does
not copy term quotes onto the company.

Obligations and deal events keep their own quote fields. They are not
entity provenance. A later extractor may read `Message.body` and emit
`sourceKind = MESSAGE` observations. It should not FK observations to
`Obligation`.

## 11. Confidence model

Three different judgments. Only the first two are stored. None of them
is a statistical probability.

| Signal | Column | Meaning |
| --- | --- | --- |
| Extraction confidence | `extractionConfidence` on observations | The extractor's self-reported score in `[0, 1]`, or null for manual entry. Comparable only within one `extractor` + `extractorVersion`. |
| Resolution confidence | `resolutionConfidence` on `EntityResolutionLink` | How sure the linker is that this mention is this canonical entity. `1` with `method = MANUAL` means a person confirmed it, not that it is certain in the world. |
| Assertion strength | not a column | Derived at read time from accepted supports: observation count, distinct `documentId` count, min/max extraction confidence, whether any support is `EXACT`. |

Do not store `relationshipConfidence`. Do not multiply extraction by
resolution. A crisp quote of a false affiliation (letterhead from an old
deal) can be extraction `0.99` and still be the wrong current employer.
Those are different questions: "did the document say this?" versus "is
this the same Sarah?" versus "should we treat the employment as asserted?"

`provenanceStatus` is not confidence. `EXACT` means the quote was found
once. It says nothing about whether the predicate is right.

Phase 6B stores the two scores and does not rank, threshold, or display
them. Suggested future **policy** (not a schema rule): do not auto-accept
below a version-specific threshold; never auto-accept `UNLOCATED`; manual
accept does not invent an extraction score.

Float storage matches `NegotiationTerm.confidence`. No new decimal type.

## 12. Future entity-resolution compatibility

Phase 6 does not resolve entities. The schema is shaped so Phase 7 can.

### What a linker may use

All of these are columns or joins, not an alias list alone:

| Signal | Where |
| --- | --- |
| Light-normalized surface form | `normalizedName` on observations; `normalizedAlias` on aliases |
| Email | observation `email`; `PersonIdentifier` |
| Phone | observation `phone`; `PersonIdentifier` |
| Domain | observation `domain`; `CompanyIdentifier`; `Company.primaryDomain` |
| Address parts | observation address columns; `Property` address columns |
| Title | observation `title`; useful as context, weak as identity |
| Company context | `WORKS_AT` observations on the same page; participation on the same deal |
| Co-occurrence | other observations with the same `documentPageId` or `dealId` |
| Deal context | `contextDealId`, `Document.dealId` |
| External ids | `ExternalIdentifier`, empty until a provider exists |

Light normalizer (the only algorithm Phase 6B should implement, and only
as a pure function when rows are written): trim, Unicode casefold, collapse
internal whitespace, strip periods and commas. Do **not** strip `Inc`,
`LLC`, `Group`, or street suffixes in this step. Suffix folding merges
"CBRE" with unrelated "CBRE Group" entities if applied as identity.
Suffix and street-suffix folding are Phase 7 candidate generators, run as
comparison, and written down as a `resolution` method, not as the stored
key.

`normalizedName` is indexed for blocking (candidate generation). It is not
a unique key. Many people share a normalized name inside a workspace.

### Resolution links

```text
EntityResolutionLink
  id, workspaceId
  entityObservationId
  personId             nullable
  companyId            nullable
  propertyId           nullable
  method               MANUAL | DETERMINISTIC | MODEL
  resolutionConfidence nullable float
  status               ACCEPTED | REJECTED | SUPERSEDED
  createdAt
  supersededAt         nullable
```

Exactly one entity FK. A mention links to one type, matching
`observedType`.

Append-only in spirit: a new decision inserts a new link and sets
`SUPERSEDED` plus `supersededAt` on the previous `ACCEPTED` link. The
observation row is untouched. "Who did we think this was last month?" is
the link history.

`REJECTED` on a link means "not this canonical entity," which is different
from `ObservationDisposition.REJECTED` ("this mention is junk / not an
entity").

### Merges

```text
CanonicalMerge
  id, workspaceId
  entityType     PERSON | COMPANY | PROPERTY
  sourceId       the id that was merged away
  targetId       the survivor
  reason         nullable text
  createdAt
  undoneAt       nullable
```

On merge:

1. Insert `CanonicalMerge`.
2. Set source `status = MERGED` and `mergedInto*Id = target`.
3. Move aliases and identifiers onto the target if the normalized value
   is not already present; if it is present, leave the source's copy in
   place and rely on `MERGED` status so reads skip the source. Do not
   delete identifiers (they are part of why the merge happened).
4. Insert new `ACCEPTED` resolution links from the source's observations
   to the target, and supersede links that pointed at the source.
5. Re-point canonical assertions (`Employment`, `PropertyStake`,
   `DealParticipation`) from source ids to target ids **only when** the
   target does not already have the same logical row. When it does, move
   support joins onto the survivor assertion and retire the duplicate.
   This re-point is itself a recorded update (`updatedAt`), justified
   because the canonical id changed, not because evidence changed.
6. Undo sets `undoneAt`, clears `mergedInto*Id`, restores `ACTIVE`, and
   writes new resolution links back to the source. It does not delete the
   `CanonicalMerge` row.

Ids are never recycled. A merged person remains addressable so old support
audits can show the pre-merge id via link history.

Workspace check: `sourceId` and `targetId` belong to the same workspace.
Cross-workspace merge is forbidden. There is no global canonical id.

### What Phase 7 still has to decide

The schema does not encode a match threshold, a survivor-name policy, or
whether email equality is sufficient to merge. Those are code and product
rules. The schema only makes them reversible and local to a workspace.

## 13. Workspace / multi-tenant compatibility

Authentication is out of scope. Isolation is not.

Every new table in §14 carries `workspaceId`. `Deal` gains `workspaceId`.
`Document`, `DocumentPage`, `NegotiationRound`, and `NegotiationTerm` do
**not** gain a redundant workspace column in Phase 6B; they inherit the
deal's workspace through `dealId`. Observations **do** store `workspaceId`
so a list of mentions cannot forget to join `Deal`, and so a check can
reject a row whose `workspaceId` disagrees with `Deal.workspaceId`.

Rules:

- Canonical entities, observations, employments, stakes, participations,
  merges, and identifiers are workspace-scoped.
- Unique constraints include `workspaceId` wherever the value is a natural
  key (domain, external id, normalized alias per parent).
- Foreign keys must not cross workspaces. The database cannot express
  that with a simple FK; the write path checks it. Phase 6B tests must
  cover a cross-workspace FK attempt at the application check, and the
  schema comment should state the invariant.
- Two firms observing "Sarah Chen at CBRE" get two people, two companies,
  and two employments. Nothing aggregates them.
- `ExternalIdentifier` uniqueness is `(workspaceId, scheme, value)`, so a
  shared public id cannot become a bridge between firms inside this
  database.
- Queries in §18 all take a workspace parameter. A query without one is a
  defect.
- The default deployment has one `Workspace` row, and existing deals are
  backfilled to it. That preserves today's single-file behavior while
  making a second firm a second workspace later, not a schema rewrite.
- Backups and exports of a workspace must filter on `workspaceId`. A raw
  SQLite file is still the whole population; file-level isolation is an
  operations concern outside Phase 6. The schema's job is to make a
  filtered export possible and to make unfiltered entity queries obviously
  wrong.

`Workspace.firmCompanyId` is the only "who we are" pointer. It is optional
and same-workspace.

## 14. Proposed Prisma schema

Sketch for Phase 6B. Not a migration in this phase. Existing models keep
every current field and relation. Enum and model names below are the
proposed API.

```prisma
enum EntityLifecycle {
  ACTIVE
  INACTIVE
  MERGED
}

enum AssetType {
  OFFICE
  RETAIL
  INDUSTRIAL
  MULTIFAMILY
  MIXED_USE
  LAND
  OTHER
  UNKNOWN
}

enum PersonIdentifierKind {
  EMAIL
  PHONE
  LINKEDIN
}

enum CompanyIdentifierKind {
  DOMAIN
  EMAIL_DOMAIN
}

enum ObservationSourceKind {
  DOCUMENT_PAGE
  MESSAGE
  MANUAL
}

enum ObservedEntityType {
  PERSON
  COMPANY
  PROPERTY
}

enum AffiliationKind {
  UNKNOWN
  STAFF
  BROKER
  EXECUTIVE
  FOUNDER
  COUNSEL
  PROPERTY_MANAGER
}

enum PropertyStakePredicate {
  OWNS
  MANAGES
  OCCUPIES
  DEVELOPED
  LENDS_ON
}

enum ParticipationRole {
  TENANT
  LANDLORD
  SUBTENANT
  SUBLANDLORD
  TENANT_BROKER
  LANDLORD_BROKER
  TENANT_BROKERAGE
  LANDLORD_BROKERAGE
  LENDER
  COUNSEL
  PROPERTY_MANAGER
  GUARANTOR
  OTHER
}

enum RelationshipPredicate {
  WORKS_AT
  OWNS
  MANAGES
  OCCUPIES
  DEVELOPED
  LENDS_ON
  PARTICIPATES_AS
  CONCERNS_PROPERTY
}

enum AssertionStatus {
  ASSERTED
  RETIRED
}

enum AssertionSource {
  OBSERVATION
  MANUAL
}

enum DatePrecision {
  DAY
  MONTH
  YEAR
  UNKNOWN
}

enum ObservationDispositionValue {
  ACCEPTED
  REJECTED
}

enum DispositionActor {
  USER
  SYSTEM
}

enum ResolutionMethod {
  MANUAL
  DETERMINISTIC
  MODEL
}

enum ResolutionLinkStatus {
  ACCEPTED
  REJECTED
  SUPERSEDED
}

enum MergeEntityType {
  PERSON
  COMPANY
  PROPERTY
}

model Workspace {
  id            String   @id @default(cuid())
  name          String
  firmCompanyId String?
  createdAt     DateTime @default(now())

  firmCompany Company? @relation("WorkspaceFirm", fields: [firmCompanyId], references: [id])
  deals       Deal[]
  people      Person[]
  companies   Company[]
  properties  Property[]
}

model Person {
  id                String          @id @default(cuid())
  workspaceId       String
  canonicalName     String
  firstName         String?
  middleName        String?
  lastName          String?
  primaryTitle      String?
  status            EntityLifecycle @default(ACTIVE)
  mergedIntoPersonId String?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  workspace  Workspace @relation(fields: [workspaceId], references: [id])
  mergedInto Person?   @relation("PersonMerge", fields: [mergedIntoPersonId], references: [id])
  aliases    PersonAlias[]
  identifiers PersonIdentifier[]
  employments Employment[]
  participations DealParticipation[]

  @@index([workspaceId, status])
  @@index([mergedIntoPersonId])
}

model PersonAlias {
  id              String @id @default(cuid())
  workspaceId     String
  personId        String
  alias           String
  normalizedAlias String

  person Person @relation(fields: [personId], references: [id])

  @@unique([personId, normalizedAlias])
  @@index([workspaceId, normalizedAlias])
}

model PersonIdentifier {
  id              String               @id @default(cuid())
  workspaceId     String
  personId        String
  kind            PersonIdentifierKind
  value           String
  normalizedValue String

  person Person @relation(fields: [personId], references: [id])

  @@unique([workspaceId, kind, normalizedValue])
  @@index([personId])
}

model Company {
  id                   String          @id @default(cuid())
  workspaceId          String
  canonicalName        String
  legalName            String?
  website              String?
  primaryDomain        String?
  status               EntityLifecycle @default(ACTIVE)
  mergedIntoCompanyId  String?
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt

  workspace    Workspace @relation(fields: [workspaceId], references: [id])
  mergedInto   Company?  @relation("CompanyMerge", fields: [mergedIntoCompanyId], references: [id])
  firmFor      Workspace[] @relation("WorkspaceFirm")
  aliases      CompanyAlias[]
  identifiers  CompanyIdentifier[]
  employments  Employment[]
  stakes       PropertyStake[]
  participations DealParticipation[] @relation("ParticipationCompany")
  representedIn  DealParticipation[] @relation("ParticipationPrincipal")

  @@index([workspaceId, status])
  @@index([workspaceId, primaryDomain])
  @@index([mergedIntoCompanyId])
}

model CompanyAlias {
  id              String @id @default(cuid())
  workspaceId     String
  companyId       String
  alias           String
  normalizedAlias String

  company Company @relation(fields: [companyId], references: [id])

  @@unique([companyId, normalizedAlias])
  @@index([workspaceId, normalizedAlias])
}

model CompanyIdentifier {
  id              String                @id @default(cuid())
  workspaceId     String
  companyId       String
  kind            CompanyIdentifierKind
  value           String
  normalizedValue String

  company Company @relation(fields: [companyId], references: [id])

  @@unique([workspaceId, kind, normalizedValue])
  @@index([companyId])
}

model Property {
  id                    String          @id @default(cuid())
  workspaceId           String
  canonicalName         String
  addressLine1          String?
  addressLine2          String?
  city                  String?
  region                String?
  postalCode            String?
  country               String?
  assetType             AssetType       @default(UNKNOWN)
  status                EntityLifecycle @default(ACTIVE)
  mergedIntoPropertyId  String?
  createdAt             DateTime        @default(now())
  updatedAt             DateTime        @updatedAt

  workspace  Workspace @relation(fields: [workspaceId], references: [id])
  mergedInto Property? @relation("PropertyMerge", fields: [mergedIntoPropertyId], references: [id])
  aliases    PropertyAlias[]
  stakes     PropertyStake[]
  deals      Deal[]

  @@index([workspaceId, status])
  @@index([workspaceId, city, region])
  @@index([mergedIntoPropertyId])
}

model PropertyAlias {
  id              String @id @default(cuid())
  workspaceId     String
  propertyId      String
  alias           String
  normalizedAlias String

  property Property @relation(fields: [propertyId], references: [id])

  @@unique([propertyId, normalizedAlias])
  @@index([workspaceId, normalizedAlias])
}

model ExternalIdentifier {
  id           String          @id @default(cuid())
  workspaceId  String
  scheme       String
  value        String
  personId     String?
  companyId    String?
  propertyId   String?
  createdAt    DateTime        @default(now())

  @@unique([workspaceId, scheme, value])
  @@index([personId])
  @@index([companyId])
  @@index([propertyId])
}

/// Existing Deal, plus:
///   workspaceId String
///   propertyId  String?
///   workspace   Workspace
///   property    Property?
///   participations DealParticipation[]
/// Keep company and property strings.

model EntityObservation {
  id                   String                    @id @default(cuid())
  workspaceId          String
  observedType         ObservedEntityType
  surfaceForm          String
  normalizedName       String
  title                String?
  email                String?
  phone                String?
  domain               String?
  addressLine1         String?
  city                 String?
  region               String?
  postalCode           String?
  country              String?
  rawAttributes        Json?
  sourceKind           ObservationSourceKind
  dealId               String?
  documentId           String?
  documentPageId       String?
  messageId            String?
  evidenceQuote        String
  evidenceStartOffset  Int?
  evidenceEndOffset    Int?
  provenanceStatus     EvidenceProvenanceStatus?
  sourceLocation       String?
  extractionConfidence Float?
  extractor            String
  extractorVersion     String
  createdAt            DateTime                  @default(now())

  documentPage DocumentPage? @relation(fields: [documentPageId], references: [id])
  // deal, document, message relations likewise
  resolutionLinks EntityResolutionLink[]

  @@index([workspaceId, observedType, normalizedName])
  @@index([workspaceId, email])
  @@index([workspaceId, domain])
  @@index([documentPageId])
  @@index([dealId])
}

model RelationshipObservation {
  id                      String                 @id @default(cuid())
  workspaceId             String
  predicate               RelationshipPredicate
  subjectObservationId    String
  objectObservationId     String?
  participationRole       ParticipationRole?
  roleLabel               String?
  affiliationKind         AffiliationKind?
  principalObservationId  String?
  contextDealId           String?
  statedValidFrom         DateTime?
  statedValidTo           DateTime?
  statedTitle             String?
  sourceKind              ObservationSourceKind
  dealId                  String?
  documentId              String?
  documentPageId          String?
  messageId               String?
  evidenceQuote           String
  evidenceStartOffset     Int?
  evidenceEndOffset       Int?
  provenanceStatus        EvidenceProvenanceStatus?
  sourceLocation          String?
  extractionConfidence    Float?
  extractor               String
  extractorVersion        String
  createdAt               DateTime               @default(now())

  @@index([workspaceId, predicate])
  @@index([subjectObservationId])
  @@index([objectObservationId])
  @@index([contextDealId])
  @@index([documentPageId])
}

model ObservationDisposition {
  id                          String                       @id @default(cuid())
  entityObservationId         String?
  relationshipObservationId   String?
  disposition                 ObservationDispositionValue
  actor                       DispositionActor
  note                        String?
  createdAt                   DateTime                     @default(now())

  @@index([entityObservationId, createdAt])
  @@index([relationshipObservationId, createdAt])
}

model ObservationSupersession {
  id                                String   @id @default(cuid())
  priorEntityObservationId          String?
  successorEntityObservationId      String?
  priorRelationshipObservationId    String?
  successorRelationshipObservationId String?
  createdAt                         DateTime @default(now())

  @@index([priorEntityObservationId])
  @@index([priorRelationshipObservationId])
}

model EntityResolutionLink {
  id                    String               @id @default(cuid())
  workspaceId           String
  entityObservationId   String
  personId              String?
  companyId             String?
  propertyId            String?
  method                ResolutionMethod
  resolutionConfidence  Float?
  status                ResolutionLinkStatus
  createdAt             DateTime             @default(now())
  supersededAt          DateTime?

  observation EntityObservation @relation(fields: [entityObservationId], references: [id])

  @@index([entityObservationId, status])
  @@index([personId])
  @@index([companyId])
  @@index([propertyId])
}

model CanonicalMerge {
  id          String          @id @default(cuid())
  workspaceId String
  entityType  MergeEntityType
  sourceId    String
  targetId    String
  reason      String?
  createdAt   DateTime        @default(now())
  undoneAt    DateTime?

  @@index([workspaceId, entityType, sourceId])
  @@index([targetId])
}

model Employment {
  id                  String           @id @default(cuid())
  workspaceId         String
  personId            String
  companyId           String
  affiliationKind     AffiliationKind  @default(UNKNOWN)
  titleAtTime         String?
  validFrom           DateTime?
  validTo             DateTime?
  validFromPrecision  DatePrecision    @default(UNKNOWN)
  validToPrecision    DatePrecision    @default(UNKNOWN)
  status              AssertionStatus  @default(ASSERTED)
  assertionSource     AssertionSource
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  person  Person  @relation(fields: [personId], references: [id])
  company Company @relation(fields: [companyId], references: [id])
  supports EmploymentSupport[]

  @@index([workspaceId, companyId, status])
  @@index([workspaceId, personId, status])
}

model EmploymentSupport {
  id                          String   @id @default(cuid())
  employmentId                String
  relationshipObservationId   String
  createdAt                   DateTime @default(now())

  employment Employment @relation(fields: [employmentId], references: [id])

  @@unique([employmentId, relationshipObservationId])
  @@index([relationshipObservationId])
}

model PropertyStake {
  id                  String                 @id @default(cuid())
  workspaceId         String
  companyId           String
  propertyId          String
  predicate           PropertyStakePredicate
  validFrom           DateTime?
  validTo             DateTime?
  validFromPrecision  DatePrecision          @default(UNKNOWN)
  validToPrecision    DatePrecision          @default(UNKNOWN)
  status              AssertionStatus        @default(ASSERTED)
  assertionSource     AssertionSource
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt

  company  Company  @relation(fields: [companyId], references: [id])
  property Property @relation(fields: [propertyId], references: [id])
  supports PropertyStakeSupport[]

  @@index([workspaceId, propertyId, predicate, status])
  @@index([workspaceId, companyId, predicate, status])
}

model PropertyStakeSupport {
  id                          String   @id @default(cuid())
  propertyStakeId             String
  relationshipObservationId   String
  createdAt                   DateTime @default(now())

  stake PropertyStake @relation(fields: [propertyStakeId], references: [id])

  @@unique([propertyStakeId, relationshipObservationId])
}

model DealParticipation {
  id                   String            @id @default(cuid())
  workspaceId          String
  dealId               String
  role                 ParticipationRole
  roleLabel            String?
  personId             String?
  companyId            String?
  representsCompanyId  String?
  validFrom            DateTime?
  validTo              DateTime?
  validFromPrecision   DatePrecision     @default(UNKNOWN)
  validToPrecision     DatePrecision     @default(UNKNOWN)
  status               AssertionStatus   @default(ASSERTED)
  assertionSource      AssertionSource
  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt

  deal       Deal     @relation(fields: [dealId], references: [id])
  person     Person?  @relation(fields: [personId], references: [id])
  company    Company? @relation("ParticipationCompany", fields: [companyId], references: [id])
  represents Company? @relation("ParticipationPrincipal", fields: [representsCompanyId], references: [id])
  supports   DealParticipationSupport[]

  @@index([workspaceId, dealId, role])
  @@index([personId, role])
  @@index([companyId, role])
  @@index([representsCompanyId])
}

model DealParticipationSupport {
  id                          String   @id @default(cuid())
  dealParticipationId         String
  relationshipObservationId   String
  createdAt                   DateTime @default(now())

  participation DealParticipation @relation(fields: [dealParticipationId], references: [id])

  @@unique([dealParticipationId, relationshipObservationId])
}
```

`DocumentPage` gains a back-relation `entityObservations` and
`relationshipObservations`. No other document or negotiation field changes.

Partial unique indexes that Prisma schema syntax does not express cleanly
are created in the Phase 6B SQL migration and listed in §15. In particular,
"one open employment per person/company/kind" is a partial unique index on
`status = 'ASSERTED'`, not a blanket unique constraint, because a retired
row and a later re-hire must both exist.

`rawAttributes` is the only JSON column. SQLite stores it as text. It is
ignored by resolution except as an audit dump.

## 15. Indexes and constraints

### Lookups Phase 7 and the product queries need

- `EntityObservation (workspaceId, observedType, normalizedName)` — blocking
- `EntityObservation (workspaceId, email)` and `(workspaceId, domain)` —
  sparse in practice; SQLite will still index nulls, which is acceptable
  at current volume
- `PersonIdentifier (workspaceId, kind, normalizedValue)` unique — one
  canonical person per email/phone inside a workspace
- `CompanyIdentifier (workspaceId, kind, normalizedValue)` unique
- `Company (workspaceId, primaryDomain)`
- `Property (workspaceId, city, region)`
- Alias tables `(workspaceId, normalizedAlias)` non-unique, plus unique
  per parent
- `Employment (workspaceId, companyId, status)` and `(workspaceId, personId, status)`
- `PropertyStake (workspaceId, propertyId, predicate, status)` and the
  company-led twin
- `DealParticipation (workspaceId, dealId, role)`, `(personId, role)`,
  `(companyId, role)`
- Support tables unique on `(assertionId, relationshipObservationId)` so
  one quote cannot support the same assertion twice
- `ExternalIdentifier (workspaceId, scheme, value)` unique
- Page and deal indexes on observations for "everything this page said"
  and for co-occurrence

### Partial unique indexes (SQL, same migration)

```text
Employment
  UNIQUE (workspaceId, personId, companyId, affiliationKind)
  WHERE status = 'ASSERTED'

PropertyStake
  UNIQUE (workspaceId, companyId, propertyId, predicate)
  WHERE status = 'ASSERTED'

DealParticipation person actor
  UNIQUE (dealId, role, personId)
  WHERE status = 'ASSERTED' AND personId IS NOT NULL

DealParticipation company actor
  UNIQUE (dealId, role, companyId)
  WHERE status = 'ASSERTED' AND companyId IS NOT NULL
```

### Checks (SQL + application)

SQLite enforces `CHECK`. Prisma Client does not emit them from the schema
language used in this repo, so Phase 6B adds them in SQL and mirrors them
in one validation module tested without a model call.

- `DealParticipation`: exactly one of `personId`, `companyId`.
- `DealParticipation`: `representsCompanyId` is null or different from
  `companyId`.
- `DealParticipation`: `role = OTHER` implies `roleLabel` is non-empty;
  other roles have null `roleLabel`.
- `EntityResolutionLink`: exactly one of `personId`, `companyId`,
  `propertyId`.
- `ExternalIdentifier`: exactly one entity FK.
- `ObservationDisposition` and `ObservationSupersession`: exactly one side
  (entity vs relationship) populated.
- `EntityObservation`: `sourceKind = DOCUMENT_PAGE` implies `documentId`
  and `dealId`; `MESSAGE` implies `messageId` and `dealId`; `MANUAL`
  implies document, page, and message are null.
- `EntityObservation`: `provenanceStatus = EXACT` implies `documentPageId`
  and both offsets; any other status implies null page id. Same rule on
  relationship observations. This matches term provenance.
- `RelationshipObservation`: `PARTICIPATES_AS` implies role and
  `contextDealId` and null object; `CONCERNS_PROPERTY` implies null object,
  null role, and `contextDealId`; binary predicates imply object and null
  role.
- `Person.status = MERGED` implies `mergedIntoPersonId` is not null, and
  the same for company and property. A row must not merge into itself.
- `validTo` null or `>= validFrom` when both are set.
- Identifier normalized values are stored lowercase (emails, domains).

Application-only invariants (need a second query):

- Observation `workspaceId` equals `Deal.workspaceId` for its `dealId`.
- Resolution link workspace equals the observation workspace and the
  canonical row workspace.
- `Employment` / stake / participation workspace equals each FK's workspace.
- `Workspace.firmCompanyId` is a company in that workspace.
- Promotion refuses `UNLOCATED` unless disposition actor is `USER`. This
  is policy, enforced in the promoter, which does not exist in 6B. The
  test in 6B is a pure function that encodes the predicate, with no writer
  wired to extraction.

Do not add a database trigger framework.

## 16. Example records

Illustrative ids. Not seed data. Source text is the kind of letterhead
already present in `prisma/seed.ts`.

Document `doc_counter` on deal `deal_clarendon` ("200 Clarendon Lease —
Acme Corp"), page 1, `documentDate` 2026-09-08. Quote located `EXACT` at
offsets 480–534:

```text
Sarah Chen | Senior Vice President | JLL Boston
```

Observations (immutable):

```text
ent_sarah
  PERSON surfaceForm "Sarah Chen" normalizedName "sarah chen"
  title "Senior Vice President"
  documentPageId page_1 provenanceStatus EXACT
  extractionConfidence 0.94
  extractor "example" extractorVersion "0"

ent_jll
  COMPANY surfaceForm "JLL Boston" normalizedName "jll boston"

ent_acme
  COMPANY surfaceForm "Acme Corp" normalizedName "acme corp"

ent_bxp
  COMPANY surfaceForm "Boston Properties" normalizedName "boston properties"

ent_derek
  PERSON surfaceForm "Derek Hollis" title "Director of Leasing"

ent_tower
  PROPERTY surfaceForm "200 Clarendon"
  addressLine1 "200 Clarendon Street" city "Boston" region "MA"
```

Relationship observations:

```text
rel_works
  WORKS_AT subject ent_sarah object ent_jll
  affiliationKind BROKER statedTitle "Senior Vice President"
  contextDealId deal_clarendon
  quote "Sarah Chen | Senior Vice President | JLL Boston"

rel_tenant
  PARTICIPATES_AS role TENANT subject ent_acme contextDealId deal_clarendon

rel_broker
  PARTICIPATES_AS role TENANT_BROKER subject ent_sarah
  principalObservationId ent_acme contextDealId deal_clarendon

rel_jll_brokerage
  PARTICIPATES_AS role TENANT_BROKERAGE subject ent_jll
  principalObservationId ent_acme

rel_landlord
  PARTICIPATES_AS role LANDLORD subject ent_bxp

rel_property
  CONCERNS_PROPERTY subject ent_tower contextDealId deal_clarendon
```

After a future resolution pass (not Phase 6B), links and canonical rows:

```text
EntityResolutionLink ent_sarah → person_sarah method DETERMINISTIC status ACCEPTED
EntityResolutionLink ent_jll → company_jll
...

Employment emp_1
  person_sarah → company_jll
  affiliationKind BROKER
  titleAtTime "Senior Vice President"
  validFrom null validTo null status ASSERTED
EmploymentSupport emp_1 ← rel_works

Deal.propertyId = property_clarendon
DealParticipation
  deal_clarendon TENANT company_acme
  deal_clarendon LANDLORD company_bxp
  deal_clarendon TENANT_BROKER person_sarah represents company_acme
  deal_clarendon TENANT_BROKERAGE company_jll represents company_acme
```

A second document that repeats the letterhead adds `rel_works_2` and
another `EmploymentSupport` on `emp_1`. It does not add a second
employment.

A 2024 document putting Sarah at a different firm adds a new person
observation, a new `WORKS_AT` observation, and, if both are accepted, a
second `Employment`. `emp_1.validTo` stays null until a rule or a reviewer
sets it.

## 17. Example CRE scenarios

### Letterhead affiliation

"Sarah Chen, SVP, CBRE" produces a person mention, a company mention, and
one `WORKS_AT` observation. It does not produce a brokerage participation.
Title is `statedTitle`. `affiliationKind` may be left `UNKNOWN` unless a
future rule maps "SVP" — and that mapping is explicitly **not** adopted
here, because titles are marketing. Display uses `titleAtTime`.

### Tenant-rep hyperedge

John Smith of JLL represents Acme on Deal X. Stored as in §8. Asking "who
represents this tenant?" is the `TENANT_BROKER` participation whose
`representsCompanyId` is Acme on this deal, not a search for people who
work at Acme.

### Landlord history and concessions

Boston Properties is `LANDLORD` on several deals in the workspace. "What
concessions has this landlord historically made?" joins those
participations to `NegotiationRound` / `NegotiationTerm` where `side =
LANDLORD`, then uses existing term provenance. Free rent and TI live in
the negotiation model. They are not copied onto `PropertyStake`.

### Ownership versus occupancy versus a live deal

A brochure saying "owned by Boston Properties" is `OWNS`. A lease saying
Acme "shall occupy" floors 18–19 is, while the deal is in negotiation, a
`TENANT` participation only. `OCCUPIES` waits until evidence of actual
occupancy or an executed deal plus a future promotion rule. The open deal's
`propertyId` ties both facts to the building without merging them.

### Same building, three names

Observations for "200 Clarendon", "200 Clarendon Street", and
"John Hancock Tower" stay unmerged. Phase 7 may merge them using address
blocking plus alias evidence. Until `CanonicalMerge` is accepted, graph
queries treat them as different properties. That will under-connect the
graph. It will not invent a false identity. False merges are worse in a
system that brokers rely on for "who owns this."

### Same name, two people

Two "John Smith" observations, one `john.smith@cbre.com` and one
`jsmith@jll.com`, are two resolution candidates. Email inequality blocks
an automatic merge. The schema allows both links to two `Person` rows.
It does not require a unique name.

### CBRE name variants

"CBRE", "CBRE Group", and "CBRE, Inc." are three company observations.
Domain `cbre.com` on two of them is a strong Phase 7 feature, stored on
the observation now, and still not an automatic merge in Phase 6.
`CompanyAlias` receives the non-canonical strings only after a merge or a
manual alias add.

### Broker replaced mid-deal

First `TENANT_BROKER` participation is `RETIRED` with `validTo` set from
stated dates or left null if the text only says "no longer representing."
The new broker is a new `ASSERTED` participation. Both support sets remain.

### Sublease

`SUBLANDLORD` and `SUBTENANT` are distinct from `LANDLORD` and `TENANT`.
Consent language in the seed ("sublandlord consent") can become a
participation when a document names that party. It does not overwrite the
head landlord.

### Who should I call?

No `CONTACT_FOR` row. For a property, the answer set is: asserted broker
participations on deals with that `propertyId`, `PROPERTY_MANAGER`
participations, people with `Employment` at companies that `MANAGES` or
`OWNS` the property, and `LANDLORD_BROKER` participations. Ranking is a
product decision (§22), not a score column.

### Introduction, without `KNOWS`

Person B shares an employer with Person A, or shares a deal. The path view
expresses that. A shared page mention is a weaker hint and stays in the
observation layer until a product decision promotes "appeared in the same
document" into a path edge. This design does **not** promote it. Page
co-occurrence is for resolution, not for the introduction graph, because
a cc-list is not a relationship.

## 18. Example graph queries and how SQL/Prisma can answer them

All queries constrain `workspaceId`. "Open" means `status = ASSERTED` and,
when an as-of date is passed, the interval test in §9. Merged entities are
excluded by reading only rows with `status != MERGED`, or by following
`mergedInto*Id` before querying. Prisma examples are the shape of the
query, not an API to build in 6B.

The path queries use a view Phase 6B should create:

```text
graph_edge (
  workspace_id,
  from_type,   -- PERSON | COMPANY | PROPERTY | DEAL
  from_id,
  to_type,
  to_id,
  predicate,   -- WORKS_AT | OWNS | ... | participation role | REPRESENTS_ON_DEAL | CONCERNS_PROPERTY
  deal_id,     -- set when the edge exists only inside a deal
  assertion_id,
  valid_from,
  valid_to
)
```

Union of: `Employment`; `PropertyStake`; each `DealParticipation` as
participant → deal; each participation with a principal as participant →
company with `deal_id` set and predicate `REPRESENTS_ON_DEAL`; each deal
with non-null `propertyId` as deal → property predicate `CONCERNS_PROPERTY`.
Only `ASSERTED` / non-merged endpoints. The view is not materialized.

### 1. All people at CBRE

Resolve the company inside the workspace (by id, or by alias lookup the
caller already did). Then:

```text
Employment.findMany({
  where: { workspaceId, companyId: cbreId, status: "ASSERTED" },
  include: { person: true },
})
```

### 2. All deals involving CBRE

```text
DealParticipation.findMany({
  where: {
    workspaceId,
    status: "ASSERTED",
    OR: [
      { companyId: cbreId },
      { representsCompanyId: cbreId },
    ],
  },
  select: { dealId: true, role: true },
  distinct: ["dealId"],
})
```

Including `representsCompanyId` counts deals where CBRE is the client, not
only deals where CBRE is the named actor. Callers who want "deals CBRE
brokered" filter `role` to the brokerage roles instead.

### 3. Properties where CBRE represented a party

Participations in §2 with role in `TENANT_BROKERAGE`, `LANDLORD_BROKERAGE`,
`TENANT_BROKER`, `LANDLORD_BROKER`, joined to `Deal.propertyId`. Person
brokers are included when their participation's company is CBRE **or**
when the query also joins `Employment` for people at CBRE. The brokerage
participation is the direct answer; the employment join catches deals
where the person was recorded and the firm participation was not.

### 4. People connected to 200 Clarendon

Union of:

- `DealParticipation.personId` on deals with `propertyId`
- people on `Employment` whose company has a `PropertyStake` on that
  property or a participation on those deals

This is "connected," which is wide. The UI later will group by role. The
schema does not need a path table for a one- and two-hop union.

### 5. Deals where Person X represented a tenant

```text
DealParticipation.findMany({
  where: {
    workspaceId,
    personId,
    role: "TENANT_BROKER",
    status: "ASSERTED",
  },
})
```

Counsel who represented the tenant is `role = COUNSEL` plus
`representsCompanyId` matching a `TENANT` participation on the same deal.
That second form is an explicit extra filter, not a second stored role.

### 6. All owners we've negotiated against

Workspace deals are the firm's deals. Owners in the negotiation sense are
companies with `LANDLORD` (and, when the question means fee ownership,
companies with `OWNS` on a deal's property). Default query for this
sentence:

```text
DealParticipation.findMany({
  where: { workspaceId, role: "LANDLORD", status: "ASSERTED", companyId: { not: null } },
  distinct: ["companyId"],
})
```

Exclude `Workspace.firmCompanyId` when set. `SUBLANDLORD` is a separate
filter the caller opts into.

### 7. All evidence supporting Person X `WORKS_AT` Company Y

```text
Employment.findFirst({
  where: { workspaceId, personId, companyId, status: "ASSERTED" },
  include: { supports: true },
})
```

Then load those `RelationshipObservation` ids with `documentPage` and
`document`. There is no blended score to display. The page shows each
quote, provenance status, document date, and extraction confidence.

### 8. Relationship path

Example: Person A → Company → Deal → Property → Company → Person B.

Recursive CTE over `graph_edge` restricted to `workspace_id`, max depth 6,
both directions (store a traversal as undirected by selecting edges where
`from_id` matches the frontier **or** `to_id` matches it, and stepping to
the other end). Return the first path that reaches the target. Cycles are
blocked by an accumulated id list. SQLite supports `WITH RECURSIVE`.

Phase 6B creates the view and does not ship a path API. The depth cap is
part of the query, not the schema. Hop count is unweighted. `deal_id` on
an edge lets the explainer say "represented on Deal X" instead of "knows."

### 9. Most frequently encountered counterparties

Count `DealParticipation` rows with `role = LANDLORD` grouped by
`companyId`, for the workspace, ordered by distinct `dealId` count.
Brokerage counterparties are the same query with brokerage roles.
Frequency is a query result. It is not stored.

### 10. Brokers with the most historical interaction with our firm

Count distinct deals per `personId` where role is `TENANT_BROKER` or
`LANDLORD_BROKER`. If `firmCompanyId` is set, exclude people whose open
`Employment.companyId` is the firm (they are us, not a counterparty).
Interaction means shared deals in this workspace, which is the correct
definition of "our" history.

### 11. Historical negotiation outcomes involving a company

Company's deal ids from participations, then existing
`resolveStructuredState` inputs: that deal's rounds and terms. No new
table. "Outcomes" remain term statuses (`AGREED`, `REJECTED`, …). Phase 6
does not define a concession score.

### 12. Who might provide an introduction to Person X?

Two-hop query, not a stored edge:

- other people with an open `Employment` at Person X's companies
- other people who share a `DealParticipation.dealId` with Person X

Order later by distinct shared deals, then shared employer. Do not rank by
extraction confidence. Do not traverse page co-occurrence. A full shortest
path (§8) is the generalization when the introducer is several hops out
(Person A works at a firm that was landlord opposite Person X's brokerage).

## 19. Rejected alternatives

| Alternative | Why it was rejected |
| --- | --- |
| Generic `Entity` + generic `Relationship` as the only storage | Loses per-type identity keys and makes illegal edges representable. The graph view already supplies a uniform edge for path search. |
| Generic entities for observations as well as canonical rows | Observations **should** be generic. Rejecting that would triplicate provenance. The rejection applies to canonical storage. |
| Duplicate `Deal` into an `Entity` row | Deal already has documents, rounds, and terms. A twin row would drift. |
| LLM writes canonical edges directly | Violates auditability. One bad letterhead becomes firm-wide truth with no mention boundary. |
| One canonical edge per document | Inflates "people at CBRE" and breaks uniqueness. Support joins exist so evidence still counts. |
| `Company.kind` landlord/tenant/brokerage | Roles change by deal. A brokerage can be a tenant. The kind would be wrong the first time a firm shows up on the other side. |
| `FOUNDED` and `EXECUTIVE_AT` as predicates beside `WORKS_AT` | Double-counts people and disagrees with "small vocabulary." Kind is a column. |
| `KNOWS` | No evidence standard. Shared deals and employers answer the introduction question with a trail. |
| `INVOLVED_IN`, `CONTACT_FOR`, `BROKERED` as stored predicates | Too vague, or fully derivable from participation plus `propertyId`. |
| Binary `REPRESENTS_TENANT` from person to company | Becomes a permanent fact and drops the deal and the property. Participation keeps all four. |
| Context JSON on a binary edge | Not foreign-keyable, painful in Prisma, easy to query incorrectly. |
| A free-floating event node plus a graph database | Participation is the event. Neo4j (or any second database) adds a sync problem the relational model does not have. Recursive CTEs cover the paths this product listed. |
| Edge-per-hop hyperedge decomposition only | Same information as participation, weaker constraints, harder "who is on this deal" queries. |
| Auto-copy `documentDate` into `validFrom` | Confuses evidence time with the start of employment or ownership. |
| Single confidence on the canonical edge | False precision. Mixes "the quote is real" with "this is the same person" with "this is current." |
| Global person/company rows shared by firms | Leaks one firm's private relationships into another's resolution and path search. |
| Entity ids inside `structuredPayload` | Already forbidden. Terms and parties meet at the document page and the deal, not inside the payload. |
| Unique constraint on `normalizedName` | Collapses distinct John Smiths. |
| Legal-suffix stripping inside the stored normalizer | Collapses "CBRE" and "CBRE Group" before any reviewer sees the candidate pair. |
| Vector embeddings, semantic search, external enrichers, LinkedIn scraping | Out of scope, and not required to store or query this ontology. |
| Materialized path table | Premature. The view is enough until path latency is measured. |
| Parsing `Thread.participants` in Phase 6B | Those strings are a future `MESSAGE` source. Changing thread ingestion is outside this phase. |
| Backfilling `Person`/`Company`/`Property` from `Deal.company` and `Deal.property` | That is unsupervised resolution. It would canonize dashboard labels. Strings stay until Phase 7. |

## 20. Migration strategy from current DealWatch

Phase 6B is additive. Negotiation behavior, eval fixtures, extraction, and
document ingestion stay byte-compatible.

1. Add `Workspace`. Insert one default workspace in the migration's data
   step (name is an unresolved choice, §22; proposed name `Default`).
2. Add `Deal.workspaceId` as a non-null column with the default workspace
   id backfilled onto existing deals. Add nullable `Deal.propertyId`.
   Do not drop or rewrite `Deal.company` or `Deal.property`.
3. Create the entity, observation, assertion, support, resolution, and
   merge tables empty. No reader in the app is required to touch them for
   existing screens to work.
4. Add the `graph_edge` view. It returns zero rows until assertions exist.
5. Point new optional relations from `DocumentPage` to observations.
   Existing page deletes already cascade from documents; observation FKs
   should `ON DELETE RESTRICT` if a page is referenced, so evidence cannot
   vanish under a canonical support. Today's page deletes happen with the
   document. Phase 6B should set observation → page to `Restrict`, and
   document → page remains `Cascade` only when no observation references
   the page. If that interaction is awkward in SQLite, use `SetNull` on
   `documentPageId` and keep `evidenceQuote` — the quote survives, the
   span is marked lost. **Preferred:** `Restrict`, and do not delete
   documents that have observations. Document deletion already exists
   (`app/api/documents/[id]/route.ts`); Phase 6B must make that route
   refuse deletion when observations exist, or observations cannot use
   `Restrict`. That route change is the one application exception, and it
   is a guard, not a feature. If the product would rather keep deletion,
   use `SetNull` and accept a weaker trail. **Decision needed** (§22).
   Recommendation: `Restrict` plus a deletion guard.
6. Do not create entities from seed strings, thread participants, or
   obligation counterparties.
7. Do not re-run extraction or evals as a data migration. Schema tests use
   the existing test database helper pattern.
8. `db push` is what this repo uses (`package.json`), not a committed
   SQL migration history. Phase 6B should still keep a checked-in SQL
   fragment for partial unique indexes and checks if `db push` will not
   emit them, and apply it in the same change. Verify Prisma 6's behavior
   at implementation time rather than assuming `db push` creates partial
   indexes.

Rollback of an unreleased 6B migration is drop the new tables and the two
Deal columns. After any workspace has real assertions, rollback is a
restore of the SQLite file, not a down migration. Say that in the 6B PR.

## 21. Phase 6B implementation plan

Implement schema and guards only. Stop before extraction, resolution,
promotion, UI, and visualization.

1. **Pure functions and tests first.** Light normalizer. Provenance field
   compatibility (EXACT iff page and offsets). Predicate/type domain
   checks. Participation XOR check. Workspace-consistency check signature
   (pure given the rows). Deletion-guard predicate: a document with any
   observation cannot be deleted. No Prisma calls in these tests.
2. **Schema.** Apply §14 and §15, including partial unique indexes and
   checks. Generate the client.
3. **Default workspace backfill.** Existing deals point at it. Seed script
   creates the workspace before deals if the seed is updated; otherwise
   the migration data step is enough and seed is updated only so a fresh
   `db:seed` does not fail on a required `workspaceId`. That seed change
   is mechanical (set `workspaceId`), not entity backfill.
4. **`graph_edge` view.** Empty-result test on a database with deals and
   no assertions. One fixture test that inserts an employment and a
   participation by hand and sees the expected view rows. This is the
   schema's proof of query 1 and query 5, not a product API.
5. **Document delete guard**, if §22 confirms `Restrict`. Test that a
   document with an observation is refused and a document without one
   still deletes. Do not change upload, extraction, or negotiation routes.
6. **Invariant tests against the test database.** Reject cross-workspace
   employment. Reject two open employments for the same person, company,
   and kind. Allow a retired row plus a new asserted row. Reject a
   participation with both person and company. Reject a `WORKS_AT`
   observation whose subject type is `COMPANY` at the validation function.
   Insert seventeen supports on one employment and assert one employment
   row.
7. **Leave unwired.** No extractor, no resolver, no promoter, no
   dashboard, no change to `payloads.ts`, no change to evals, no Neo4j,
   no embeddings.

Suggested file layout for 6B, so the work stays out of the negotiation
pipeline:

```text
lib/entities/normalizeName.ts
lib/entities/invariants.ts
lib/entities/invariants.test.ts
prisma/schema.prisma          (additive)
prisma/sql/phase6b-checks.sql (partial indexes and checks, if needed)
```

Do not add entity routes. Do not add a graph query module beyond the view
and the fixture test. Path CTEs are specified here so 6B's view columns
are sufficient; implementing the CTE is a later phase.

## 22. Risks / unresolved questions

Review these before Phase 6B.

1. **Document deletion versus provenance.** Recommendation: observations
   reference pages with `ON DELETE RESTRICT`, and document delete fails
   when observations exist. Alternative: `SetNull` so deletes keep working
   and quotes become detached. This changes an existing route only in the
   restrict case.
2. **Default workspace name** and whether `firmCompanyId` stays null until
   a person sets it. Recommendation: workspace name `Default`, firm
   company null.
3. **Closing a prior job.** When later evidence shows a new employer,
   should the product suggest retiring the old `Employment`, or wait for
   an explicit date? Recommendation: never auto-retire in the promoter.
4. **`OCCUPIES` promotion from an executed lease.** Which `Deal.status` /
   `stage` values mean executed? Today's `status` is a free string
   (`ACTIVE`). Do not derive occupancy until stage values are an enum.
5. **Primary property conflicts.** If accepted observations name two
   different buildings for one deal, Phase 7 needs a contest state.
   Recommendation: do not overwrite `Deal.propertyId`; leave the second
   observation accepted but unpromoted and surface it later. No contest
   table in 6B unless you want one now. Recommendation: no contest table
   yet; unpromoted accepted observations are the queue.
6. **`OTHER` participation role** can become a junk drawer. Recommendation:
   keep it, require `roleLabel`, and review labels before adding enum
   values.
7. **Existing-tenant mentions** ("subject to existing tenant surrender")
   are not a participation role. They are easy to over-extract. Phase 7
   should ignore them until a role is deliberately added. Not in the enum
   now.
8. **Counsel on a side** is one role plus a principal, not
   `TENANT_COUNSEL` / `LANDLORD_COUNSEL`. Confirm that is enough for
   "who represented the landlord's counsel." It is answerable, with one
   extra join.
9. **Email uniqueness.** `PersonIdentifier` unique per workspace will
   reject two people sharing a shared inbox (`leasing@bxp.com`).
   Recommendation: keep the unique constraint for `EMAIL` and `PHONE`;
   shared inboxes should be company identifiers or not stored as person
   identity. Flag in the Phase 7 linker.
10. **SQLite partial indexes and `db push`.** Implementation must confirm
    they actually land in `prisma/dev.db`. If Prisma drops them on the
    next push, the SQL fragment has to be reapplied and that operational
    fact belongs in the 6B notes.
11. **Single SQLite file** holds every workspace. Schema filters do not
    replace a separate database per firm if the threat model includes
    someone with the file. Acceptable for Phase 6; not acceptable as the
    final hosting story.
12. **Seed and demo data** will keep showing Sarah Chen only inside
    message text until a later phase writes observations. The graph will
    look empty in the product. That is intentional. Phase 6B's approved
    seed task later added an explicit fictional network; see the appendix.
    That seed is not automatic resolution of deal strings.
13. **Introduction ranking and "who should I call" ranking** have no
    agreed sort. Schema supports the candidate sets. Do not invent a
    score during 6B.
14. **Subsidiary / brand relationships** (JLL Boston vs JLL) will be
    wrong if Phase 7 merges them blindly, and incomplete if it never
    links them. Out of scope until real documents show the pattern.
    Recommendation: treat "JLL Boston" as its own company observation
    until a human merges or a later `CompanyOwnership` design exists.

## Summary recommendation

Store **Person, Company, Property, and the existing Deal** as the only
canonical nodes. Store mentions in shared immutable **EntityObservation**
and **RelationshipObservation** rows that reuse Phase 5 page provenance.
Promote accepted binary facts into **Employment** and **PropertyStake**,
and promote deal-shaped facts into **DealParticipation** with a role and
an optional principal. Link every canonical assertion to the observations
that support it. Keep time-of-record, document time, and valid time apart.
Scope every new row by workspace so two firms cannot share a graph.
Leave resolution, extraction, and path APIs for later phases; give them
indexes, reversible merges, and a `graph_edge` view.

## Appendix — Phase 6B implementation notes

Phase 6B stores the ontology above. It does not extract, resolve, or promote.
This appendix records how that schema landed in Prisma and SQLite.

### Prisma model names

The schema uses the names in §14: `Workspace`, `Person`, `Company`, `Property`,
`PersonAlias`, `PersonIdentifier`, `CompanyAlias`, `CompanyIdentifier`,
`PropertyAlias`, `ExternalIdentifier`, `EntityObservation`,
`RelationshipObservation`, `ObservationDisposition`, `ObservationSupersession`,
`EntityResolutionLink`, `CanonicalMerge`, `Employment`, `EmploymentSupport`,
`PropertyStake`, `PropertyStakeSupport`, `DealParticipation`,
`DealParticipationSupport`. `Deal` is the existing model.

`Deal.company` and `Deal.property` remain strings. `Deal.workspaceId` is
required. `Deal.propertyId` is the nullable canonical building reference.

### Deviation: relation field name on Deal

Prisma cannot give `Deal` both a scalar field and a relation named
`property`. The foreign key is still `propertyId`. The relation field is
`canonicalProperty`. The legacy display string stays `property`.

### Workspace

One `Workspace` row named `Default` is created by the backfill and by
`ensureDefaultWorkspace`. Existing deals were updated in place onto that
row before `prisma db push` (`scripts/prepare-phase6b-workspace.ts`).
`firmCompanyId` is null. There is no global canonical entity: company
identity uniqueness is per workspace.

`Document`, `DocumentPage`, `NegotiationRound`, and `NegotiationTerm` do
not store `workspaceId`. They inherit it through `Deal`.

### Constraints SQLite and Prisma cannot express alone

`prisma db push` does not emit partial unique indexes, views, or `CHECK`
constraints. `prisma/sql/phase6b.sql` creates:

- `graph_edge` (a non-materialized view)
- `Employment_open_edge`
- `PropertyStake_open_edge`
- `DealParticipation_open_person`
- `DealParticipation_open_company`

`npm run db:push` and the test database helper reapply that file after
every push, because a later push drops objects that are not in
`schema.prisma`.

`CHECK` constraints from §15 are enforced in `lib/entities/invariants.ts`
and the write functions in `lib/entities/service.ts`. Rebuilding SQLite
tables to attach `CHECK`s would be overwritten by the next `db push`.
There is no trigger framework.

Observation → `Document`, `DocumentPage`, and `Message` foreign keys use
`ON DELETE RESTRICT`. `DELETE /api/documents/[id]` returns 409 when any
observation references the document, and the foreign key rejects a direct
delete as well. Evidence references are not nulled, and observations are
not cascade-deleted with the document.

### graph_edge

There is no Prisma view model. Readers use `listGraphEdges(db, workspaceId)`,
which selects from the SQLite view and always filters `workspace_id`.
The view unions open `Employment`, open `PropertyStake`, open
`DealParticipation` (participant → deal, and participant → principal as
`REPRESENTS_ON_DEAL` when `representsCompanyId` is set), and
`Deal.propertyId` as `CONCERNS_PROPERTY`. Merged endpoints are excluded.
The canonical tables remain the source of truth.

### Domain services

`lib/entities/service.ts` is the write path. Route handlers do not insert
graph rows. Observations are insert-only: disposition and supersession are
separate tables, and observations have no `updatedAt`. Recording an
observation does not create or update `Employment`, `PropertyStake`, or
`DealParticipation`. Support is attached only by `attachObservationSupport`.
`DOCUMENT_PAGE` provenance is assigned with the existing `locateEvidence`
helper. `EXACT` is page-scoped, so message evidence stores offsets and a
null `provenanceStatus` rather than a second provenance enum.

### Normalization

`lib/entities/normalize.ts` implements the §12 light normalizer only.
It does not strip `Inc`, `LLC`, `Group`, or street suffixes, and it does
not merge rows.

### Seed

`seedClarendonGraph` builds an explicit fictional network on the existing
200 Clarendon / Acme deal: the property, Acme, Boston Properties, JLL
Boston, CBRE, Harborline Management, Sarah Chen, Derek Hollis, Priya Shah,
and Elena Vasquez. It sets `Deal.propertyId` for that deal only. Ownership
and management are `PropertyStake` rows. Tenant, landlord, and broker
roles are `DealParticipation` rows. Sarah's and Derek's `WORKS_AT`
observations quote substrings of the seeded message bodies. Participations
and stakes that the messages do not state have `assertionSource = MANUAL`
and no support rows. No `OCCUPIES` stake is created. `firmCompanyId` stays
null. Other seeded deals receive only `workspaceId`.

### Not in Phase 6B

Entity extraction, changes to the negotiation prompt or structured output,
entity resolution, `EntityResolutionLink` writers, merges, automatic
promotion, fuzzy matching, alias inference, closing a prior employment when
a new one appears, inferring `OCCUPIES` or `LENDS_ON` from a deal,
path-search CTEs, graph visualization, and connection-map UI.
