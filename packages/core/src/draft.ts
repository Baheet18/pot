import * as chrono from "chrono-node";

/**
 * Market drafter: turns a plain sentence from a group chat into a Panta-ready market
 * (question, resolution rule, sources, times, breaking vs standard).
 * Deterministic templates (no LLM) so the wording is predictable and testable.
 * All times are interpreted in WAT (Africa/Lagos, UTC+1) unless the text says otherwise.
 */

export const WAT_OFFSET_MIN = 60;
export const PANTA_CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"] as const;
export type PantaCategory = (typeof PANTA_CATEGORIES)[number];
export type DraftKind = "match" | "scorer" | "price" | "reality" | "generic";

export interface MarketDraft {
  kind: DraftKind;
  question: string;
  title: string;
  description: string;
  resolutionRule: string;
  sourcesOfTruth: string[];
  category: PantaCategory;
  marketType: "breaking" | "standard";
  eventInProgress: boolean;
  /** Unix seconds. Buy-only (primary) phase runs until startTime. */
  startTime: number;
  endTime: number;
  resolutionTime: number;
  region: string;
  creationFeeUsdc: number;
  /** Things the admin should check before paying. */
  warnings: string[];
}

export interface DraftOptions {
  /** Unix seconds; defaults to now. */
  now?: number;
  /** Optional explicit "when" text (after a `|` in the command). */
  when?: string;
  region?: string;
}

export const LIMITS = {
  question: 512,
  rule: 2048,
  maxSources: 20,
  /** Panta: start must be >= ~1h ahead unless a breaking market's event is in progress. */
  minStartDelaySec: 3600,
  /** Breaking markets: event starts within 72h. Standard: at least 72h ahead. */
  breakingWindowSec: 72 * 3600,
  fees: { breaking: 20, standard: 50 },
};

const H = 3600;

const COMPETITION_SOURCES: Array<[RegExp, string]> = [
  [/super eagles|nigeria|\bnff\b/i, "https://thenff.com"],
  [/premier league|\bepl\b|arsenal|chelsea|liverpool|man(chester)? (united|city|utd)|spurs|tottenham|newcastle|aston villa/i, "https://www.premierleague.com"],
  [/champions league|\bucl\b|europa league|uefa|nations league/i, "https://www.uefa.com"],
  [/afcon|\bcaf\b|african cup|africa cup/i, "https://www.cafonline.com"],
  [/world cup|fifa/i, "https://www.fifa.com"],
  [/\bnpfl\b|enyimba|rangers international|kano pillars|remo stars/i, "https://npfl.ng"],
  [/la liga|real madrid|barcelona|atletico/i, "https://www.laliga.com"],
  [/serie a|juventus|inter milan|ac milan|napoli/i, "https://www.legaseriea.it"],
];
const FOOTBALL_FALLBACK = ["https://www.espn.com/soccer/", "https://www.bbc.com/sport/football"];

const COINS: Record<string, { name: string; ticker: string }> = {
  btc: { name: "Bitcoin", ticker: "BTC" }, bitcoin: { name: "Bitcoin", ticker: "BTC" },
  eth: { name: "Ethereum", ticker: "ETH" }, ethereum: { name: "Ethereum", ticker: "ETH" },
  sol: { name: "Solana", ticker: "SOL" }, solana: { name: "Solana", ticker: "SOL" },
  bnb: { name: "BNB", ticker: "BNB" }, xrp: { name: "XRP", ticker: "XRP" },
  doge: { name: "Dogecoin", ticker: "DOGE" }, dogecoin: { name: "Dogecoin", ticker: "DOGE" },
};

export function fmtWat(unix: number): string {
  const s = new Date(unix * 1000).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return `${s} WAT`;
}
function fmtWatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.?!-]+$/g, "").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function parsePrice(raw: string): number | null {
  const m = raw.replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return null;
  const mult = m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1;
  return Number(m[1]) * mult;
}

interface WhenResult { unix: number | null; hadTime: boolean; index: number; text: string }

/** Numbers that are names, not dates ("Season 11", "GW7"); masked before date parsing. */
const NOT_A_DATE = /\b(season|week|gw|gameweek|round|matchday|day|episode|ep|part|vol|top|flight)\s*\d+\b/gi;
const mask = (s: string) => s.replace(NOT_A_DATE, (m) => m.replace(/\d/g, "#"));

function findWhen(text: string, now: number, explicit?: string, defaultHour = 20, defaultMinute = 0): WhenResult {
  const ref = { instant: new Date(now * 1000), timezone: WAT_OFFSET_MIN };
  const src = mask(explicit ?? text);
  const results = chrono.parse(src, ref, { forwardDate: true });
  if (!results.length) return { unix: null, hadTime: false, index: -1, text: "" };
  const r = results[0];
  const hadTime = r.start.isCertain("hour");
  const d = r.start.date();
  let unix = Math.floor(d.getTime() / 1000);
  if (!hadTime) {
    // Date only: assume a default time (20:00 kick-off for sports, end of day otherwise) and warn.
    const day = new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }); // YYYY-MM-DD
    const hh = String(defaultHour).padStart(2, "0"), mm = String(defaultMinute).padStart(2, "0");
    unix = Math.floor(Date.parse(`${day}T${hh}:${mm}:00+01:00`) / 1000);
  }
  return { unix, hadTime, index: explicit ? -1 : r.index, text: r.text };
}

function stripWhen(text: string, w: WhenResult): string {
  if (w.index < 0) return text;
  let s = (text.slice(0, w.index) + text.slice(w.index + w.text.length)).trim();
  s = s.replace(/\b(on|at|this|by|before|in)\s*$/i, "").trim();
  return s;
}

function detectCategory(t: string): PantaCategory {
  if (/bbnaija|big brother|housemate|evict|grammy|oscars|album|movie|box office|headies|afrobeats|tour/i.test(t)) return "entertainment";
  if (/\b(btc|bitcoin|eth|ethereum|sol|solana|bnb|xrp|doge|memecoin|token|airdrop|crypto)\b/i.test(t)) return "crypto";
  if (/\b(beat|defeat|score|goal|match|league|cup|vs\.?|fc|united|city|eagles|win against|draw)\b/i.test(t)) return "sports";
  if (/election|president|senate|governor|inec|tinubu|obi|atiku|vote|minister|parliament/i.test(t)) return "politics";
  if (/naira|cbn|inflation|interest rate|fed\b|gdp|stock|shares|nasdaq|s&p|dangote|ngx/i.test(t)) return "finance";
  if (/launch|rocket|spacex|nasa|starship/i.test(t)) return "science";
  return "other";
}

function regionFor(t: string, fallback?: string): string {
  if (fallback) return fallback;
  if (/nigeria|super eagles|naija|lagos|abuja|naira|npfl|inec|tinubu/i.test(t)) return "Nigeria";
  if (/kenya|nairobi/i.test(t)) return "Kenya";
  return "Global";
}

function footballSources(t: string): string[] {
  const out: string[] = [];
  for (const [re, url] of COMPETITION_SOURCES) if (re.test(t) && !out.includes(url)) out.push(url);
  return [...out, ...FOOTBALL_FALLBACK].slice(0, 4);
}

/** Pick start/end/resolution and breaking vs standard from the event time. */
function timing(kind: DraftKind, eventUnix: number, now: number) {
  let start = eventUnix;
  let end: number;
  if (kind === "match" || kind === "scorer") end = eventUnix + 2.5 * H;
  else if (kind === "price") {
    start = eventUnix - H;
    end = eventUnix;
  } else if (kind === "reality") end = eventUnix + 3 * H;
  else {
    // "by <deadline>" events: buying closes 1h before the deadline.
    start = eventUnix - H;
    end = eventUnix;
  }
  const resolution = end + H;
  let eventInProgress = false;
  const untilStart = start - now;
  const marketType: "breaking" | "standard" = untilStart <= LIMITS.breakingWindowSec ? "breaking" : "standard";
  if (marketType === "breaking" && untilStart < LIMITS.minStartDelaySec) {
    if (end > now + 15 * 60) eventInProgress = true;
  }
  return { start, end, resolution, marketType, eventInProgress };
}

export function draftMarket(input: string, opts: DraftOptions = {}): MarketDraft {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const warnings: string[] = [];
  let text = clean(input.replace(/^\/new(@\w+)?\s*/i, ""));
  let explicitWhen = opts.when;
  if (!explicitWhen && text.includes("|")) {
    const [a, ...rest] = text.split("|");
    text = clean(a);
    explicitWhen = clean(rest.join(" "));
  }
  if (!text) throw new Error("Tell me the question, e.g. /new Will Nigeria beat Benin on Friday 5pm?");

  const category = detectCategory(text);
  const sportsLike = category === "sports" || /bbnaija|big brother|housemate|evict/i.test(text);
  const when = sportsLike ? findWhen(text, now, explicitWhen, 20, 0) : findWhen(text, now, explicitWhen, 23, 59);
  const body = clean(stripWhen(text, when)).replace(/^will\s+/i, "");
  const region = regionFor(text, opts.region);

  let kind: DraftKind = "generic";
  let question = "";
  let rule = "";
  let sources: string[] = [];
  let title = "";

  const eventUnix = when.unix ?? now + 24 * H;
  if (when.unix === null) warnings.push("No date or time found, so I assumed 24 hours from now. Add one with `| Sat 5pm`.");
  else if (!when.hadTime) warnings.push(`No time found, so I assumed ${sportsLike ? "20:00" : "23:59"} WAT. Add one with \`| Sat 5pm\` if that is wrong.`);

  const dateTxt = fmtWatDate(eventUnix);
  const timeTxt = fmtWat(eventUnix);

  const match = body.match(/^(.+?)\s+(?:beat|defeat|win against|win vs\.?|win over|overcome)\s+(.+)$/i);
  const scorer = body.match(/^(.+?)\s+score(?:s)?(?:\s+(?:a|at least one)\s+goal)?\s+(?:against|vs\.?|v\.?|in the match against)\s+(.+)$/i);
  const price = body.match(/^(?:the\s+)?(?:price of\s+)?([a-z$]+)\s+(?:price\s+)?(?:be\s+|close\s+|trade\s+)?(at or above|above|over|hit|reach|below|under)\s+(\$?[\d,.]+\s*[km]?)/i);
  const reality = /bbnaija|big brother|housemate|evict/i.test(body);

  if (scorer && category === "sports") {
    kind = "scorer";
    const [p, opp] = [clean(scorer[1]), clean(scorer[2])];
    question = `Will ${p} score against ${opp} on ${dateTxt}?`;
    title = `${p} to score vs ${opp}?`;
    rule =
      `Resolves YES if ${p} scores at least one goal for his team in the match against ${opp} that kicks off at ${timeTxt}, ` +
      `counting regular time plus stoppage time only. Extra time and penalty shootouts do not count, and own goals do not count. ` +
      `Resolves NO if ${p} does not score, does not play, or the match is abandoned, postponed or not completed by the market end time. ` +
      `The official match report on the listed sources decides; if they disagree, the first listed source wins.`;
    sources = footballSources(text);
  } else if (match && category === "sports") {
    kind = "match";
    const [a, b] = [clean(match[1]), clean(match[2])];
    question = `Will ${a} beat ${b} on ${dateTxt}?`;
    title = `${a} to beat ${b}?`;
    rule =
      `Resolves YES if ${a} win the match against ${b} that kicks off at ${timeTxt}, based on the score at the end of regular time plus stoppage time. ` +
      `Extra time and penalty shootouts do not count. Resolves NO if ${a} draw or lose, or if the match is abandoned, postponed or not completed by the market end time. ` +
      `The official result on the listed sources decides; if they disagree, the first listed source wins.`;
    sources = footballSources(text);
  } else if (price && (category === "crypto" || COINS[price[1].toLowerCase().replace("$", "")])) {
    kind = "price";
    const key = price[1].toLowerCase().replace("$", "");
    const coin = COINS[key] ?? { name: price[1].toUpperCase(), ticker: price[1].toUpperCase() };
    const level = parsePrice(price[3]);
    const dir = /below|under/i.test(price[2]) ? "below" : "at or above";
    const lvl = level !== null ? `$${level.toLocaleString("en-US")}` : price[3];
    question = `Will ${coin.name} (${coin.ticker}) be ${dir} ${lvl} at ${timeTxt}?`;
    title = `${coin.ticker} ${dir === "below" ? "<" : "≥"} ${lvl}?`;
    rule =
      `Resolves YES if the ${coin.ticker}/USD price shown by CoinGecko is ${dir} ${lvl} at ${timeTxt} ` +
      `(the price at that minute; if CoinGecko is unavailable, CoinMarketCap's price at the same minute is used). Otherwise resolves NO.`;
    sources = ["https://www.coingecko.com", "https://coinmarketcap.com"];
  } else if (reality) {
    kind = "reality";
    question = `Will ${body.replace(/\?$/, "")} (by ${dateTxt})?`;
    title = cap(body);
    rule =
      `Resolves YES if the following is confirmed by the official Big Brother Naija announcement (live show or official Africa Magic / Showmax channels) by ${fmtWat(eventUnix + 3 * H)}: ` +
      `${cap(body)}. Resolves NO if the official announcement says otherwise or nothing is announced by then. Fan polls and leaks do not count.`;
    sources = ["https://www.africamagic.tv", "https://www.showmax.com", "https://x.com/BBNaija"];
  } else {
    kind = "generic";
    const stmt = cap(body.replace(/\?$/, ""));
    question = `Will ${body.replace(/\?$/, "")} by ${timeTxt}?`;
    title = stmt;
    rule =
      `Resolves YES if the answer to "Will ${body.replace(/\?$/, "")}?" is clearly yes by ${timeTxt}, as confirmed by at least one of the listed sources. ` +
      `Resolves NO if it has not clearly happened by then. If sources disagree, the first listed source wins.`;
    sources = category === "politics"
      ? (/election|inec|vote/i.test(text) ? ["https://www.inecnigeria.org", "https://www.reuters.com", "https://www.premiumtimesng.com"] : ["https://www.reuters.com", "https://www.premiumtimesng.com", "https://www.channelstv.com"])
      : category === "finance" ? ["https://www.reuters.com", "https://www.bloomberg.com", "https://www.cbn.gov.ng"]
      : ["https://www.reuters.com", "https://www.bbc.com/news", "https://www.channelstv.com"];
    warnings.push("I couldn't match a template (match, scorer, price, BBNaija), so check the rule and sources carefully.");
  }

  const t = timing(kind, eventUnix, now);
  if (t.end <= now) warnings.push("That time is already in the past. Pick a future time with `| <when>`.");
  if (t.marketType === "standard") warnings.push(`Starts more than 72h from now, so this is a standard market ($${LIMITS.fees.standard} fee).`);
  if (t.eventInProgress) warnings.push("The event starts within the hour, so it is created as 'event in progress' (breaking).");
  if (/sun rise|will .* exist|100%|guaranteed/i.test(text)) warnings.push("Looks one-sided. If over 90% of traders pick one side, the creator royalty is cut.");

  question = question.replace(/\s+/g, " ").replace(/\?\?+$/, "?");
  if (question.length > LIMITS.question) {
    warnings.push("Question was too long and has been shortened.");
    question = question.slice(0, LIMITS.question - 1) + "?";
  }
  if (rule.length > LIMITS.rule) rule = rule.slice(0, LIMITS.rule);

  return {
    kind,
    question,
    title: title.slice(0, 120),
    description: `Created from a group chat with Pot. ${rule}`.slice(0, 1000),
    resolutionRule: rule,
    sourcesOfTruth: sources.slice(0, LIMITS.maxSources),
    category,
    marketType: t.marketType,
    eventInProgress: t.eventInProgress,
    startTime: t.start,
    endTime: t.end,
    resolutionTime: t.resolution,
    region,
    creationFeeUsdc: LIMITS.fees[t.marketType],
    warnings,
  };
}

/** Validation mirroring Panta's create/quote constraints. Returns a list of problems (empty = ok). */
export function validateDraft(d: MarketDraft, now = Math.floor(Date.now() / 1000)): string[] {
  const errs: string[] = [];
  if (!d.question || d.question.length > LIMITS.question) errs.push("question must be 1–512 characters");
  if (!d.resolutionRule || d.resolutionRule.length > LIMITS.rule) errs.push("rule must be 1–2048 characters");
  if (!d.sourcesOfTruth.length || d.sourcesOfTruth.length > LIMITS.maxSources) errs.push("need 1–20 sources");
  if (!(PANTA_CATEGORIES as readonly string[]).includes(d.category)) errs.push("bad category");
  if (!(d.startTime < d.endTime && d.endTime <= d.resolutionTime)) errs.push("times must satisfy start < end ≤ resolution");
  if (d.endTime <= now) errs.push("end time is in the past");
  if (!d.eventInProgress && d.startTime - now < LIMITS.minStartDelaySec) errs.push("start must be at least 1 hour from now");
  if (d.eventInProgress && d.marketType !== "breaking") errs.push("event-in-progress is only allowed for breaking markets");
  if (d.marketType === "breaking" && d.startTime - now > LIMITS.breakingWindowSec) errs.push("breaking markets must start within 72h");
  return errs;
}

/** Body for POST /markets/create/quote/ (imageUrl filled in by the server). */
export function toCreateQuoteBody(d: MarketDraft, wallet: string, imageUrl: string) {
  return {
    wallet,
    question: d.question,
    title: d.title,
    description: d.description,
    resolutionRule: d.resolutionRule,
    sourcesOfTruth: d.sourcesOfTruth,
    category: d.category,
    startTime: d.startTime,
    endTime: d.endTime,
    resolutionTime: d.resolutionTime,
    marketType: d.marketType,
    ...(d.eventInProgress ? { eventInProgress: true } : {}),
    imageUrl,
    region: d.region,
  };
}
