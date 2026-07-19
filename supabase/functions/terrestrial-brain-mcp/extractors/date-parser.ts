/**
 * Date extraction from checkbox text.
 *
 * Parses common date patterns (ISO, natural, relative) and strips matched
 * fragments from content. Relative dates ("today"/"tomorrow"/weekday names)
 * and omitted-year inference resolve against the current calendar date in a
 * configured user timezone (injected via the pipeline deps), not the server's
 * UTC clock. Resolved dates are stored as midnight-UTC of the calendar date.
 */

import { DUE_MARKER_PATTERN } from "./markers.ts";

// ---------------------------------------------------------------------------
// Month / day lookup tables
// ---------------------------------------------------------------------------

const MONTH_FULL: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MONTH_SHORT: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateExtractionResult {
  cleanedText: string;
  dueDate: string | null;
}

/** The current calendar date, as seen in a particular timezone. */
export interface ZonedDate {
  year: number;
  /** 0-based month, matching `Date.prototype.getMonth`. */
  month: number;
  day: number;
  /** 0 = Sunday, matching `Date.prototype.getDay`. */
  weekday: number;
}

// ---------------------------------------------------------------------------
// Timezone-aware "today"
// ---------------------------------------------------------------------------

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Returns the wall-clock calendar date of `referenceDate` as seen in `timeZone`
 * (an IANA zone name). Relative-date resolution uses this so "today"/"tomorrow"
 * resolve to the user's calendar day rather than the server's UTC day.
 *
 * An invalid/unknown timezone throws inside `Intl.DateTimeFormat`; we catch it,
 * warn once, and fall back to the UTC calendar date so extraction never fails.
 */
export function getZonedDate(referenceDate: Date, timeZone: string): ZonedDate {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
    }).formatToParts(referenceDate);
    const partValue = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? "";
    return {
      year: parseInt(partValue("year"), 10),
      month: parseInt(partValue("month"), 10) - 1,
      day: parseInt(partValue("day"), 10),
      weekday: WEEKDAY_INDEX[partValue("weekday")] ?? referenceDate.getUTCDay(),
    };
  } catch (error) {
    console.warn(
      `Invalid timezone "${timeZone}"; falling back to UTC for date resolution. ${
        (error as Error).message
      }`,
    );
    return {
      year: referenceDate.getUTCFullYear(),
      month: referenceDate.getUTCMonth(),
      day: referenceDate.getUTCDate(),
      weekday: referenceDate.getUTCDay(),
    };
  }
}

/** Adds `days` to a zoned calendar date, returning midnight-UTC ISO of the result. */
function addDaysToZoned(today: ZonedDate, days: number): string | null {
  const anchor = new Date(Date.UTC(today.year, today.month, today.day));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return buildISODate(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthNameToNumber(name: string): number | null {
  const lower = name.toLowerCase();
  return MONTH_FULL[lower] ?? MONTH_SHORT[lower] ?? null;
}

function buildISODate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day));
  if (isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString();
}

function inferYear(month: number, day: number, today: ZonedDate): number {
  if (month < today.month || (month === today.month && day < today.day)) {
    return today.year + 1;
  }
  return today.year;
}

function resolveNextDayOfWeek(
  dayName: string,
  today: ZonedDate,
): string | null {
  const targetDay = DAY_INDEX[dayName.toLowerCase()];
  if (targetDay === undefined) return null;

  let daysAhead = targetDay - today.weekday;
  if (daysAhead <= 0) daysAhead += 7;

  return addDaysToZoned(today, daysAhead);
}

const ORDINAL_SUFFIX = /(?:st|nd|rd|th)/i;

function stripOrdinal(dayStr: string): number {
  return parseInt(dayStr.replace(ORDINAL_SUFFIX, ""), 10);
}

function parseNaturalDate(fragment: string, today: ZonedDate): string | null {
  // "Month Day(, Year)" — e.g. "March 30", "March 30th", "March 30, 2026"
  const monthFirst = fragment.match(
    /([A-Za-z]+)\s+(\d{1,2}(?:st|nd|rd|th)?)(?:,?\s+(\d{4}))?/i,
  );
  if (monthFirst) {
    const month = monthNameToNumber(monthFirst[1]);
    if (month !== null) {
      const day = stripOrdinal(monthFirst[2]);
      const year = monthFirst[3]
        ? parseInt(monthFirst[3], 10)
        : inferYear(month, day, today);
      return buildISODate(year, month, day);
    }
  }

  // "Day Month(, Year)" — e.g. "30 March", "30th March 2026"
  const dayFirst = fragment.match(
    /(\d{1,2}(?:st|nd|rd|th)?)\s+([A-Za-z]+)(?:,?\s+(\d{4}))?/i,
  );
  if (dayFirst) {
    const month = monthNameToNumber(dayFirst[2]);
    if (month !== null) {
      const day = stripOrdinal(dayFirst[1]);
      const year = dayFirst[3]
        ? parseInt(dayFirst[3], 10)
        : inferYear(month, day, today);
      return buildISODate(year, month, day);
    }
  }

  return null;
}

/**
 * Cleans up text after stripping date/assignment fragments.
 * Removes empty parens, dangling commas, and collapses whitespace.
 */
export function cleanStrippedText(text: string): string {
  return text
    .replace(/\(\s*\)/g, "")
    .replace(/,\s*$/, "")
    .replace(/^\s*,/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Build regex patterns (dynamic from month/day names)
// ---------------------------------------------------------------------------

const allMonthNames = [...Object.keys(MONTH_FULL), ...Object.keys(MONTH_SHORT)];
const allDayNames = Object.keys(DAY_INDEX);
/**
 * Non-capturing alternation of every recognized month name (full + abbreviated).
 * Exported so reconciliation marker-stripping can match a real month name
 * rather than any `\w+` word (EXTR-1).
 */
export const monthPattern = allMonthNames.join("|");
const dayNamePattern = allDayNames.join("|");
const markerPattern = DUE_MARKER_PATTERN;
// A due-date marker must be a standalone word: an ASCII word boundary before the
// marker stops "by" inside "Derby"/"standby"/"Rugby" from matching (EXTR-1).
const markerBoundary = "\\b";
// The marker must be separated from its value by a real separator — a colon
// (optionally spaced) or at least one whitespace — so "by2026-08-01" jammed
// inside a token cannot match as a marker date (EXTR-1).
const markerSeparator = "(?:\\s*:\\s*|\\s+)";
// Ordinal day: "5th", "1st", "2nd", "23rd"
const dayNumber = "\\d{1,2}(?:st|nd|rd|th)?";

interface DatePattern {
  regex: RegExp;
  parse: (match: RegExpMatchArray, today: ZonedDate) => string | null;
}

const DATE_PATTERNS: DatePattern[] = [
  // 1. Marker + ISO date: "(deadline: 2026-04-01)" or "by 2026-04-01"
  {
    regex: new RegExp(
      `\\(?\\s*${markerBoundary}${markerPattern}${markerSeparator}(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})\\s*\\)?`,
      "i",
    ),
    parse: (match) => {
      const normalized = match[1].replace(/\//g, "-");
      const parts = normalized.split("-").map(Number);
      return buildISODate(parts[0], parts[1] - 1, parts[2]);
    },
  },
  // 2. Bare ISO date: "2026-04-01".
  //    The look-arounds require the date to be a standalone token — not flanked
  //    by word chars, "/", ":", ".", or "-". This prevents matching dates
  //    embedded in URLs (".../2026-04-01/..."), timestamps ("2026-04-01T..."),
  //    or version strings ("v1.2026-04-01") and stripping them from task text.
  {
    regex: /(?<![\w/:.\-])(\d{4}[-/]\d{1,2}[-/]\d{1,2})(?![\w/:.\-])/,
    parse: (match) => {
      const normalized = match[1].replace(/\//g, "-");
      const parts = normalized.split("-").map(Number);
      return buildISODate(parts[0], parts[1] - 1, parts[2]);
    },
  },
  // 3. Marker + "Month Day(, Year)": "(deadline: August 5th)" or "due March 30"
  {
    regex: new RegExp(
      `\\(?\\s*${markerBoundary}${markerPattern}${markerSeparator}((?:${monthPattern})\\s+${dayNumber}(?:,?\\s+\\d{4})?)\\s*\\)?`,
      "i",
    ),
    parse: (match, today) => parseNaturalDate(match[1], today),
  },
  // 4. Marker + "Day Month(, Year)": "(deadline: 5th August)" or "due 30 March"
  {
    regex: new RegExp(
      `\\(?\\s*${markerBoundary}${markerPattern}${markerSeparator}(${dayNumber}\\s+(?:${monthPattern})(?:,?\\s+\\d{4})?)\\s*\\)?`,
      "i",
    ),
    parse: (match, today) => parseNaturalDate(match[1], today),
  },
  // 5. Marker + "tomorrow": "(by tomorrow)" or "by tomorrow"
  {
    regex: new RegExp(
      `\\(?\\s*${markerBoundary}${markerPattern}${markerSeparator}(tomorrow)\\s*\\)?`,
      "i",
    ),
    parse: (_match, today) => addDaysToZoned(today, 1),
  },
  // 6. Marker + day name: "(by Friday)", "due next Monday".
  //    "next <weekday>" resolves identically to a bare "<weekday>": the nearest
  //    upcoming occurrence. English "next Monday" is ambiguous, so the optional
  //    "next" is accepted but not given distinct "+1 week" semantics.
  {
    regex: new RegExp(
      `\\(?\\s*${markerBoundary}${markerPattern}${markerSeparator}(?:next\\s+)?(${dayNamePattern})\\s*\\)?`,
      "i",
    ),
    parse: (match, today) => resolveNextDayOfWeek(match[1], today),
  },
];

// ---------------------------------------------------------------------------
// Main export: regex-based date extraction
// ---------------------------------------------------------------------------

export function extractDueDate(
  text: string,
  referenceDate: Date = new Date(),
  timeZone: string = "UTC",
): DateExtractionResult {
  const today = getZonedDate(referenceDate, timeZone);
  for (const { regex, parse } of DATE_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      const dueDate = parse(match, today);
      if (dueDate) {
        const cleanedText = cleanStrippedText(text.replace(match[0], ""));
        return { cleanedText, dueDate };
      }
    }
  }
  return { cleanedText: text, dueDate: null };
}
