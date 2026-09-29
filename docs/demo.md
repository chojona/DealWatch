# Canonical demo

One disposable deal shows the DealWatch distinction between historical activity, current formal paper, reviewed communication, and action evidence.

The deal is **Acme Acquisition — DealWatch Demo**. Its id is `dealwatch-demo-acme`. It lives in the Default workspace, which is the workspace the app reads. Reset deletes that id only.

## Prerequisites

- Local SQLite database at `prisma/dev.db` (`DATABASE_URL="file:./dev.db"`).
- Dependencies installed (`npm ci`).
- The schema applied (`npm run db:push`).

`OPENAI_API_KEY` and `GEMINI_API_KEY` are not required. The reset process uses the checked-in fixtures and the deterministic activity reader. It does not call a model.

## Reset

```bash
npm run demo:reset
```

The command:

1. Refuses when `NODE_ENV` is `production`.
2. Refuses unless `DEALWATCH_DEMO_RESET=canonical-demo` (the npm script sets this).
3. Refuses unless the connected database is `prisma/dev.db` or a SQLite file under the temporary directory.
4. Deletes only deal `dealwatch-demo-acme`, including its documents, messages, and stored files.
5. Rebuilds that deal.
6. Checks the canonical invariants and prints the deal paths.

Running it again restores the same logical state. Generated child ids change. Counts, values, review states, and relationships do not.

Other deals are left in place. That includes **200 Clarendon Lease — Acme Corp** from `npm run db:seed`. If some other deal is already named `Acme Acquisition — DealWatch Demo`, the command refuses and deletes nothing.

## Expected state

| Source | What it shows |
| --- | --- |
| Legacy activity, 1 Sep 2026 | Historical `$72.50`. Not a negotiation term. |
| Earlier landlord proposal | Formal paper Base Rent `$72.00`, accepted. |
| `acme-acquisition-loi.pdf` | Current formal Base Rent `$67.00`, accepted. |
| `acme-revised-rent.eml` | Reviewed communication: the landlord can do `$72.00`. Reconciliation is DIFFERS. |
| Revised proposal email | Reviewed request. A later email fulfills it, so the action is closed. |
| Insurance certificate email | Reviewed request. Still open. |
| `acme-loi.eml` | Imported email with `acme-loi.pdf` attached. Not analyzed. Eligible for Promote to document. |

DealBrief current formal Base Rent is `$67`. The brief also says paper and communication differ.

## Five-minute walkthrough

1. **Overview** (`/deals/dealwatch-demo-acme`). DealWatch says formal paper is `$67`. The brief also says paper and communication differ: `$67` versus `$72`.
2. **Activity**. There is a historical `$72.50`. There is also an earlier formal `$72` and the current formal `$67`. History does not override the current paper.
3. **Negotiation**. The current landlord position is `$67`, from the LOI. Open that document and read the Base Rent line.
4. **Messages**. Open **Revised rent**. The reviewed email says `$72` and does not change the formal term. Open **Revised proposal** and **Revised proposal attached** to see the request and the later message that fulfilled it. The insurance request is still open.
5. **Attachment**. Open **Acme LOI**. Show the PDF attachment. Choose **Promote to document**, then open the new document and complete its metadata if the form asks. Stop there. Analyzing that promoted PDF uses the live provider configured for the app. The reset fixtures do not depend on that call, and this PDF is not the `$67` formal source.

After the walkthrough, `npm run demo:reset` returns the attachment to the unpromoted email.

## Safety

The reset is a local script. There is no production API for it.

It will say why it refused. Typical reasons:

- `NODE_ENV` is production.
- `DEALWATCH_DEMO_RESET` is missing. Run `npm run demo:reset` rather than the script alone.
- `DATABASE_URL` is not a local SQLite file, or the file is not `prisma/dev.db` and not under the temporary directory.

## Deterministic versus live analysis

Reset and the canonical `$67` / `$72` / action story are deterministic. Message facts come from the existing deterministic activity reader. Paper terms come from a fixture extractor passed into the normal document analysis service. Neither path is available to ordinary production requests.

Promoting the Acme LOI attachment and then clicking Analyze uses whatever provider the running app is configured to use. Do not treat that click as part of the deterministic demo.

Browser end-to-end tests keep their own database and their own `DEALWATCH_E2E` extractor. Resetting this demo does not reset that database, and those tests do not require this deal.
