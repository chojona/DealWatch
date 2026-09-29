# Document date timezone shift

A document date entered as `2026-09-15` can display as **Sep 14**. The stored value is still the 15th. The day moves because a date-only calendar value is saved as UTC midnight and then formatted in the viewer's local timezone.

## What is entered

Document date inputs are `<input type="date">`. The browser submits a date-only string, `YYYY-MM-DD`, with no time and no offset.

- Upload: `components/negotiation/upload-document-form.tsx`
- Add round: `components/negotiation/add-round-form.tsx`
- Metadata edit: `components/documents/review-actions.tsx` (`documentDate?.slice(0, 10)`)

## How it is stored

`Document.documentDate` and `NegotiationRound.documentDate` are Prisma `DateTime` fields. They hold an instant, not a calendar day.

Both write paths turn `2026-09-15` into `2026-09-15T00:00:00.000Z`:

- Upload (`app/api/deals/[id]/documents/route.ts`) calls `new Date(parsed.documentDate)`. A date-only ISO string is defined as UTC midnight.
- Metadata save (`app/api/documents/[id]/metadata/route.ts`) builds that instant explicitly: `` new Date(`${body.documentDate.slice(0, 10)}T00:00:00.000Z`) ``.

DTOs then serialize with `toISOString()`, so clients receive `2026-09-15T00:00:00.000Z`.

The date editor stays on the 15th because it reads the first ten characters of that string. The shift is in display, not in the saved calendar day.

## Why the label moves back one day

`2026-09-15T00:00:00.000Z` is 8:00 PM on September 14 in US Eastern (UTC−4 in September), and 5:00 PM on September 14 in US Pacific (UTC−7). Any formatter that converts that instant into local time prints the previous calendar day for viewers west of UTC.

`lib/formatters.ts` `formatDate` does that conversion. It passes the `Date` to date-fns `format`, which uses the runtime local timezone:

```ts
return format(d, "MMM d, yyyy");
```

Document dates that go through `formatDate` are the ones that shift:

- Inbox document date: `components/inbox/inbox-view.tsx`
- Document review “Document date”: `components/documents/document-review-workspace.tsx`

Example, America/New_York:

| Entered | Stored | `formatDate` label |
| --- | --- | --- |
| `2026-09-15` | `2026-09-15T00:00:00.000Z` | Sep 14, 2026 |

East of UTC the same instant is still September 15, so the bug only shows up in timezones behind UTC. Dates near midnight UTC are the ones that cross a local day boundary. A true timestamp such as `2026-09-15T12:00:00.000Z` does not shift in the continental US.

## Surfaces that already keep the calendar day

These format the same instant with `timeZone: "UTC"`, so `2026-09-15T00:00:00.000Z` stays Sep 15:

- `components/negotiation/negotiation-workspace.tsx` (`date`)
- `components/negotiation/negotiation-matrix.tsx`
- `components/negotiation/upload-document-form.tsx` (completion summary)
- `components/deals/deal-overview.tsx` (`utcDate`)
- `lib/deals/actions/evidenceReviewView.ts` (`formatSourceDate`)

The same calendar date can therefore read Sep 15 on the deal overview and Sep 14 in the inbox.

## What this is not

Timestamps that are real instants — upload time, message sent time, review time — should keep local or explicit-zone formatting. Only date-only fields (`documentDate`, and the same pattern anywhere a `YYYY-MM-DD` value is stored as UTC midnight) need the calendar day preserved.

`formatDate` is also used for deal “Since” and obligation due dates. Those shift the same way when the value is UTC midnight. Fixing document dates means formatting date-only values on the UTC calendar day (or storing a date without a time), and leaving true timestamps on the instant formatters.
