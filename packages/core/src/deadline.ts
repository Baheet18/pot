/**
 * Deadline parsing for "will X happen by/before <when>" questions, in WAT (UTC+1, no DST).
 * Handles: before 2027, by 2026 / in 2026 / by end of 2026, by end of year/month, this year/month,
 * this/next week(end), tonight, today, tomorrow, in October, by Oct 20, before Oct 20, on 9 October,
 * within 3 days / in the next 2 weeks. Returns null when the text has no deadline at all.
 */
const WAT = 3600; // seconds east of UTC
const DAY = 86400;
export const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIdx = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3)));

export interface Deadline {
  /** Unix seconds of the deadline (inclusive): the last moment that still counts. */
  unix: number;
  /** Canonical phrase for the question, e.g. "before January 1, 2027" or "by October 31, 2026". */
  phrase: string;
  /** Exact deadline text for rules, e.g. "23:59 WAT on Thu, 31 Dec 2026". */
  exact: string;
  /** The matched span in the source text (to strip it from the question). */
  index: number;
  length: number;
  /** True if the user gave a clock time (otherwise end of day 23:59 WAT is used). */
  hadTime: boolean;
}

/** WAT calendar parts of a unix time. */
export function watParts(unix: number) {
  const d = new Date((unix + WAT) * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
/** Unix seconds for a WAT wall-clock time (month 0-based; day overflow is normalised). */
export function watTime(y: number, m: number, d: number, hh = 23, mm = 59) {
  return Math.floor(Date.UTC(y, m, d, hh, mm) / 1000) - WAT;
}
const endOfDay = (unix: number) => { const p = watParts(unix); return watTime(p.y, p.m, p.d); };
export const longDate = (unix: number) => { const p = watParts(unix); return `${cap(MONTHS[p.m])} ${p.d}, ${p.y}`; };
export function exactWat(unix: number) {
  const s = new Date(unix * 1000).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const p = watParts(unix);
  return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")} WAT on ${s}`;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function byPhrase(unix: number, hadTime: boolean) {
  const p = watParts(unix);
  return hadTime ? `by ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")} WAT on ${longDate(unix)}` : `by ${longDate(unix)}`;
}

type Rule = { re: RegExp; at: (m: RegExpExecArray, now: number) => { unix: number; phrase?: string; hadTime?: boolean } | null };

const RULES: Rule[] = [
  // before 2027  → last moment of 2026; question keeps "before January 1, 2027"
  { re: /\b(?:before|by the start of|by the beginning of|ahead of)\s+(20\d\d)\b/i, at: (m) => { const y = +m[1]; return { unix: watTime(y - 1, 11, 31), phrase: `before January 1, ${y}` }; } },
  // by / in / by end of / before the end of 2026
  { re: /\b(?:by|in|during|within|before|by the end of|by end of|before the end of|until the end of|at the end of|end of)\s+(?:the\s+)?(?:year\s+)?(20\d\d)\b/i, at: (m) => ({ unix: watTime(+m[1], 11, 31) }) },
  // by end of (the) year / this year / by year-end
  { re: /\b(?:(?:by|before|until)\s+(?:the\s+)?end\s+of\s+(?:the|this)\s+year|by\s+(?:the\s+)?end\s+of\s+year|(?:by\s+)?year[- ]end|this\s+year|in\s+20\d\d)\b/i, at: (_m, now) => ({ unix: watTime(watParts(now).y, 11, 31) }) },
  // by end of (the/this) month / this month
  { re: /\b(?:(?:by|before|until)\s+(?:the\s+)?end\s+of\s+(?:the|this)\s+month|by\s+(?:the\s+)?end\s+of\s+month|this\s+month|(?:by\s+)?month[- ]end)\b/i, at: (_m, now) => { const p = watParts(now); return { unix: watTime(p.y, p.m + 1, 0) }; } },
  // next month
  { re: /\b(?:by\s+the\s+end\s+of\s+|by\s+end\s+of\s+|in\s+|during\s+)?next\s+month\b/i, at: (_m, now) => { const p = watParts(now); return { unix: watTime(p.y, p.m + 2, 0) }; } },
  // this weekend / next weekend (ends Sunday 23:59)
  { re: /\b(?:by\s+the\s+end\s+of\s+|by\s+|over\s+|during\s+)?(this|next)\s+weekend\b/i, at: (m, now) => { const p = watParts(now); const toSun = (7 - p.dow) % 7; return { unix: watTime(p.y, p.m, p.d + toSun + (m[1].toLowerCase() === "next" ? 7 : 0)) }; } },
  // this week / next week (ends Sunday 23:59)
  { re: /\b(?:by\s+the\s+end\s+of\s+|by\s+end\s+of\s+|by\s+|during\s+)?(this|next)\s+week\b/i, at: (m, now) => { const p = watParts(now); const toSun = (7 - p.dow) % 7; return { unix: watTime(p.y, p.m, p.d + toSun + (m[1].toLowerCase() === "next" ? 7 : 0)) }; } },
  // tonight / today / by end of day
  { re: /\b(?:by\s+)?(?:tonight|today|end\s+of\s+(?:the\s+)?day|eod)\b/i, at: (_m, now) => ({ unix: endOfDay(now) }) },
  // within N days/weeks/months, in the next N days, in N days
  { re: /\b(?:within|in\s+the\s+next|in\s+the\s+coming|in)\s+(\d{1,3}|a|one|two|three|four|six)\s+(day|week|month)s?\b/i, at: (m, now) => {
      const n = ({ a: 1, one: 1, two: 2, three: 3, four: 4, six: 6 } as Record<string, number>)[m[1].toLowerCase()] ?? +m[1];
      const p = watParts(now);
      const u = m[2].toLowerCase();
      return { unix: u === "month" ? watTime(p.y, p.m + n, p.d) : watTime(p.y, p.m, p.d + n * (u === "week" ? 7 : 1)) };
    } },
  // before Oct 20 / before 20 October [2026] → end of Oct 19
  { re: new RegExp(`\\bbefore\\s+(?:${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?)(?:,?\\s+(20\\d\\d))?\\b`, "i"), at: (m, now) => {
      const mon = monthIdx(m[1] ?? m[4]); const day = +(m[2] ?? m[3]);
      const y = m[5] ? +m[5] : pickYear(mon, day, now);
      const unix = watTime(y, mon, day - 1);
      return { unix, phrase: `before ${cap(MONTHS[mon])} ${day}, ${y}` };
    } },
  // before October / before the end of October → handled: "before October" = before Oct 1
  { re: new RegExp(`\\bbefore\\s+${MONTH_RE}\\b(?!\\.?\\s*\\d)(?:\\s+(20\\d\\d))?`, "i"), at: (m, now) => {
      const mon = monthIdx(m[1]); const y = m[2] ? +m[2] : pickYear(mon, 1, now);
      return { unix: watTime(y, mon, 0), phrase: `before ${cap(MONTHS[mon])} 1, ${y}` };
    } },
  // by/on/in Oct 20, 20 October [2026], Dec 31
  { re: new RegExp(`\\b(?:by|on|before\\s+the\\s+end\\s+of|by\\s+the\\s+end\\s+of|until)?\\s*(?:${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?)(?:,?\\s+(20\\d\\d))?\\b`, "i"), at: (m, now) => {
      const mon = monthIdx(m[1] ?? m[4]); const day = +(m[2] ?? m[3]);
      if (!(day >= 1 && day <= 31)) return null;
      const y = m[5] ? +m[5] : pickYear(mon, day, now);
      return { unix: watTime(y, mon, day) };
    } },
  // in / by / by end of / during October [2026] → Oct 31 23:59
  { re: new RegExp(`\\b(?:in|by|during|by\\s+the\\s+end\\s+of|by\\s+end\\s+of|before\\s+the\\s+end\\s+of|until\\s+the\\s+end\\s+of|end\\s+of)\\s+${MONTH_RE}\\b(?:\\s+(20\\d\\d))?`, "i"), at: (m, now) => {
      const mon = monthIdx(m[1]); const y = m[2] ? +m[2] : pickYear(mon, 31, now, true);
      return { unix: watTime(y, mon + 1, 0) };
    } },
];

/** The next occurrence of a month/day (this year if not passed yet). */
function pickYear(mon: number, day: number, now: number, wholeMonth = false) {
  const p = watParts(now);
  if (mon > p.m || (mon === p.m && (wholeMonth || day >= p.d))) return p.y;
  return p.y + 1;
}

export function findDeadline(text: string, now: number): Deadline | null {
  let best: { m: RegExpExecArray; r: ReturnType<Rule["at"]> } | null = null;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const r = rule.at(m, now);
    if (r) { best = { m, r }; break; } // rules are ordered most specific first
  }
  if (!best || !best.r) return null;
  const { m, r } = best;
  const lead = m[0].length - m[0].trimStart().length;
  // Optional clock time right after the date ("Dec 31 6pm", "tonight at 9pm").
  let unix = r.unix, hadTime = false, length = m[0].length - lead;
  const tail = text.slice(m.index + m[0].length);
  const t = /^\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(tail) ?? /^\s*(?:at\s+)?(\d{2}):(\d{2})\b()/.exec(tail);
  if (t && !r.phrase?.startsWith("before")) {
    let hh = +t[1] % 12; if (t[3]?.toLowerCase() === "pm") hh += 12; if (!t[3]) hh = +t[1];
    const p = watParts(unix);
    if (hh < 24) { unix = watTime(p.y, p.m, p.d, hh, +(t[2] ?? 0)); hadTime = true; length += t[0].length; }
  }
  return { unix, phrase: r.phrase ?? byPhrase(unix, hadTime), exact: exactWat(unix), index: m.index + lead, length, hadTime };
}
