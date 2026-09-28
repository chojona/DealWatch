import { z } from "zod";

/**
 * Source-neutral ingestion boundary. Pasted text is the only enabled source;
 * PDF extraction can later produce the same payload without changing analysis.
 */
export const NegotiationDocumentInputSchema = z.object({
  sourceType: z.literal("PASTED_TEXT").default("PASTED_TEXT"),
  documentName: z.string().trim().min(1).max(240),
  documentText: z.string().max(120_000).refine((value) => value.trim().length > 0),
  documentDate: z.string().refine((value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime());
  }, "Document date must be valid"),
  side: z.enum(["TENANT", "LANDLORD"]),
});

export function ingestDocument(
  input: z.infer<typeof NegotiationDocumentInputSchema>
) {
  return {
    ...input,
    documentText: input.documentText.trim(),
    documentDate: new Date(input.documentDate),
  };
}
