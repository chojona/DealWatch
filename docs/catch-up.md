# Deal catch-up (`since`)

Deal catch-up answers “What changed on this deal since time X?” It filters
change-oriented projections; it is not a historical snapshot and does not
reconstruct the deal as it existed at X.

## Request contract

- `since` is optional and may be provided once.
- Its value must be an offset-aware ISO 8601 date-time:
  `YYYY-MM-DDTHH:mm[:ss[.SSS]]Z` or the equivalent with a numeric offset such
  as `2026-09-29T14:30:00-04:00`.
- Date-only and offset-free local values are rejected because they do not
  identify an instant. Malformed and impossible calendar values are rejected.
- The parser normalizes an accepted value to a JavaScript `Date`; Brief output
  reports that instant in UTC with `toISOString()`.
- The boundary is exclusive. An event is in the catch-up window only when its
  timestamp is strictly greater than `since`. This matches “after I last saw
  the deal.”
- The Brief API responds with HTTP 400 and its validation message for an
  invalid value. The Deal page shows an invalid catch-up state and does not
  read or render an unfiltered Brief.

## Data flow

```text
/deals/{id}?since=...                 /api/deals/{id}/brief?since=...
             |                                      |
             +---------- parseDealBriefQuery -------+
                                |
                       getDealBrief({ since })
                                |
          +---------------------+---------------------+
          |                                           |
 current-state projections                    catch-up projections
          |                                           |
 negotiation terms, actions,                communications, meaningful
 paper/communication comparisons,           recent changes, timeline
 current attention and processing issues
```

The page adapter preserves repeated values so the shared parser can reject an
ambiguous request instead of silently dropping it. Workspace identity remains
server-controlled and is checked independently of `since`.

## Timestamp comparisons

All catch-up comparisons use the same exclusive rule:

- Communications use `sentAt`, falling back to `receivedAt`, then `createdAt`.
  Both the database count and in-memory projection use `> since`.
- Formal change rows use the negotiation round's `documentDate`.
- Confirmed communication-fact changes use the fact review's `createdAt`.
- Corrections use the correction's `createdAt`.
- Meaningful document milestones use the milestone's `occurredAt`.
- Document-added changes use the document upload's `createdAt` (`uploadedAt`
  in the inbox projection).
- Legacy events use `occurredAt`.
- Timeline items use their event instant. A document's timeline event uses its
  upload instant, not `documentDate`: the latter is a calendar date stated by
  the paper and is not an offset-aware ingestion instant.

`ANALYZED` document milestones are processing completion chatter. They remain
available in the ordinary all-time chronology but are omitted from catch-up
timeline totals and rows. They have never been classified as meaningful Recent
Changes.

## Current state versus changes

The following remain current-state projections and are not filtered by
`since`:

- deal header, summary, status, and canonical deal fields;
- current formal negotiation positions and their source links;
- outstanding actions, including actions created before the boundary;
- current paper/communication comparisons and discrepancies;
- current commercial attention and system-review/processing issues.

This means a pre-boundary formal Base Rent position remains visible while the
formal round that established it is absent from the catch-up timeline. The same
rule preserves an older outstanding action or current discrepancy without
re-presenting its creation as a new change.

Processing failures stay in System review. They are not promoted into
commercial attention or Recent Changes to make a catch-up window look busy.
Because System review describes outstanding current remediation, an unresolved
failure may remain visible even when it predates `since`.

## Counts and empty windows

`preview.returned` is the bounded payload count and `preview.total` is the
available count after applying the catch-up window but before the Brief cap for
communications, changes, and timeline. Events outside the window never create
a hidden-remainder label.

When the filtered projections contain no meaningful changes, the page says
“No meaningful changes since …” and gives corresponding calm empty copy for
communications and timeline. Current formal state, actions, comparisons, and
processing issues remain present; “no changes” does not mean “empty deal.”

## Deferred automatic catch-up

Per-user `lastViewedAt` remains deferred. Once authenticated user identity has
stable product semantics, a future flow can resolve:

```text
authenticated user -> lastViewedAt -> automatic explicit catch-up window
```

No schema, authentication, or view tracking is introduced by the current
explicit `since` contract.
