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

Character: institutional, information-dense, fast to scan, restrained, trustworthy, precise, sophisticated, and operational rather than decorative.

### Approved visual foundation

These decisions are binding. They are the product direction for later refinement. They are not a new visual world.

Typography is Inter.

- Meta: 12 / 400
- Label: 13 / 500
- Body and table: 14 / 400
- Values: 14 / 500
- Section: 14 / 600
- Page title: 20 / 600
- Commercial values: up to 16 / 600, with tabular numerals

Spacing uses the existing 4px scale (`--space-1` = 4px and its multiples). Product layouts stay dense. Do not add whitespace for its own sake.

Radius:

- 4px status chips
- 6px controls, buttons, and panels

Surfaces:

- Light application canvas
- White and subtle product surfaces
- The sidebar is the primary dark surface
- Hairline borders where structure is necessary
- No decorative shadows

Color:

- Brand green is for the primary action, current navigation, and formal-paper identity. Shipped brand is `#214e46` (`--color-brand`), with hover `#193f39`.
- Semantic colors are only for meaningful state. Warning, success, danger, info, and neutral keep the meanings in Capabilities and Constraints.
- Do not infer domain meaning from a status word alone. Status context matters.

Shipped tokens that are larger than this foundation are leftovers, not the approved direction. Do not copy them forward. As of this record they include `.page-title` at 30px, `.section-title` at 20px, `CommercialValue` and differing `ComparisonValue` figures at 20px, `--radius-button` at 8px, and `--radius-surface` at 12px. Future refinement moves toward the scale and radius above.

### Approved primitives

Prefer the shared implementations. Do not create a local replacement without a real need.

- Status chip: `Status` in `components/ui/status.tsx`. There is no separate `StatusChip`. Do not add one beside `Status`. `StatusBadge` and `Badge` are not a second status language.
- Button: `components/ui/button.tsx`. Primary action uses brand green.
- Section header: `components/ui/section-header.tsx`.
- Commercial value: `components/ui/commercial-value.tsx`. Values wrap (`break-words`) and use tabular numerals.
- Comparison: `components/ui/comparison-value.tsx`. Paper and email stay in separate columns.
- Source: `components/ui/source-link.tsx`.
- Evidence quote: the quote already rendered with the comparison, plus `EvidencePanel` in `components/knowledge/evidence-panel.tsx`. There is no `EvidenceQuote` component. Do not add a decorative quote treatment.
- Fields: `.field` and `.field-label` in `app/globals.css`.

`FilterChip` exists only as a local control in `components/connections/connection-map.tsx`, and it still uses an older zinc treatment. Do not copy that chip onto other screens. A shared filter chip, if one is needed, follows this foundation.

### Deal Overview reference

Treat `components/deals/deal-brief.tsx` with `components/deals/deal-header.tsx` as the canonical reference for density, hierarchy, terms, commercial values, status, evidence, paper versus communication, responsive stacking, and panel treatment.

Hierarchy comes from alignment, weight, grouping, and order. Sections stack with a hairline top rule, not a pile of cards. Terms flow into a wrapping grid (one column, then two, three, and four). Paper and email comparisons stack on narrow widths and sit side by side from the small breakpoint up. Future screens should feel like this screen.

### Avoid

Generic AI SaaS styling, giant cards, excessive cards, excessive radius, gradients, glassmorphism, grain or noise, decorative shadows, parallax, giant display typography, excessive whitespace, random dark panels, unnecessary animation, marketing-site layouts, decorative status colors, unnecessary icon-library changes, rebuilding navigation for novelty, and local component styling when an approved primitive exists.

### Preserve

Existing product terminology, routes, workflows, sidebar structure, deal navigation, evidence semantics, negotiation and domain behavior, accessibility, Inter, Lucide, the green brand, reduced-motion behavior, and focus-visible behavior.

## Evidence on Hand

- Deal Overview implementation: `components/deals/deal-brief.tsx`, header in `components/deals/deal-header.tsx`, shell in `components/app-shell.tsx`.
- Shared primitives and tokens: `components/ui/` and `app/globals.css`.
- Formal status projection: `lib/deals/brief/formalStatus.ts`.
- Canonical demo and the $67 paper / $72 email story: `docs/demo.md`.
- Catch-up contract: `docs/catch-up.md`.

Do not fabricate customers, testimonials, benchmarks, pricing, or licensing.

## Product Principles

1. The position, side, status, source, and next action are the interface.
2. One consistent status language across the product.
3. Formal paper and communication must remain visibly and semantically distinct.
4. Communication evidence never visually implies that it replaced formal paper.
5. Density is intentional.
6. Hierarchy should come from alignment, weight, grouping, and ordering, not giant typography or excessive whitespace.
7. Commercial values are primary information.
8. Important commercial values should wrap rather than truncate.
9. Evidence should be available at the point of decision.
10. Color communicates facts and state, not decoration.
11. Existing terminology and workflows should remain stable unless there is a demonstrated usability problem.
12. Refinement should preserve product identity and behavior.

## Accessibility & Inclusion

The app is `lang="en"`. Focus-visible is a 2px brand outline, offset 2px. Inside the sidebar the outline uses the sidebar text color. A skip link is present. `prefers-reduced-motion: reduce` collapses animation, transition, and smooth scroll. Status is text, not color alone. Interactive controls keep names, including icon-only controls.
