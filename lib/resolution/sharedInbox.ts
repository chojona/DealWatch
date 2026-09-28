import { normalizeEmail } from "@/lib/entities/normalize";

/**
 * Role mailboxes are not unique person identifiers.
 * PersonIdentifier uniqueness is unchanged: a shared inbox still cannot be
 * stored on two people. The resolver simply refuses to treat it as identity.
 */
const SHARED_LOCAL_PARTS = new Set([
  "leasing",
  "info",
  "contact",
  "hello",
  "admin",
  "office",
  "team",
  "reception",
  "inquiries",
  "inquiry",
  "sales",
  "support",
  "billing",
  "accounts",
  "marketing",
  "press",
  "media",
  "careers",
  "jobs",
  "hr",
  "legal",
  "compliance",
  "noreply",
  "no-reply",
  "donotreply",
  "newsletter",
  "general",
  "main",
]);

export function isSharedInbox(email: string): boolean {
  const normalized = normalizeEmail(email);
  const local = normalized.split("@")[0] ?? "";
  return SHARED_LOCAL_PARTS.has(local);
}
