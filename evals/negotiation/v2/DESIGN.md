# CRE Ontology Evaluation V2

Phase 4 of the DealWatch CRE ontology work. This document is the specification
for the second evaluation layer. It does not change extraction, prompts,
payload schemas, or `resolveStructuredState`.

V1 remains the frozen historical baseline. V2 never contributes to a V1
metric and is never averaged with V1 into a single score.

## 1. How V1 remains frozen

- `evals/negotiation/fixtures.ts` gold (`expectedTerms`, `expectedState`) is
  not modified.
- V1 metrics in `evals/negotiation/scoring.ts` and `types.ts` are not
  redefined: precision, recall, F1, numeric accuracy, normalizedValue
  accuracy, evidence validity/support, assertion status, flat current state,
  flat final status, agreement, false positives, unexpected states.
- `npm run eval:negotiation` is unchanged in behavior and report schema
  (`schemaVersion: "1.0"`).
- V2 expectations live in `evals/negotiation/v2/expectations.ts`, keyed by
  V1 `fixtureId` / `expectedTermId` / `documentId`. Document text is not
  duplicated.

## 2. V2 expectation format

A V2 fixture expectation is:

```ts
{
  fixtureId: string;            // V1 NegotiationFixture.id
  documents?: [{
    documentId: string;         // V1 EvaluationDocument.id
    expectedPayloads: [{
      expectedTermId: string;   // V1 ExpectedTerm.id
      payload: CREStructuredPayload;
    }];
  }];
  expectedStructuredState: [{
    canonicalType: CRETermType;
    status: NegotiationTermStatus;
    tenantPayload?: CREStructuredPayload;
    landlordPayload?: CREStructuredPayload;
    agreedPayload?: CREStructuredPayload;
    conflictExpected?: boolean;
    conflictSide?: "TENANT" | "LANDLORD";
    conflictCandidates?: CREStructuredPayload[];
    isCarryForward?: boolean;
    carryForwardSide?: "TENANT" | "LANDLORD";
  }];
}
```

Canonical payloads are authored once in `payloadLibrary.ts` and reused by
live expectations and oracle observations.

Covered V1 fixtures (high-value plus baselines):

| Fixture | Why |
|---|---|
| n01, n03, n04, n17 | Straightforward baselines |
| n06, n15 | Carry-forward |
| n07 | Stepped rent schedule |
| n08 | Conditional TI / commencement (conditions) |
| n09 | Irregular + partial free rent |
| n10, n11, n12 | Rights package |
| n13 | Same-side contradiction |
| n16 | Implicit agreement |
| n20 | Multi-round partial agreement |

Oracle-only (no V1 fixture duplication):

- `oracle-carry-forward-rent-ti` — Round 1 rent $65 + TI $110; Round 2 rent $67; expected rent $67 and TI $110.
- `oracle-annual-escalation` — representative 3% annual escalation.

## 3. Metric definitions

V1 asks: did we extract the expected flat observations?

V2 asks: did we understand the CRE structure and resolve negotiation state?

### Structured extraction

| Metric | Definition |
|---|---|
| Payload coverage | Share of expected structured payloads that were actually produced. |
| Payload validity | Share of produced payloads that pass Zod (`parseStructuredPayload`). |
| Semantic payload accuracy | Mean `scorePayload(actual, expected)` in `[0, 1]`. Not a JSON-string compare. |
| Schedule accuracy | Mean per-step score on stepped `BASE_RENT`. |
| Period accuracy | Mean per-period score on irregular `FREE_RENT`. |
| Rights accuracy | Mean semantic score on `RENEWAL_OPTIONS`, `TERMINATION_RIGHTS`, `EXPANSION_RIGHTS`. |
| Conditions accuracy | Mean conditions-list score when conditions are expected. |

Oracle runs set coverage and validity to 100% by construction (hand-authored
valid payloads). Semantic / schedule / period / rights / conditions are still
measured on the *resolved* payload vs expected, so a resolver that drops
structure cannot hide behind coverage.

### Structured state

Evaluated on `resolveStructuredState` output, separately from extraction.

| Metric | Definition |
|---|---|
| Tenant position | Binary: resolved tenant payload semantically perfect vs `tenantPayload`. |
| Landlord position | Same for landlord. |
| Agreement | `status === AGREED` with matching `agreedPayload` when expected; no false AGREED otherwise. |
| Conflict detection | When `conflictExpected`: side is `CONFLICT`, all candidates present, not AGREED, not a silent pick of A or B. When not expected: no CONFLICT. |
| Carry-forward | Omitted later-round term still matches the prior payload. Omission is not withdrawal. |
| Provenance validity | Every resolved `observationId` (including nested step/period refs) is a real input term id, never `"pending"`, and the source term still has evidence. |

State metrics are binary (perfect vs not). Partial credit lives only in the
extraction semantic / schedule / period averages.

## 4. Partial-credit rules

Implemented in `evals/negotiation/v2/scoring.ts`. Score = raw / max.

**BASE_RENT**

- Classification (simple vs stepped) must match. Wrong class gets 0 classification points.
- Simple: amount (tolerance 0.1%) + optional rentStructure.
- Stepped: step count + **each expected step independently** (startMonth, endMonth, amount). Matching only the last-step amount is not full credit.

**FREE_RENT**

- Contiguous vs irregular must match.
- Contiguous: months, abatement type, optional partialPct, scope.
- Irregular: period count + **each period independently** (start, end, type, optional pct).
- `equivalentFullMonths` is a **derived** 0.5-point component. A matching total with wrong period boundaries cannot produce a perfect score.

**RENEWAL_OPTIONS** — option count; per option duration, pricing method, optional pricing value and notice; conditions list.

**TERMINATION_RIGHTS** — right presence; eligibleAfterMonth or Year; noticeMonths; fee kind (+ months or description); conditions.

**PARKING** — spaces, rate, rate type, reserved, independently. Missing expected fields are not scored.

**OPERATING_EXPENSES** — structure, cap, taxes/insurance uncapped, exclusions.

**ANNUAL_ESCALATION** — frequency, kind, percent / fixed / CPI cap-floor / greater_of arity, firstEscalationMonth.

**EXPANSION / ROFO / ROFR** — rightKind, applicableSpace (containment), trigger, pricing, notice, conditions.

**TI_ALLOWANCE / COMMENCEMENT_DATE** — amount/unit or fixedDate; conditions.

Binary state “correct” requires `scorePayload === 1` (floating-point epsilon).

## 5. Failure attribution

Every V2 failure records one of:

| Phase | Meaning |
|---|---|
| EXTRACTION | Model emitted the wrong (or missing) payload. |
| VALIDATION | Raw `structuredPayload` failed Zod. Term may still exist as a flat observation. |
| RESOLUTION | Extraction was perfect (or oracle input was perfect) and `resolveStructuredState` produced the wrong state. |
| SCORING | Reserved for internal comparison errors. |

Live scoring: if any expected payload for a type was not perfectly extracted,
subsequent state mismatches for that type are attributed to EXTRACTION. If
extraction was perfect, state mismatches are RESOLUTION.

Oracle scoring: always RESOLUTION. The observations are definitionally
correct, so a miss is a resolver problem.

## 6. Resolver oracle methodology

`npm run eval:negotiation:v2` (default `--oracle`) feeds
`oracleFixtures.ts` into `resolveStructuredState` with **no model**.

Each oracle observation has a stable real id (never `"pending"`), a typed
payload, side, round, status, and evidence quote.

Required ceiling cases (perfect observations → 100% state accuracy):

- n07 stepped rent (three observations, each carrying the full 3-step schedule)
- n09 irregular free rent (five periods including a 50% month)
- n13 contradictory draft (CONFLICT with both $64 and $62)
- n10 / n11 / n12 rights
- `oracle-carry-forward-rent-ti`

If any of those are not 100%, the failure is a resolver bug. Phase 4 does
not fix it.

## 7. Conflict scoring

n13 gold:

```
CONFLICT (landlord)
  candidate A: simple $64
  candidate B: simple $62
status: UNRESOLVED
agreed: absent
```

Incorrect: picking A, picking B, declaring AGREED, dropping either candidate.

## 8. Carry-forward scoring

`oracle-carry-forward-rent-ti`:

```
Round 1  Rent $65   TI $110
Round 2  Rent $67
Expected Rent $67   TI $110
```

n06 and n15 are the live-fixture counterparts.

## 9. Report shape

CLI output (live mode) is two sections, never one blended score:

```
DealWatch Negotiation Intelligence

V1 FLAT BENCHMARK
  …existing V1 summary…

V2 CRE ONTOLOGY
  Structured Extraction
    Payload coverage / validity / semantic / schedule / period / rights / conditions
  Structured State
    Tenant / landlord / agreement / conflict / carry-forward / provenance
  Weakest structured scenarios
  Failures (attributed)  [EXTRACTION|VALIDATION|RESOLUTION|SCORING]
```

Oracle mode prints only the V2 section.

JSON:

- V1: `artifacts/negotiation-eval.json` (`schemaVersion: "1.0"`)
- V2 oracle: `artifacts/negotiation-eval-v2-oracle.json` (`schemaVersion: "2.0"`)
- V2 live: `artifacts/negotiation-eval-v2.json`

## 10. Commands

V1 only (frozen):

```
npm run eval:negotiation
```

V2 oracle (no paid API):

```
npm run eval:negotiation:v2
npm run eval:negotiation:v2 -- --oracle --fixture n07-stepped-rent
```

Live GPT-5.4 Mini V2 (also runs frozen V1):

```
DEALWATCH_AI_PROVIDER=openai DEALWATCH_NEGOTIATION_MODEL=gpt-5.4-mini \
  npm run eval:negotiation:v2 -- --live
```

Do not run the live command as part of default CI. Oracle tests run in
`npm test`.

## 11. Known issues discovered in Phase 4 (not fixed)

### Resolver: one-sided UNRESOLVED collapses to PROPOSED

`deriveStatus` in `resolveStructuredState` returns `PROPOSED` whenever only
one side has an active position, even if that observation's status is
`UNRESOLVED`.

n08 (“subject to investment committee approval”) is UNRESOLVED in V1 and in
V2 gold. With perfect observations the structured resolver currently emits
`PROPOSED`. Live V2 will attribute that miss to RESOLUTION. Locked in
`evals/negotiation/v2/oracle.test.ts` as a documented limitation.

### Schema: compound termination fees

n11 fee is “unamortized TI and commissions **plus** three months of then-
current Base Rent”. `TerminationFeeSchema` is a single-kind union and cannot
represent both. V2 gold uses `unamortized_costs` with both components in
`description`. This is a schema limitation, not a resolver bug. Not changed
in Phase 4.

### n20 commencement landlord carry-forward

The tenant amendment says both parties confirm an unconditional October 1,
2027 date. The landlord never emitted a later observation, so the structured
resolver correctly carries the landlord's vacant-possession *condition*
forward while taking AGREED from the tenant assent. V2 gold matches that
resolver contract. Whether a commercial reader would treat “both parties
confirm” as updating the landlord position is a product question, not a
Phase 4 scoring change.

## 12. What Phase 4 did not do

- No extraction prompt or model-selection changes
- No payload schema changes to improve scores
- No `resolveStructuredState` changes to improve scores
- No V1 gold edits
- No UI, economics, knowledge-graph entities, PDF ingestion, or DB caching
