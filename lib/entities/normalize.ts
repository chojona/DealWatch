/**
 * Phase 6A light normalizer.
 * Trim, Unicode NFKC, casefold, collapse whitespace, strip periods and commas.
 * Does not strip legal suffixes or street suffixes, and does not merge entities.
 */

function casefold(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function normalizeSurfaceForm(value: string): string {
  return casefold(value).replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

export function normalizePersonName(value: string): string {
  return normalizeSurfaceForm(value);
}

export function normalizeCompanyName(value: string): string {
  return normalizeSurfaceForm(value);
}

export function normalizeEmail(value: string): string {
  return casefold(value).trim();
}

/** Keeps a leading + and digits. Does not invent a country code. */
export function normalizePhone(value: string): string {
  const trimmed = value.normalize("NFKC").trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** Host only. Strips scheme, path, port, and a leading www. */
export function normalizeDomain(value: string): string {
  let host = casefold(value).trim();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split("/")[0] ?? host;
  host = host.split("?")[0] ?? host;
  host = host.split("#")[0] ?? host;
  host = host.replace(/:\d+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  return host.replace(/\.$/, "");
}

export function normalizePropertyAddress(parts: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string {
  return [
    parts.addressLine1,
    parts.addressLine2,
    parts.city,
    parts.region,
    parts.postalCode,
    parts.country,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => normalizeSurfaceForm(part))
    .join(" ");
}
