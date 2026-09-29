import {
  StructuredActionDirectiveSchema,
  type StructuredActionDirective,
} from "./schema";

/**
 * Deterministic temporal normalization.
 * The only clock and timezone are the ones written in the source text.
 * There is no reference instant, property timezone, user timezone, or server timezone.
 * Relative language stays unresolved because this repository has no authoritative
 * reference-date policy for message deadlines.
 */

export type TemporalRole = "due" | "occurrence" | "unspecified";

export type TemporalNormalization =
  | {
      status: "normalized";
      instant: string;
      sourceText: string;
      role: TemporalRole;
    }
  | {
      status: "unresolved";
      sourceText: string | null;
      role: TemporalRole | null;
    }
  | {
      status: "invalid";
      sourceText: string;
      role: TemporalRole | null;
      reason: "impossible_date" | "invalid_time" | "conflicting_timezone" | "ambiguous";
    };

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const IANA_ABBREVIATIONS: Record<string, string> = {
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
};

const FIXED_OFFSETS: Record<string, number> = {
  EST: -5 * 60,
  EDT: -4 * 60,
  CST: -6 * 60,
  CDT: -5 * 60,
  MST: -7 * 60,
  MDT: -6 * 60,
  PST: -8 * 60,
  PDT: -7 * 60,
  UTC: 0,
  GMT: 0,
};

const MONTH = "january|february|march|april|may|june|july|august|september|october|november|december";
const CUE = "by|due|no later than|deadline(?:\\s+of)?";
const CLOCK = String.raw`\d{1,2}(?::\d{2}){1,2}\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?`;
const ZONE = String.raw`(?:(?:UTC|GMT)[+-]\d{2}:\d{2}|[+-]\d{2}:\d{2}|[A-Za-z]+(?:\/[A-Za-z_]+)+|EST|EDT|CST|CDT|MST|MDT|PST|PDT|ET|CT|MT|PT|UTC|GMT|Z)\b`;
const APPROXIMATE = /\b(?:around|approximately|approx\.?|roughly|sometime|asap|as soon as possible)\b|\blater\s+(?:this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bbefore the end of\b/i;
const RELATIVE = /\b(?:tomorrow(?:\s+(?:morning|afternoon|evening|night))?|today|yesterday|tonight|next week|this week|next month|(?:this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|end of (?:the )?(?:day|week|month)|close of business|cob|eod)\b/gi;
const NUMERIC_DATE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi;
const ISO_TIMESTAMP = new RegExp(String.raw`\b(?<iso>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)(?<offset>Z|[+-]\d{2}:\d{2})?\b`, "gi");
const MONTH_DATE = new RegExp(
  String.raw`\b(?:(?<cue>${CUE})\s+)?(?<month>${MONTH})\s+(?<day>\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(?<year>\d{4})(?:\s*,?\s*(?:at\s+)?(?<clock>${CLOCK}))?(?:\s+\(?(?<zone>${ZONE})\)?(?:\s*(?:\/\s*|\(\s*|\s+)(?<zone2>${ZONE})\)?)?)?`,
  "gi",
);
const TIME_ONLY = new RegExp(String.raw`\b(?:at\s+)?(?<clock>${CLOCK})(?:\s+\(?(?<zone>${ZONE})\)?)?`, "gi");

type ZoneSpec =
  | { kind: "iana"; timeZone: string }
  | { kind: "fixed"; offsetMinutes: number };

interface Found {
  start: number;
  end: number;
  sourceText: string;
  role: TemporalRole;
  outcome:
    | { status: "instant"; instant: string; epoch: number }
    | { status: "incomplete" }
    | { status: "invalid"; reason: "impossible_date" | "invalid_time" | "conflicting_timezone" | "ambiguous" };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function formatInstant(year: number, month: number, day: number, hour: number, minute: number, second: number, offsetMinutes: number): string {
  const clock = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
  if (offsetMinutes === 0) return `${clock}Z`;
  const sign = offsetMinutes > 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${clock}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function parseClock(raw: string): { hour: number; minute: number; second: number } | null {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] == null ? 0 : Number(match[2]);
  const second = match[3] == null ? 0 : Number(match[3]);
  if (minute > 59 || second > 59) return null;
  const ampm = match[4]?.toLowerCase().replaceAll(".", "");
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    const normalized = ampm.startsWith("a") ? (hour === 12 ? 0 : hour) : (hour === 12 ? 12 : hour + 12);
    return { hour: normalized, minute, second };
  }
  if (!match[2] || hour > 23) return null;
  return { hour, minute, second };
}

function parseOffset(token: string): number | null {
  if (/^z$/i.test(token)) return 0;
  const match = token.match(/^(?:UTC|GMT)?([+-])(\d{2}):(\d{2})$/i);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  if (Number(match[2]) > 14 || Number(match[3]) > 59) return null;
  return match[1] === "-" ? -minutes : minutes;
}

function parseZone(token: string): ZoneSpec | null {
  const trimmed = token.trim();
  const upper = trimmed.toUpperCase();
  const offset = parseOffset(trimmed);
  if (offset != null && (/^(?:UTC|GMT)[+-]/i.test(trimmed) || /^[+-]/.test(trimmed) || /^z$/i.test(trimmed))) {
    return { kind: "fixed", offsetMinutes: offset };
  }
  if (IANA_ABBREVIATIONS[upper]) return { kind: "iana", timeZone: IANA_ABBREVIATIONS[upper] };
  if (upper in FIXED_OFFSETS) return { kind: "fixed", offsetMinutes: FIXED_OFFSETS[upper] };
  if (trimmed.includes("/")) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: trimmed });
      return { kind: "iana", timeZone: trimmed };
    } catch {
      return null;
    }
  }
  return null;
}

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

function wallMatches(instant: Date, timeZone: string, year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const wallHour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  return Number(map.year) === year
    && Number(map.month) === month
    && Number(map.day) === day
    && wallHour === hour
    && Number(map.minute) === minute
    && Number(map.second) === second;
}

function resolveZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: ZoneSpec,
): { instant: string; epoch: number } | "gap" | "ambiguous" {
  if (zone.kind === "fixed") {
    const epoch = Date.UTC(year, month - 1, day, hour, minute, second) - zone.offsetMinutes * 60_000;
    return { instant: formatInstant(year, month, day, hour, minute, second, zone.offsetMinutes), epoch };
  }
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = zoneOffsetMinutes(new Date(wallAsUtc), zone.timeZone);
  let epoch = wallAsUtc - offset * 60_000;
  offset = zoneOffsetMinutes(new Date(epoch), zone.timeZone);
  epoch = wallAsUtc - offset * 60_000;
  const epochs = new Set<number>();
  for (const delta of [0, -60, 60, -30, 30]) {
    const candidate = wallAsUtc - (offset + delta) * 60_000;
    if (wallMatches(new Date(candidate), zone.timeZone, year, month, day, hour, minute, second)) epochs.add(candidate);
  }
  if (epochs.size === 0) return "gap";
  if (epochs.size > 1) return "ambiguous";
  const resolved = [...epochs][0]!;
  const resolvedOffset = zoneOffsetMinutes(new Date(resolved), zone.timeZone);
  return {
    instant: formatInstant(year, month, day, hour, minute, second, resolvedOffset),
    epoch: resolved,
  };
}

function roleFor(text: string, cue: string | null): TemporalRole {
  if (cue && /^(?:by|due|no later than|deadline(?:\s+of)?)$/i.test(cue)) return "due";
  if (/\b(?:meet|meeting|call|tour)\b/i.test(text) || /\bscheduled for\b/i.test(text)) return "occurrence";
  if (/\b(?:by|due|no later than|deadline)\b/i.test(text)) return "due";
  return "unspecified";
}

function clean(value: string): string {
  return value.replace(/[.,;:]+$/g, "").trim();
}

function overlaps(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  return left.start < right.end && right.start < left.end;
}

function monthCandidates(text: string): Found[] {
  const found: Found[] = [];
  for (const match of text.matchAll(MONTH_DATE)) {
    const month = MONTHS[match.groups?.month?.toLowerCase() ?? ""];
    const day = Number(match.groups?.day);
    const year = Number(match.groups?.year);
    const cue = match.groups?.cue ?? null;
    const sourceText = clean(match[0] ?? "");
    const start = match.index ?? 0;
    const base = { start, end: start + match[0].length, sourceText, role: roleFor(text, cue) };
    if (!month || !validDate(year, month, day)) {
      found.push({ ...base, outcome: { status: "invalid", reason: "impossible_date" } });
      continue;
    }
    const clockRaw = match.groups?.clock;
    if (!clockRaw) {
      const broken = text.slice(base.end).match(/^\s*,?\s*(?:at\s+)?(\d{1,2}(?::\d{2}){1,2})/);
      if (broken && !parseClock(broken[1] ?? "")) {
        found.push({ ...base, sourceText: clean(`${sourceText} ${broken[0]}`), outcome: { status: "invalid", reason: "invalid_time" } });
        continue;
      }
      found.push({ ...base, outcome: { status: "incomplete" } });
      continue;
    }
    const clock = parseClock(clockRaw);
    if (!clock) {
      found.push({ ...base, outcome: { status: "invalid", reason: "invalid_time" } });
      continue;
    }
    const primary = match.groups?.zone ? parseZone(match.groups.zone) : null;
    if (!match.groups?.zone || !primary) {
      found.push({ ...base, outcome: { status: "incomplete" } });
      continue;
    }
    const resolved = resolveZone(year, month, day, clock.hour, clock.minute, clock.second, primary);
    if (resolved === "gap") {
      found.push({ ...base, outcome: { status: "invalid", reason: "invalid_time" } });
      continue;
    }
    if (resolved === "ambiguous") {
      found.push({ ...base, outcome: { status: "invalid", reason: "ambiguous" } });
      continue;
    }
    const secondaryToken = match.groups?.zone2;
    if (secondaryToken) {
      const secondary = parseZone(secondaryToken);
      const second = secondary
        ? resolveZone(year, month, day, clock.hour, clock.minute, clock.second, secondary)
        : null;
      if (!second || second === "gap" || second === "ambiguous" || second.epoch !== resolved.epoch) {
        found.push({ ...base, outcome: { status: "invalid", reason: "conflicting_timezone" } });
        continue;
      }
    }
    found.push({ ...base, outcome: { status: "instant", instant: resolved.instant, epoch: resolved.epoch } });
  }
  return found;
}

function isoCandidates(text: string): Found[] {
  const found: Found[] = [];
  for (const match of text.matchAll(ISO_TIMESTAMP)) {
    const raw = match.groups?.iso ?? "";
    const offset = match.groups?.offset;
    const start = match.index ?? 0;
    const prefix = text.slice(Math.max(0, start - 32), start).match(/\b(by|due|no later than|deadline(?:\s+of)?|scheduled for)\s*$/i)?.[1] ?? null;
    const sourceStart = prefix ? start - (text.slice(Math.max(0, start - 32), start).match(/\b(by|due|no later than|deadline(?:\s+of)?|scheduled for)\s*$/i)?.[0].length ?? 0) : start;
    const sourceText = clean(text.slice(sourceStart, start + match[0].length));
    const base = { start: sourceStart, end: start + match[0].length, sourceText, role: roleFor(text, prefix) };
    const parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!parts) continue;
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = parts[6] == null ? 0 : Number(parts[6]);
    if (!validDate(year, month, day)) {
      found.push({ ...base, outcome: { status: "invalid", reason: "impossible_date" } });
      continue;
    }
    if (hour > 23 || minute > 59 || second > 59) {
      found.push({ ...base, outcome: { status: "invalid", reason: "invalid_time" } });
      continue;
    }
    if (!offset) {
      found.push({ ...base, outcome: { status: "incomplete" } });
      continue;
    }
    const minutes = parseOffset(offset);
    if (minutes == null) {
      found.push({ ...base, outcome: { status: "incomplete" } });
      continue;
    }
    const instant = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${offset.toUpperCase() === "Z" ? "Z" : offset}`;
    const epoch = Date.UTC(year, month - 1, day, hour, minute, second) - minutes * 60_000;
    found.push({ ...base, outcome: { status: "instant", instant, epoch } });
  }
  return found;
}

function looseCandidates(text: string, occupied: Found[]): Found[] {
  const found: Found[] = [];
  const consider = (match: RegExpMatchArray) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (occupied.some((item) => overlaps(item, { start, end }))) return;
    const prefix = text.slice(Math.max(0, start - 24), start).match(/\b(by|due|no later than)\s*$/i);
    const sourceStart = prefix?.index == null ? start : Math.max(0, start - 24) + prefix.index;
    const sourceText = clean(text.slice(sourceStart, end));
    found.push({
      start: sourceStart,
      end,
      sourceText,
      role: roleFor(text, prefix?.[1] ?? null),
      outcome: { status: "incomplete" },
    });
  };
  for (const match of text.matchAll(NUMERIC_DATE)) consider(match);
  for (const match of text.matchAll(RELATIVE)) consider(match);
  for (const match of text.matchAll(TIME_ONLY)) consider(match);
  return found;
}

function unresolved(sourceText: string | null, role: TemporalRole | null): TemporalNormalization {
  return { status: "unresolved", sourceText, role };
}

/**
 * Normalize one explicit instant, or preserve the source text.
 * Date-only language, weekday names, and zone-less clock times stay unresolved.
 */
export function normalizeTemporalEvidence(text: string): TemporalNormalization {
  const approximate = text.match(APPROXIMATE);
  if (approximate) return unresolved(approximate[0], null);
  const explicit = [...monthCandidates(text), ...isoCandidates(text)];
  const signals = [...explicit, ...looseCandidates(text, explicit)];
  if (signals.length === 0) return unresolved(null, null);
  const instants = signals.filter((item) => item.outcome.status === "instant");
  const invalids = signals.filter((item) => item.outcome.status === "invalid");
  const incomplete = signals.filter((item) => item.outcome.status === "incomplete");
  if (instants.length > 1) {
    const epochs = new Set(instants.map((item) => item.outcome.status === "instant" ? item.outcome.epoch : 0));
    if (epochs.size > 1 || incomplete.length > 0 || invalids.length > 0) {
      return { status: "invalid", sourceText: instants.map((item) => item.sourceText).join(" "), role: instants[0]?.role ?? null, reason: "ambiguous" };
    }
  }
  if (instants.length === 1 && incomplete.length === 0 && invalids.length === 0) {
    const selected = instants[0]!;
    if (selected.outcome.status !== "instant") return unresolved(selected.sourceText, selected.role);
    return { status: "normalized", instant: selected.outcome.instant, sourceText: selected.sourceText, role: selected.role };
  }
  if (instants.length > 0 && (incomplete.length > 0 || invalids.length > 0)) {
    return { status: "invalid", sourceText: signals.map((item) => item.sourceText).join(" "), role: signals[0]?.role ?? null, reason: "ambiguous" };
  }
  if (invalids.length === 1 && instants.length === 0 && incomplete.length === 0) {
    const selected = invalids[0]!;
    if (selected.outcome.status !== "invalid") return unresolved(selected.sourceText, selected.role);
    return { status: "invalid", sourceText: selected.sourceText, role: selected.role, reason: selected.outcome.reason };
  }
  if (invalids.length > 1) {
    return { status: "invalid", sourceText: invalids.map((item) => item.sourceText).join(" "), role: invalids[0]?.role ?? null, reason: "ambiguous" };
  }
  const preserved = incomplete[0] ?? invalids[0] ?? null;
  return unresolved(preserved?.sourceText ?? null, preserved?.role ?? null);
}

function preferText(existing: string | null, source: string | null): string | null {
  if (!source) return existing;
  if (!existing) return source;
  return source.toLowerCase().includes(existing.toLowerCase()) ? source : existing;
}

/**
 * Attach a normalized instant to an already extracted directive.
 * This does not create a directive, a fulfillment link, or a negotiation term.
 */
export function applyTemporalNormalization(action: StructuredActionDirective, text: string): StructuredActionDirective {
  const result = normalizeTemporalEvidence(text);
  if (result.status === "normalized" && result.role === "due") {
    return StructuredActionDirectiveSchema.parse({
      ...action,
      dueAt: result.instant,
      dueText: preferText(action.dueText, result.sourceText),
      occursAt: null,
    });
  }
  if (
    result.status === "normalized"
    && result.role === "occurrence"
    && (action.kind === "MEETING_REQUESTED" || action.kind === "CALL_REQUESTED")
  ) {
    return StructuredActionDirectiveSchema.parse({
      ...action,
      dueAt: null,
      occursAt: result.instant,
    });
  }
  const source = result.status === "unresolved" || result.status === "invalid" ? result.sourceText : null;
  return StructuredActionDirectiveSchema.parse({
    ...action,
    dueAt: null,
    occursAt: null,
    dueText: result.role === "due" ? preferText(action.dueText, source) : action.dueText,
  });
}
