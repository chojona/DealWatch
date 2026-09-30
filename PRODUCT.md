# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Commercial real estate professionals working a live lease negotiation. The daily user is the broker or deal operator who opens a deal to see the current position, whose side it is on, what the formal paper says, what email said, and what needs a next action.

They use DealWatch as a workspace during the deal, including catch-up after time away. They are not browsing a marketing site.

## Product Purpose

DealWatch is commercial-real-estate negotiation intelligence. It reconstructs a deal from formal documents and communications, keeps those sources distinct, and shows the operator what is open, agreed, in conflict, or waiting.

Success is a fast, trustworthy read of the deal: the position, the side, the status, the source, and the next action are visible without treating email as a substitute for the paper.

## Positioning

Neighboring tools can list stages, contacts, or a finished lease abstract. DealWatch’s difference is that current formal paper and reviewed communication stay separate, evidence stays attached to the decision, and email never becomes the formal position on its own.

## Operating Context

DealWatch is a daily operational workspace.

Primary navigation is Home (`/dashboard`), Deals (`/deals`), and Inbox (`/inbox`), plus New deal (`/deals/new`). Inside a deal, navigation stays Overview, Documents, Messages, Actions, Negotiation, Knowledge, Connections, and Activity.

The Deal Overview (`/deals/{id}`, implemented in `components/deals/deal-brief.tsx`) is the canonical screen. Its sections, in order, are Needs you, the action panel (including Waiting on them, Both sides, and Not clear yet), Current terms, What changed, Paper and email, Recent emails, and Processing and review.

Catch-up uses an optional exclusive `since` instant. It filters change-oriented projections. It does not rebuild the deal as it existed at that time. Current open deal state stays visible.

The canonical local demonstration is deal `dealwatch-demo-acme` (“Acme Acquisition — DealWatch Demo”). Formal base rent on the paper is $67. Reviewed email says $72. Those figures differ, and the email does not replace the paper. Reset and expected paths are in `docs/demo.md`.

## Capabilities and Constraints

Confirmed product behavior to preserve:

- Formal paper and communication are different evidence. Labels say so: “On the paper” and “In email”; source phrases are Paper, Document, Email, and Earlier activity. Current terms copy states that email does not change those positions. Paper and email copy states that a difference is evidence to inspect, neither side is automatically right, and email does not change the formal paper. Recent emails “never become the formal paper on their own.” Waiting-on-them copy is taken from reviewed requests and does not change the paper.
- One status language. Deal Overview formal labels are Open, Agreed, Conflict, Rejected, Withdrawn, Not mentioned, and Unknown. Resolver statuses Proposed and Unresolved both display as Open on the brief. Tone follows the fact in context, not the word alone:
  - Agreed: success. Closed stage: success.
  - Conflict, a paper/email difference, and Stale: warning.
  - Rejected: danger.
  - Open, Withdrawn, Not mentioned, Unknown, Fulfilled, email review state, and ordinary record or stage labels: neutral.
  - Info is for informational state. A formal term that is Open is neutral, not info.
- Commercial values are primary. Important values wrap. They do not truncate. Major tracked terms include base rent, TI allowance, free rent, and lease term.
- Evidence sits at the point of decision: a source link on the term, request, change, comparison, or email, and the quoted passage beside a paper/email comparison.
- Needs you is outstanding work from current deal evidence. Processing and review stay separate from commercial terms and requests.
- Empty overview: “No sources yet,” with Upload document and Import email.
- Dates on the overview render in UTC.
- Routes, deal navigation, sidebar structure, and existing terminology stay stable unless a demonstrated usability problem requires a change.
- Refinement preserves product identity and behavior.

Undecided, and not to be invented: roles and permissions, mailbox-to-deal association, portfolio views, export, collaboration, user-authored notes, and automatic per-user last-viewed catch-up.

## Brand Commitments

Name: DealWatch.

Voice: precise, institutional, and operational. Say what the paper says, what the email says, and what the operator needs to do. Do not decorate status or soften a difference into a marketing claim.

Character: institutional, calm, precise, trustworthy, and sophisticated. The product is simple by default and powerful on demand. It is operational rather than decorative.

The core product principle is: **simple by default, powerful on demand.**

Maximum information density, permanent on-screen evidence, tiny typography, and comparison matrices are not the default visual standard. Complexity is revealed when someone asks for it. Simplicity hides complexity. It does not hide information. Domain semantics and evidence rules outrank visual elegance.

### Approved visual foundation

These decisions are the product direction. Negotiation is the first screen built to them. Other existing screens stay as they are until a later, separate change.

Typography:

- Application UI uses Geist.
- Instrument Serif may be used for major commercial figures, the decision sentence, and evidence quotations.
- Do not spread the serif into navigation, buttons, labels, status, metadata, forms, or general body UI. It is controlled product character.

Spacing uses the existing 4px scale (`--space-1` = 4px and its multiples). Whitespace is functional when it improves comprehension.

Radius:

- 4px status chips
- 6px controls, buttons, and panels

Surfaces:

- A warm, light application canvas
- White for a selected row and for paper
- Subtle elevation and soft shadows where hierarchy needs them
- The sidebar remains the primary dark surface
- Hairline structure only where alignment is not enough

Color:

- Brand green is for the primary action, current navigation, and the tenant side of a position. Shipped brand is `#214e46` (`--color-brand`), with hover `#193f39`.
- The landlord side of a position uses oxidized copper, distinct from tenant green.
- Semantic colors are only for meaningful state. Warning, success, danger, info, and neutral keep the meanings in Capabilities and Constraints.
- Do not infer domain meaning from a status word alone. Status context matters.

Motion, when it explains state or change, is 150–200ms and ease-out. Respect `prefers-reduced-motion`.

### Negotiation workspace

The default Negotiation workspace answers: what is the next decision?

- Open terms are the primary surface.
- Agreed terms collapse into a quieter summary. Their underlying detail stays reachable.
- Numeric terms with directly comparable values in the same unit use the Position Rail: tenant position, landlord position, gap, and one step of movement.
- Qualitative terms use the Qualitative Pair: tenant position, landlord position, and a relation that already exists in DealWatch state.
- Conditional or shared-date terms, including commencement conditions, stay prose when a scale would misrepresent the negotiation.
- The default surface shows the current tenant position, the current landlord position, the gap or relation, one step of movement, a decision sentence derived from stored positions, and the agreed summary.
- Selecting a term keeps the open list in view and reveals chronology, formal sentences, source documents and dates, conflict state, companion facts DealWatch already knows are agreed, and deeper evidence.
- The two-position mark is a recurring DealWatch motif. It is not applied to every control.

### Approved primitives

Prefer the shared implementations. Do not create a local replacement without a real need.

- Status chip: `Status` in `components/ui/status.tsx`. There is no separate `StatusChip`. Do not add one beside `Status`. `StatusBadge` and `Badge` are not a second status language.
- Button: `components/ui/button.tsx`. Primary action uses brand green.
- Section header: `components/ui/section-header.tsx`.
- Commercial value: `components/ui/commercial-value.tsx`. Values wrap (`break-words`) and use tabular numerals.
- Comparison: `components/ui/comparison-value.tsx`. Paper and email stay in separate columns.
- Source: `components/ui/source-link.tsx`.
- Evidence quote: `EvidenceQuote` in `components/ui/evidence-quote.tsx`, plus `EvidencePanel` in `components/knowledge/evidence-panel.tsx`. On Negotiation, quotations may use Instrument Serif. The quote remains the stored source text.
- Fields: `.field` and `.field-label` in `app/globals.css`.

`FilterChip` exists only as a local control in `components/connections/connection-map.tsx`, and it still uses an older zinc treatment. Do not copy that chip onto other screens. A shared filter chip, if one is needed, follows this foundation.

### Deal Overview

`components/deals/deal-brief.tsx` with `components/deals/deal-header.tsx` remains the Deal Overview. It is not the visual standard for Negotiation. Overview behavior to preserve: paper and email stay distinct, commercial values wrap, and status follows the fact in context.

Hierarchy should come from composition, alignment, weight, and order before boxes, borders, and labels.

### Avoid

Generic SaaS card grids, excessive borders, gradients for decoration, glassmorphism, giant marketing typography, decorative animation, visual clutter, grain or noise, parallax, random dark panels, decorative status colors, unnecessary icon-library changes, rebuilding navigation for novelty, and local component styling when an approved primitive exists.

### Preserve

Existing product terminology, routes, workflows, sidebar structure, deal navigation, evidence semantics, negotiation resolver behavior, formal truth, accessibility, Lucide, the green brand, reduced-motion behavior, and focus-visible behavior. Formal paper and communication stay semantically distinct.

## Evidence on Hand

- Deal Overview implementation: `components/deals/deal-brief.tsx`, header in `components/deals/deal-header.tsx`, shell in `components/app-shell.tsx`.
- Shared primitives and tokens: `components/ui/` and `app/globals.css`.
- Formal status projection: `lib/deals/brief/formalStatus.ts`.
- Canonical demo and the $67 paper / $72 email story: `docs/demo.md`.
- Catch-up contract: `docs/catch-up.md`.

Do not fabricate customers, testimonials, benchmarks, pricing, or licensing.

## Product Principles

Simple by default. Powerful on demand.

1. Every screen has one obvious purpose.
2. Show the next decision before showing supporting detail.
3. Complexity is revealed progressively.
4. Open work receives visual priority. Settled work recedes.
5. Commercial values should be immediately understandable and visually memorable. Important values wrap. They do not truncate.
6. Whitespace is functional when it improves comprehension.
7. Prefer hierarchy and composition over boxes, borders, and labels.
8. Evidence appears at the moment a user needs to verify a decision.
9. Movement should be visualized when possible rather than described only in prose.
10. Formal paper and communication remain semantically distinct. Communication never visually implies that it replaced formal paper.
11. Motion is allowed when it explains state or change.
12. DealWatch should have recognizable product-native visual components.
13. Simplicity must not remove truth. Progressive disclosure hides complexity, not information.
14. Domain semantics and evidence rules always outrank visual elegance.

One consistent status language remains in force. Existing terminology and workflows stay stable unless a demonstrated usability problem requires a change. Color communicates facts and state.

## Accessibility & Inclusion

The app is `lang="en"`. Focus-visible is a 2px brand outline, offset 2px. Inside the sidebar the outline uses the sidebar text color. A skip link is present. `prefers-reduced-motion: reduce` collapses animation, transition, and smooth scroll. Status is text, not color alone. Interactive controls keep names, including icon-only controls.
