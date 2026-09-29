# Document review demo

Repeatable smoke path for one uploaded commercial document. Use a real text-based PDF of your own. Do not treat the automated test fixture as a customer file. The historical 200 Clarendon LOI stays as development data with no manufactured source PDF.

Playwright is not part of this repository. Walk this path in the running app.

## Expected states

1. Open Inbox at `/inbox`.
   Documents that still need a human decision appear under Needs Review. A document with no outstanding review work appears under Complete.

2. Upload a text-based PDF onto a deal through the normal upload flow.
   The new document is separate from the 200 Clarendon LOI. The inbox shows it as not ready, ready to prepare, or ready to analyze depending on the file and metadata.

3. Open review from the document row.
   The header names the file, the deal, and the current review state. If the stored PDF is present, Open PDF works. Page text is not loaded by downloading the PDF during render.

4. Complete metadata.
   Set document type, authoring side, and document date only when you know them. The page lists any missing side or date. It does not invent them.

5. Analyze.
   After analysis, the state is Review required. Extracted negotiation findings are listed with their stored values. Running analysis again does not duplicate the round.

6. Show extracted negotiation findings.
   Each finding shows the term, the structured value when one was stored, and the evidence quote. DealWatch does not choose a conflict winner.

7. Open exact evidence.
   An exact quote links to the stored PDF page. Ambiguous or unlocated quotes say so and can be corrected or acknowledged.

8. Review findings.
   Acknowledge each finding. Acknowledge each conflict without picking a value. Flagging Needs follow-up keeps the document in Review required.

9. Resolve an entity.
   Resolve or create a canonical person, company, or property only when you mean to. That is the promotion step.

10. Leave one unresolved.
    Leave unresolved means you reviewed the observation and chose not to resolve it yet. The observation stays. It does not become a rejected fact, and it does not create a Person, Company, or Property.

11. Approve a relationship.
    Approve only when every endpoint is resolved. Approval is what creates the canonical employment, stake, or participation.

12. Acknowledge a blocked relationship.
    If an endpoint was left unresolved, the relationship shows BLOCKED — unresolved endpoint. Acknowledge blocked closes the review item and does not create a canonical edge.

13. Reach REVIEWED.
    The completion summary counts findings, conflicts, resolved entities, intentionally unresolved entities, approved, rejected, and acknowledged blocked relationships, and evidence. The banner says review complete and that completion does not promote every observation. Result is REVIEWED.

14. Open Negotiation.
    Extracted terms and structured values are still there. Review decisions do not change them.

15. Open Knowledge.
    Only promoted canonical records appear. A left-unresolved entity is absent. An acknowledged blocked relationship is absent.

16. Open Connection Map.
    Only canonical assertions appear. Support counts belong to those assertions.

17. Open Activity.
    Document analyzed and document review complete appear. Individual acknowledge clicks do not.

Reviewed is not terminal. Reopen a left-unresolved entity, resolve it, or flag a finding for follow-up. Outstanding work returns the document to Review required. History keeps the earlier actions and labels the actor Manual review.

## Development reset

On a non-production review page, Remove this document deletes that document and review data that exists only for it. Shared canonical entities and assertions are kept, and the response lists anything retained. The action is refused in production. It is not a workspace wipe.

## Automated fixture

`lib/documents/fixtures/creReviewFixture.ts` builds a fictional one-page PDF for `npm test`. It is marked TEST / FICTIONAL and is not a demo customer document.
