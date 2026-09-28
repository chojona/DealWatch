# Phase 5 — CRE document ingestion

Negotiation Intelligence V1 stays frozen. This phase adds a document
around that engine. It does not change the extraction prompt, CRE payload
definitions, fixtures, scoring, `resolveStructuredState`, or model selection.

## Current architecture

- Deals, threads, obligations, and events live in SQLite via Prisma.
- A negotiation round is created from pasted text:
  `POST /api/deals/[id]/negotiation/rounds` validates
  `NegotiationDocumentInputSchema`, calls `ingestDocument`, then the
  production `extractTerms` pipeline (Gemini client, structured output,
  `validateExtractedTerms`), then writes one `NegotiationRound` and its
  `NegotiationTerm` rows.
- `NegotiationTerm.evidenceQuote` must be an exact substring of the source
  text. `sourceLocation` is an optional model-supplied section label.
- There is no file store, no page model, and no durable link from a term
  back to a document page. `sourceType` defaults to `PASTED_TEXT`.
- Round numbers are unique per `(dealId, side)`.

## Proposed architecture

`Document` is a first-class record on a deal. `DocumentPage` stores the
extracted text of one PDF page and keeps a stable id. A
`NegotiationRound` may point at the document that produced it. A
`NegotiationTerm` may point at the single page that contains its evidence
quote, plus the exact offsets.

Pasted text and PDF upload share `writeNegotiationRound`. The PDF path
does not add a second extractor. It builds a page-marked string and calls
the existing `extractTerms` function.

```text
PDF bytes
  -> validate size, MIME, %PDF- header, filename
  -> LocalDocumentStorage (gitignored data/documents)
  -> Document row (UPLOADED)
  -> unpdf extractPdfDocument (EXTRACTING)
  -> DocumentPage rows (READY) or FAILED if scanned / unreadable
  -> page-marked text
  -> existing extractTerms (ANALYZING)
  -> locateEvidence against DocumentPage.text
  -> one transaction: NegotiationRound + NegotiationTerms + COMPLETE
  -> existing resolveStructuredState reads those terms unchanged
```

The user selects the deal before upload. No entity matching.

## Schema additions

- `Document` — deal, names, mime, size, sha256, document type, date,
  authoring side, ingestion status, failure code/reason, relative
  storage key, page count.
- `DocumentPage` — document, page number, text. Unique
  `(documentId, pageNumber)`.
- `NegotiationRound.documentId` optional.
- `NegotiationTerm.documentPageId`, `evidenceStartOffset`,
  `evidenceEndOffset`, `provenanceStatus` (`EXACT`, `AMBIGUOUS`,
  `UNLOCATED`).

Enums: `DocumentType`, `DocumentIngestionStatus`,
`EvidenceProvenanceStatus`.

`negotiationSide` is ingestion metadata for the round. It is not a Person,
Company, or Property id. Structured payloads still must not embed those ids.

SQLite does not store PDF bytes.

## Storage

`DocumentStorage` exposes `put`, `get`, `delete`, and `exists`.
`LocalDocumentStorage` writes:

```text
data/documents/<document-id>/<sanitized-filename>
```

The directory is gitignored. Keys are relative. Document ids must match
`[A-Za-z0-9_-]`. Filenames are sanitized. Resolved paths must stay inside
the storage root. `S3DocumentStorage` can implement the same interface
later. API responses never include `storageKey` or an absolute path.

Duplicate content is the unique pair `(dealId, sha256)`. The same bytes on
another deal are a separate document.

Default max size is 20 MB (`DOCUMENT_MAX_BYTES`).

## PDF parsing

`unpdf` 1.8 (PDF.js, Node 22, no OCR, no network). `extractText` is called
with `mergePages: false`. `extractPdfDocument` returns `pageCount`,
`pages[]`, and `fullText`.

Normalization is limited to null bytes, newline forms, trailing line
whitespace, and runs of more than two blank lines. Wording is not rewritten.

A PDF whose pages have no non-whitespace text is `SCANNED_OR_EMPTY`.
That includes image-only scans. OCR is out of scope.

## Provenance

The model sees:

```text
--- PAGE 1 ---
<page text>

--- PAGE 2 ---
<page text>
```

`validateExtractedTerms` still requires `evidenceQuote` to be an exact
substring of that string. `locateEvidence` then searches each
`DocumentPage.text`, not the marker lines.

- One page contains the quote: `EXACT`, with that page id and offsets.
  Repeated hits on the same page stay on that page (first offset).
- Two or more pages contain it: `AMBIGUOUS`. No page id is stored.
- No page contains it: `UNLOCATED`.

Model text that looks like a page claim (`Page 9`) is dropped from
`sourceLocation`. A section heading is kept. The UI page label comes only
from `provenanceStatus` and `DocumentPage.pageNumber`.

## Failure, retry, and transactions

File bytes and database rows cannot commit together.

1. Reject empty, oversized, and non-PDF input before inserting a row.
2. Insert `Document` (`storageKey = pending`), then write the file. A
   storage failure marks `FAILED` / `STORAGE_FAILED` and leaves the row
   for retry.
3. Extraction failure marks `FAILED` / `EXTRACTION_FAILED`. The file
   remains. No round is created.
4. Scanned or empty text marks `FAILED` / `SCANNED_OR_EMPTY`. A later
   upload of the same bytes returns that row and does not call the model.
5. Analysis runs only after pages are `READY`. The model call sits outside
   the write transaction so a slow request does not hold a SQLite lock.
6. The round, all of its terms, and `COMPLETE` commit in one transaction.
   If a round for that document already exists inside the transaction, the
   writer does not create another. A thrown error rolls the round and
   terms back and marks `FAILED` / `ANALYSIS_FAILED`. Pages stay.
7. Re-uploading the same sha256 after `ANALYSIS_FAILED` reuses the
   document and runs analysis again. Re-uploading after `COMPLETE`
   returns the existing document and round.

Pasted-text rounds still use `sourceType = PASTED_TEXT` and a null
`documentId`. Round numbers stay per side across both paths.

## Security

- Size limit, PDF MIME allow-list, and `%PDF-` magic bytes.
- Sanitized storage names and a generated document id. Uploaded names are
  display data only.
- No shell, no path returned to the client, no execution of PDF content.
- `GET /api/documents/[id]/file` loads bytes by document id, then by the
  stored relative key, and serves `application/pdf` with `nosniff`.
- Page text still enters the model only as data inside the existing
  `DOCUMENT_TEXT_START` / `DOCUMENT_TEXT_END` envelope. The prompt is
  unchanged.

There is still no authentication layer. That matches the current local API.

## API

- `POST /api/deals/[id]/documents` — multipart `file`, `side`,
  `documentDate`, `documentType`. Optional `phase=extract` stops after
  page text. The default runs analysis too.
- `GET /api/deals/[id]/documents`
- `GET /api/documents/[id]`
- `POST /api/documents/[id]` — run analysis for an extracted document.
  The upload form uses extract, then this call, so the screen can show
  Uploading, Extracting, Analyzing, Complete, and Failed.
- `GET /api/documents/[id]/file` — inline PDF.

`COMPLETE` is 201 (200 when the same bytes were already ingested).
Expected extraction or analysis failure is 422 and includes the document.
Unsupported files are 400, 413, or 415 and create no row.

## UI

On the deal negotiation page: an upload form (PDF, side, date, type) and
a document list (name, type, date, pages, term count, status, preview,
view-PDF link, link to term history). Term detail for a PDF round shows
the filename, page label, evidence quote, and “View source PDF”. Pasted
rounds keep the previous source line.

## Knowledge-graph compatibility

A later observation can reference `DocumentPage.id` without moving PDF
bytes into the negotiation payload. `Document` does not belong to a
`NegotiationRound`; the round points at the document. Nothing here creates
Person, Company, Property, or relationship tables.

## Deliberately not in this phase

OCR, DOCX, email, offering memorandums, executed-lease abstraction, remote
URLs, cloud storage, entity resolution, and the connection map.
