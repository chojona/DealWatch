import { INBOX_FILTERS, type InboxFilter } from "./types";

export class InboxQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxQueryError";
  }
}

const DOCUMENT_TYPES = new Set([
  "LOI",
  "PROPOSAL",
  "COUNTERPROPOSAL",
  "TERM_SHEET",
  "AMENDMENT",
  "RENEWAL_PROPOSAL",
  "OTHER",
]);

export interface InboxQuery {
  filter: InboxFilter;
  dealId: string | null;
  documentType: string | null;
  negotiationSide: "TENANT" | "LANDLORD" | null;
  q: string | null;
}

export function parseInboxQuery(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
}): InboxQuery {
  if (searchParams.has("workspaceId")) {
    throw new InboxQueryError("workspaceId is server-controlled");
  }
  const filter = (searchParams.get("filter") ?? "ALL").toUpperCase();
  if (!INBOX_FILTERS.includes(filter as InboxFilter)) {
    throw new InboxQueryError("filter must be ALL, NEEDS_REVIEW, PROCESSING, COMPLETE, or FAILED");
  }
  const documentType = searchParams.get("documentType");
  if (documentType && !DOCUMENT_TYPES.has(documentType)) {
    throw new InboxQueryError("documentType is not a known document type");
  }
  const side = searchParams.get("side");
  if (side && side !== "TENANT" && side !== "LANDLORD") {
    throw new InboxQueryError("side must be TENANT or LANDLORD");
  }
  const dealId = searchParams.get("dealId")?.trim() || null;
  const q = searchParams.get("q")?.trim() || null;
  return {
    filter: filter as InboxFilter,
    dealId,
    documentType,
    negotiationSide: side === "TENANT" || side === "LANDLORD" ? side : null,
    q,
  };
}
