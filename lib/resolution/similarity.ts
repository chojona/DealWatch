import { normalizeSurfaceForm } from "@/lib/entities/normalize";

/**
 * Phase 7B fuzzy ranking.
 * Algorithm: Jaro-Winkler (prefix scale 0.1, max prefix 4).
 * Normalization: existing normalizeSurfaceForm (NFKC, casefold, strip periods
 * and commas, collapse whitespace). Legal and street suffixes are removed
 * only for this comparison. Stored names and the Phase 6B normalizers are
 * unchanged.
 * Threshold: 0.92. Weight: at most 0.12, and only when the names are not an
 * exact normalized match. Similarity never accepts a candidate.
 */
export const NAME_SIMILARITY_ALGORITHM = "jaro-winkler";
export const NAME_SIMILARITY_THRESHOLD = 0.92;

const IGNORABLE_SUFFIXES = new Set([
  "inc",
  "llc",
  "corp",
  "ltd",
  "lp",
  "llp",
  "incorporated",
  "company",
  "co",
  "street",
  "st",
  "avenue",
  "ave",
  "road",
  "rd",
  "boulevard",
  "blvd",
  "drive",
  "dr",
  "lane",
  "ln",
  "way",
  "place",
  "pl",
]);

export function comparisonName(value: string): string {
  const tokens = normalizeSurfaceForm(value).split(" ").filter(Boolean);
  while (tokens.length > 1 && IGNORABLE_SUFFIXES.has(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }
  return tokens.join(" ");
}

export function jaroWinkler(left: string, right: string): number {
  if (left === right) return left.length === 0 ? 0 : 1;
  if (!left || !right) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatches = new Array<boolean>(left.length).fill(false);
  const rightMatches = new Array<boolean>(right.length).fill(false);
  let matches = 0;
  for (let i = 0; i < left.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, right.length);
    for (let j = start; j < end; j += 1) {
      if (rightMatches[j] || left[i] !== right[j]) continue;
      leftMatches[i] = true;
      rightMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (!leftMatches[i]) continue;
    while (!rightMatches[k]) k += 1;
    if (left[i] !== right[k]) transpositions += 1;
    k += 1;
  }
  const jaro =
    (matches / left.length +
      matches / right.length +
      (matches - transpositions / 2) / matches) /
    3;
  let prefix = 0;
  const prefixLimit = Math.min(4, left.length, right.length);
  for (let i = 0; i < prefixLimit; i += 1) {
    if (left[i] !== right[i]) break;
    prefix += 1;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function nameSimilarity(left: string, right: string): number {
  return jaroWinkler(comparisonName(left), comparisonName(right));
}

/** True when one name is the other plus a meaningful extra token such as Group or Boston. */
export function hasSubstantiveExtraTokens(left: string, right: string): boolean {
  const a = normalizeSurfaceForm(left).split(" ").filter(Boolean);
  const b = normalizeSurfaceForm(right).split(" ").filter(Boolean);
  if (a.join(" ") === b.join(" ")) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const prefix = longer.slice(0, shorter.length).every((token, index) => token === shorter[index]);
  if (!prefix) return false;
  return longer.slice(shorter.length).some((token) => token.length > 1 && !IGNORABLE_SUFFIXES.has(token));
}

export function sameNameIgnoringInitials(left: string, right: string): boolean {
  const strip = (value: string) =>
    normalizeSurfaceForm(value)
      .split(" ")
      .filter((token) => token.length > 1)
      .join(" ");
  const a = strip(left);
  const b = strip(right);
  return a.length > 0 && a === b && normalizeSurfaceForm(left) !== normalizeSurfaceForm(right);
}

export function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i]![0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost
      );
    }
  }
  return matrix[left.length]![right.length]!;
}

export function namesAreCompatible(observed: string, candidate: string): boolean {
  const left = normalizeSurfaceForm(observed);
  const right = normalizeSurfaceForm(candidate);
  if (!left || !right) return false;
  if (left === right) return true;
  if (sameNameIgnoringInitials(left, right)) return true;
  if (hasSubstantiveExtraTokens(left, right)) return false;
  if (nameSimilarity(left, right) >= NAME_SIMILARITY_THRESHOLD && Math.min(comparisonName(left).length, comparisonName(right).length) >= 8) {
    return true;
  }
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;
  const leftFirst = leftTokens[0] ?? "";
  const rightFirst = rightTokens[0] ?? "";
  const leftLast = leftTokens[leftTokens.length - 1] ?? "";
  const rightLast = rightTokens[rightTokens.length - 1] ?? "";
  return (
    leftLast === rightLast &&
    leftLast.length >= 3 &&
    leftFirst.length >= 4 &&
    rightFirst.length >= 4 &&
    levenshtein(leftFirst, rightFirst) <= 1
  );
}
