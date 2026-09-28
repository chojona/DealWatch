import type { PersonIdentifierKind } from "@prisma/client";
import { normalizeDomain, normalizeEmail, normalizePhone, normalizeSurfaceForm } from "@/lib/entities/normalize";
import { isSharedInbox } from "@/lib/resolution/sharedInbox";
import type { CanonicalFieldPreview } from "./types";

export const MANUAL_REVIEW_NOTE =
  "Manual review. DealWatch has no authenticated user, so this decision is recorded as a manual review rather than a named account.";

export interface PlannedPersonIdentifier {
  kind: PersonIdentifierKind;
  value: string;
  normalizedValue: string;
}

export interface PlannedExternalIdentifier {
  scheme: string;
  value: string;
}

export interface IdentifierPlan {
  fields: CanonicalFieldPreview[];
  personIdentifiers: PlannedPersonIdentifier[];
  companyDomain: string | null;
  companyWebsite: string | null;
  externalIdentifiers: PlannedExternalIdentifier[];
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(raw: Record<string, unknown> | null, key: string): string | null {
  const value = raw?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function field(label: string, value: string | null, note: string | null = null): CanonicalFieldPreview | null {
  if (!value) return null;
  return { label, value, note };
}

export function isPersonalEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && !isSharedInbox(normalized);
}

export function isExplicitDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return normalized.includes(".") && !normalized.includes(" ");
}

export function planIdentifiers(input: {
  observedType: "PERSON" | "COMPANY" | "PROPERTY";
  surfaceForm: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  domain: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  rawAttributes: unknown;
}): IdentifierPlan {
  const raw = record(input.rawAttributes);
  const fields: CanonicalFieldPreview[] = [{ label: "Name", value: input.surfaceForm, note: null }];
  const personIdentifiers: PlannedPersonIdentifier[] = [];
  let companyDomain: string | null = null;
  let companyWebsite: string | null = null;
  const externalIdentifiers: PlannedExternalIdentifier[] = [];

  if (input.observedType === "PERSON") {
    const title = field("Title", input.title);
    if (title) fields.push(title);
    if (input.email) {
      if (isSharedInbox(input.email)) {
        fields.push({
          label: "Email",
          value: input.email,
          note: "Shared inbox is not stored as a person identifier.",
        });
      } else if (!isPersonalEmail(input.email)) {
        fields.push({
          label: "Email",
          value: input.email,
          note: "Not a valid personal email, so it is not stored as an identifier.",
        });
      } else {
        const value = normalizeEmail(input.email);
        fields.push({ label: "Email", value, note: null });
        personIdentifiers.push({ kind: "EMAIL", value, normalizedValue: value });
      }
    }
    if (input.phone) {
      const normalized = normalizePhone(input.phone);
      if (normalized.replace(/\D/g, "").length >= 7) {
        fields.push({ label: "Phone", value: input.phone, note: null });
        personIdentifiers.push({ kind: "PHONE", value: input.phone, normalizedValue: normalized });
      } else {
        fields.push({
          label: "Phone",
          value: input.phone,
          note: "Not a usable phone number, so it is not stored as an identifier.",
        });
      }
    }
    const linkedIn = text(raw, "observedLinkedIn");
    if (linkedIn) {
      const normalized = normalizeSurfaceForm(linkedIn);
      fields.push({ label: "LinkedIn", value: linkedIn, note: null });
      if (normalized) {
        personIdentifiers.push({ kind: "LINKEDIN", value: linkedIn, normalizedValue: normalized });
      }
    }
  }

  if (input.observedType === "COMPANY") {
    if (input.domain && isExplicitDomain(input.domain)) {
      companyDomain = normalizeDomain(input.domain);
      fields.push({ label: "Domain", value: companyDomain, note: null });
    } else if (input.domain) {
      fields.push({
        label: "Domain",
        value: input.domain,
        note: "Not an explicit domain, so it is not stored as an identifier.",
      });
    }
    const website = text(raw, "observedWebsite");
    if (website) {
      companyWebsite = website;
      fields.push({ label: "Website", value: website, note: "Stored as a website, not inferred as a domain identifier." });
    }
  }

  if (input.observedType === "PROPERTY") {
    for (const entry of [
      field("Address", input.addressLine1),
      field("City", input.city),
      field("Region", input.region),
      field("Postal code", input.postalCode),
      field("Country", input.country),
    ]) {
      if (entry) fields.push(entry);
    }
    const scheme = text(raw, "externalScheme");
    const value = text(raw, "externalId");
    if (scheme && value) {
      externalIdentifiers.push({ scheme, value });
      fields.push({ label: "External identifier", value: `${scheme} ${value}`, note: null });
    } else if (value) {
      fields.push({
        label: "External identifier",
        value,
        note: "No scheme was observed, so this identifier is not promoted.",
      });
    }
  }

  return { fields, personIdentifiers, companyDomain, companyWebsite, externalIdentifiers };
}
