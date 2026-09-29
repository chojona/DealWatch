# Document lifecycle projection

DealWatch keeps three backend dimensions separate and projects them into one consistent user-facing lifecycle. The database enums are not renamed or collapsed.

## Backend state

`Document.ingestionStatus` owns stored-PDF preparation and negotiation analysis:

| State | Meaning |
| --- | --- |
| `UPLOADED` | PDF bytes exist. Promoted attachments may not have extracted pages yet. |
| `EXTRACTING` | Embedded PDF text is being extracted. |
| `READY` | Usable page text and required metadata are present; negotiation analysis can run. |
| `ANALYZING` | Negotiation extraction is running. |
| `COMPLETE` | One document-linked `NegotiationRound` was saved. |
| `FAILED` | Preparation or negotiation analysis failed; `failureCode` identifies which. |

`Document.graphExtractionStatus` is independent: `NOT_RUN`, `SUCCEEDED`, or `FAILED`. A document can therefore have negotiation analysis `COMPLETE` while knowledge extraction is `FAILED`.

Review is not a stored Document enum. It is projected from current open work after negotiation analysis completes. Open work is:

- a negotiation finding or conflict that is pending or marked needs follow-up;
- an entity observation that is neither resolved, rejected, nor explicitly left unresolved;
- a relationship that is neither approved, rejected, nor acknowledged as blocked;
- ambiguous or unlocated evidence that is neither corrected nor acknowledged, including evidence marked needs follow-up.

`FormalTermReview` is a separate decision about the effective formal negotiation value. It does not itself close the document review item; the adjacent finding `ReviewDecision` does. This preserves Formal Negotiation Truth and makes the distinction explicit in the UI.

## User-facing projection

The Documents list and Document Review use the same primary labels:

| Derived condition | Primary label | Analysis | Review |
| --- | --- | --- | --- |
| PDF stored, authoring side or date missing | Needs metadata | Waiting for metadata | Not started |
| Required metadata and source available | Ready to analyze | Ready to analyze | Not started |
| Extraction or analysis running | Analyzing | Extracting text or Analyzing | Not started |
| Negotiation analysis failed | Analysis failed | Analysis failed | Not started |
| Graph extraction failed after negotiation analysis | Knowledge extraction failed | Analysis complete | Needs review or Reviewed |
| Negotiation analysis complete with open review work | Needs review | Analysis complete | Needs review |
| Negotiation analysis complete with zero open review work | Reviewed | Analysis complete | Reviewed |

For a promoted `UPLOADED` PDF, extracted pages are not a user prerequisite. Once authoring side and document date are stored, Analyze is eligible and the existing POST path extracts pages before running analysis.

Review closes automatically when open work reaches zero. If a decision is cleared, marked needs follow-up, or new review work appears later, the derived status returns to Needs review. The historical `DOCUMENT_REVIEWED` milestone is not deleted when live review reopens.

## Retry safety

`ANALYSIS_FAILED` and recoverable graph failures expose Retry. Extracted pages remain stored. Negotiation save is transactional, and a document with an existing round returns idempotently, so retry does not create a second round or duplicate its terms or formal-review state. Graph runs are keyed by document, extractor version, and model; a successful identical run is idempotent. Successful retry clears the relevant stored failure fields.

## Removed routes

`/documents/[id]/resolution` was an unreferenced redirect to Document Review. No application links or tests depended on it, so it was removed instead of preserving an abandoned product concept.

The public `DELETE /api/documents/[id]` handler was also removed. Its behavior was not semantically safe: graph references blocked deletion, while a document without graph references could be deleted even though its negotiation round, terms, and formal-term reviews survived through `onDelete: SetNull`. Document review decisions, evidence corrections, milestones, pages, and attachment-promotion provenance cascaded away. The resolver and Brief could therefore keep detached formal terms after their Document provenance disappeared. The development-only demo reset remains a separate, production-refused workflow with explicit dependency handling.
