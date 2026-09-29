export class DealBriefQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealBriefQueryError";
  }
}

const OFFSET_AWARE_ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseOffsetAwareInstant(value: string): Date | null {
  const match = OFFSET_AWARE_ISO_DATE_TIME.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "0");
  const offsetHour = Number(offsetHourText ?? "0");
  const offsetMinute = Number(offsetMinuteText ?? "0");
  if (
    month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
    || (zone !== "Z" && (offsetHour > 23 || offsetMinute > 59))
  ) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function parseDealBriefQuery(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
  getAll?(name: string): string[];
}): { since?: Date } {
  if (searchParams.has("workspaceId")) {
    throw new DealBriefQueryError("workspaceId is server-controlled");
  }
  if ((searchParams.getAll?.("since").length ?? 0) > 1) {
    throw new DealBriefQueryError("since must be provided once");
  }
  const raw = searchParams.get("since");
  if (raw === null) return {};
  const value = raw.trim();
  const since = parseOffsetAwareInstant(value);
  if (!since) throw new DealBriefQueryError("since must be a valid offset-aware ISO-8601 date-time");
  return { since };
}

export function parseDealBriefPageQuery(input: {
  since?: string | string[];
}): { query: { since?: Date }; error: null } | { query: null; error: string } {
  const searchParams = new URLSearchParams();
  if (typeof input.since === "string") searchParams.set("since", input.since);
  if (Array.isArray(input.since)) {
    for (const value of input.since) searchParams.append("since", value);
  }
  try {
    return { query: parseDealBriefQuery(searchParams), error: null };
  } catch (error) {
    return {
      query: null,
      error: error instanceof DealBriefQueryError ? error.message : "Invalid catch-up query",
    };
  }
}
