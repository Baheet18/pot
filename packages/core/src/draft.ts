import * as chrono from "chrono-node";
import { exactWat, findDeadline, longDate, watParts, watTime } from "./deadline";

/**
 * Market drafter: turns a plain sentence from a group chat into a Panta-ready market
 * (question, resolution rule, sources, times, breaking vs standard).
 * Deterministic templates (no LLM) so the wording is predictable and testable. Deadlines ("before 2027",
 * "by end of month", "this weekend") come from ./deadline; topic-matched sources from sourcesFor().
 * All times are interpreted in WAT (Africa/Lagos, UTC+1) unless the text says otherwise.
 */

export const WAT_OFFSET_MIN = 60;
export const PANTA_CATEGORIES = ["sports", "crypto", "politics", "entertainment", "finance", "science", "world", "other"] as const;
export type PantaCategory = (typeof PANTA_CATEGORIES)[number];
export type DraftKind = "match" | "scorer" | "price" | "reality" | "office" | "election" | "generic" | "ai";

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
  /** Who wrote it: the AI drafter (Gemini) or the basic rule-based fallback. */
  drafter?: "ai" | "rules";
  /** Problems that block creation (e.g. disallowed content, already decided). */
  blockers?: string[];
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

const US_RE = /\b(trump|biden|kamala|harris|vance|white house|congress|u\.?s\.? president|us president|america|united states|potus|republican|democrat|gop)\b/i;
const UK_RE = /\b(starmer|sunak|downing street|uk prime minister|british|britain|united kingdom|\buk\b|westminster)\b/i;
const NG_RE = /\b(nigeria|nigerian|super eagles|naija|lagos|abuja|naira|npfl|inec|tinubu|atiku|peter obi|obi|shettima|wike|apc|pdp|adc|labour party|kwankwaso|wizkid|davido|burna boy|tems|asake|bbnaija|nollywood)\b/i;

function detectCategory(t: string): PantaCategory {
  if (/bbnaija|big brother|housemate|evict|grammy|oscars|album|movie|box office|headies|afrobeats|tour\b/i.test(t)) return "entertainment";
  if (/\b(btc|bitcoin|eth|ethereum|sol|solana|bnb|xrp|doge|dogecoin|memecoin|token|airdrop|crypto)\b/i.test(t)) return "crypto";
  if (/election|president|presidency|senate|governor|inec|tinubu|obi\b|atiku|vote|minister|parliament|impeach|resign|trump|biden|starmer|putin|zelensk|netanyahu|macron|ruto|white house|congress/i.test(t)) return "politics";
  if (/\b(beat|defeat|score|goal|match|league|cup|vs\.?|fc|united|city|eagles|win against|draw)\b/i.test(t)) return "sports";
  if (/naira|cbn|inflation|interest rate|fed\b|gdp|stock|shares|nasdaq|s&p|dangote|ngx/i.test(t)) return "finance";
  if (/launch|rocket|spacex|nasa|starship/i.test(t)) return "science";
  return "other";
}

function regionFor(t: string, fallback?: string): string {
  if (fallback) return fallback;
  if (NG_RE.test(t)) return "Nigeria";
  if (/kenya|nairobi/i.test(t)) return "Kenya";
  return "Global";
}

function footballSources(t: string): string[] {
  const out: string[] = [];
  for (const [re, url] of COMPETITION_SOURCES) if (re.test(t) && !out.includes(url)) out.push(url);
  return [...out, ...FOOTBALL_FALLBACK].slice(0, 4);
}

/** Resolution sources matched to the topic and country. */
export function sourcesFor(t: string, category: PantaCategory): string[] {
  if (category === "crypto") return ["https://www.coinbase.com/price", "https://www.coingecko.com"];
  if (category === "sports") return footballSources(t);
  if (category === "politics") {
    if (US_RE.test(t)) return ["https://apnews.com", "https://www.reuters.com", "https://www.whitehouse.gov"];
    if (NG_RE.test(t)) return [...(/election|inec|vote|poll/i.test(t) ? ["https://www.inecnigeria.org"] : []), "https://www.premiumtimesng.com", "https://www.channelstv.com", "https://statehouse.gov.ng"];
    if (UK_RE.test(t)) return ["https://www.bbc.co.uk/news", "https://www.gov.uk", "https://www.reuters.com"];
    return ["https://www.reuters.com", "https://apnews.com", "https://www.bbc.com/news"];
  }
  if (category === "finance") return NG_RE.test(t) ? ["https://www.cbn.gov.ng", "https://www.reuters.com", "https://www.premiumtimesng.com"] : ["https://www.reuters.com", "https://www.bloomberg.com", "https://apnews.com"];
  if (category === "entertainment") return NG_RE.test(t) ? ["https://www.pulse.ng", "https://www.premiumtimesng.com", "https://www.billboard.com"] : ["https://www.billboard.com", "https://www.bbc.com/news", "https://www.reuters.com"];
  if (category === "science") return ["https://www.nasa.gov", "https://www.spacex.com", "https://www.reuters.com"];
  return NG_RE.test(t) ? ["https://www.premiumtimesng.com", "https://www.channelstv.com", "https://www.reuters.com"] : ["https://www.reuters.com", "https://apnews.com", "https://www.bbc.com/news"];
}

/** Well-known office holders, so "Trump out as President" becomes a precise question. */
interface Holder { name: string; office: string; short: string; country: "US" | "NG" | "UK" | "other"; pronoun: "he" | "she" }
const HOLDERS: Array<[RegExp, Holder]> = [
  [/\b(donald\s+)?trump\b/i, { name: "Donald Trump", office: "President of the United States", short: "US President", country: "US", pronoun: "he" }],
  [/\b(bola\s+)?(ahmed\s+)?tinubu\b/i, { name: "Bola Tinubu", office: "President of Nigeria", short: "President of Nigeria", country: "NG", pronoun: "he" }],
  [/\b(keir\s+)?starmer\b/i, { name: "Keir Starmer", office: "Prime Minister of the United Kingdom", short: "UK Prime Minister", country: "UK", pronoun: "he" }],
  [/\b(vladimir\s+)?putin\b/i, { name: "Vladimir Putin", office: "President of Russia", short: "President of Russia", country: "other", pronoun: "he" }],
  [/\b(volodymyr\s+)?zelensk(y|yy|iy)\b/i, { name: "Volodymyr Zelenskyy", office: "President of Ukraine", short: "President of Ukraine", country: "other", pronoun: "he" }],
  [/\b(benjamin\s+)?netanyahu\b/i, { name: "Benjamin Netanyahu", office: "Prime Minister of Israel", short: "Prime Minister of Israel", country: "other", pronoun: "he" }],
  [/\b(emmanuel\s+)?macron\b/i, { name: "Emmanuel Macron", office: "President of France", short: "President of France", country: "other", pronoun: "he" }],
  [/\b(william\s+)?ruto\b/i, { name: "William Ruto", office: "President of Kenya", short: "President of Kenya", country: "other", pronoun: "he" }],
  [/\b(narendra\s+)?modi\b/i, { name: "Narendra Modi", office: "Prime Minister of India", short: "Prime Minister of India", country: "other", pronoun: "he" }],
];

/** "Tinubu sign…" → "Bola Tinubu sign…" for well-known names (only when the first name is missing). */
function withFullNames(s: string): string {
  for (const [re, h] of HOLDERS) {
    const m = re.exec(s);
    if (m && !m[1]) { const last = h.name.split(" ").slice(-1)[0]; return s.replace(new RegExp(`\\b${m[0]}\\b`, "i"), h.name).replace(new RegExp(`${h.name}\\s+${last}`), h.name); }
  }
  return s;
}

/** Third-person verbs → base form after "Will …" ("Obi joins ADC" → "Will Obi join ADC"). */
const VERB_BASE: Record<string, string> = {
  joins: "join", wins: "win", signs: "sign", resigns: "resign", leaves: "leave", releases: "release", drops: "drop", announces: "announce",
  becomes: "become", hits: "hit", reaches: "reach", beats: "beat", scores: "score", returns: "return", gets: "get", makes: "make",
  launches: "launch", visits: "visit", passes: "pass", loses: "lose", quits: "quit", goes: "go", does: "do", has: "have", is: "be",
  says: "say", defeats: "defeat", meets: "meet", ends: "end", starts: "start", closes: "close", falls: "fall", rises: "rise", dies: "die",
  marries: "marry", buys: "buy", sells: "sell", sacks: "sack", fires: "fire", appoints: "appoint", approves: "approve", bans: "ban",
};

/** Turn chat shorthand into the clause that follows "Will": strips "will"/"to", fixes "joins" → "join". */
export function normaliseClause(s: string): string {
  let b = clean(s).replace(/\?+$/, "").replace(/^will\s+/i, "");
  const mid = /^(.{1,60}?)\s+(?:will|is going to|is set to|gonna)\s+(.+)$/i.exec(b);
  if (mid) b = `${mid[1]} ${mid[2]}`;
  const to = /^(.{1,60}?)\s+to\s+(?!the\b|a\b|an\b)([a-z]+)\b(.*)$/i.exec(b);
  if (to && !/\b(go|come|travel|move|return|back)$/i.test(to[1]) && /^[a-z]+$/.test(to[2]) && !/^\d/.test(to[2])) b = `${to[1]} ${to[2]}${to[3]}`;
  const words = b.split(" ");
  for (let i = 1; i < Math.min(words.length, 6); i++) {
    const base = VERB_BASE[words[i].toLowerCase()];
    if (base) { words[i] = base; break; }
  }
  return clean(words.join(" "));
}

function officeRule(h: Holder | null, who: string, office: string, exact: string): string {
  const name = h?.name ?? who;
  const pr = h?.pronoun ?? "they";
  const holds = pr === "they" ? "hold" : "holds";
  const common =
    `Resolves YES if ${name} stops being ${office} at any time from market creation until ${exact}, for any reason. ` +
    `It counts only when ${pr} actually ${pr === "they" ? "cease" : "ceases"} to hold the office (for example a successor is sworn in, or the resignation takes legal effect); ` +
    `an announcement, a plan to resign, or a scheduled future exit does not count by itself. ` +
    `If it happens before the deadline, the market resolves YES even if ${pr} later ${pr === "they" ? "return" : "returns"}. `;
  let specific = "";
  if (h?.country === "US" && /President/.test(office)) {
    specific =
      `Leaving office includes resignation, death, removal after impeachment AND conviction by the Senate, or the Vice President becoming President under the 25th Amendment. ` +
      `Impeachment by the House alone does not count. A temporary handover under Section 3 or 4 of the 25th Amendment, where the Vice President is only Acting President and ${name} remains President, does not count. ` +
      `A scheduled inauguration of a successor counts only if it happens before the deadline. `;
  } else if (h?.country === "NG" && /President/.test(office)) {
    specific =
      `Leaving office includes resignation, death, removal by impeachment under Section 143 of the Constitution, or removal for permanent incapacity under Section 144, with the Vice President sworn in as President. ` +
      `The Vice President only acting as President (for example during medical leave) while ${name} remains President does not count. ` +
      `A new President sworn in after an election counts only if the swearing-in happens before the deadline. `;
  } else if (/Prime Minister/i.test(office)) {
    specific =
      `Leaving office includes resignation, death, losing a confidence vote or a party leadership contest, or an election loss, but only once a successor is formally appointed or ${pr} formally leaves office. ` +
      `Staying on as caretaker or interim Prime Minister does not count as leaving. `;
  } else {
    specific = `Leaving office includes resignation, death, removal, impeachment followed by removal, or the end of the term, as long as it takes effect before the deadline. Temporary or acting arrangements while ${pr} still ${holds} the office do not count. `;
  }
  return common + specific + `Resolves NO if ${pr} still ${holds} the office at the deadline. The listed sources decide; if they disagree, the first listed source wins.`;
}

/** Pick start/end/resolution and breaking vs standard from the event time. */
function timing(kind: DraftKind, eventUnix: number, now: number) {
  let start = eventUnix;
  let end: number;
  if (kind === "match" || kind === "scorer") end = eventUnix + 2.5 * H;
  else if (kind === "reality") end = eventUnix + 3 * H;
  else {
    // Price readings and "by <deadline>" events: buying closes 1h before the deadline.
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

const stripSpan = (text: string, index: number, length: number) =>
  clean((text.slice(0, index) + " " + text.slice(index + length)).replace(/\s+/g, " ")).replace(/\b(on|at|this|by|before|in|until|during)\s*$/i, "").trim();

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
  const ch = sportsLike ? findWhen(text, now, explicitWhen, 20, 0) : findWhen(text, now, explicitWhen, 23, 59);
  const dl = findDeadline(explicitWhen ?? text, now);
  // Deadline phrases ("before 2027", "by end of month", "this weekend") win unless chrono found a clock time the deadline parser missed.
  const useDl = !!dl && !(ch.unix !== null && ch.hadTime && !dl.hadTime);
  const rawBody = useDl && !explicitWhen ? stripSpan(text, dl!.index, dl!.length) : clean(stripWhen(text, ch));
  const body = normaliseClause(rawBody);
  const region = regionFor(text, opts.region);

  let kind: DraftKind = "generic";
  let question = "";
  let rule = "";
  let sources: string[] = [];
  let title = "";

  const match = body.match(/^(.+?)\s+(?:beat|defeat|win against|win vs\.?|win over|overcome)\s+(.+)$/i);
  const scorer = body.match(/^(.+?)\s+score(?:s)?(?:\s+(?:a|at least one)\s+goal)?\s+(?:against|vs\.?|v\.?|in the match against)\s+(.+)$/i);
  const price = body.match(/^(?:the\s+)?(?:price of\s+)?([a-z$]+)\s+(?:price\s+)?(?:be\s+|close\s+|trade\s+|go\s+)?(at or above|above|over|hit|reach|below|under|drop below|fall below)\s+(\$?[\d,.]+\s*[km]?)/i);
  const reality = /bbnaija|big brother|housemate|evict/i.test(body);
  const office = body.match(/^(.+?)\s+(?:be\s+)?(?:out|gone|ousted|removed(?:\s+from\s+office)?|resign|step\s+down|leave(?:\s+office)?|quit|exit|no\s+longer\s+be|cease\s+to\s+be)\b\s*(?:(?:as|from)\s+(?:office\s+as\s+)?(?:the\s+)?(.+))?$/i);
  const election = body.match(/^(.+?)\s+win\s+(?:the\s+)?(.*\b(?:election|elections|presidency|presidential|governorship|primary|primaries|race|poll|polls)\b.*)$/i);
  const eventish = !!(match || scorer) && category === "sports" || reality;

  // Event time (kick-off / reading) vs deadline.
  let eventUnix: number;
  let hadTime: boolean;
  if (useDl) {
    eventUnix = dl!.unix; hadTime = dl!.hadTime;
    if (eventish && !hadTime) { const p = watParts(dl!.unix); eventUnix = watTime(p.y, p.m, p.d, sportsLike ? 20 : 23, sportsLike ? 0 : 59); }
  } else if (ch.unix !== null) { eventUnix = ch.unix; hadTime = ch.hadTime; }
  else {
    // Elections like "the 2027 election": use the end of that year until the admin sets the date.
    const yr = /\b(20\d\d)\b/.exec(text);
    if (election && yr && +yr[1] >= watParts(now).y) {
      eventUnix = watTime(+yr[1], 11, 31); hadTime = false;
      warnings.push(`No exact date, so the deadline is the end of ${yr[1]}. Set the real result date with \`| 15 Feb ${yr[1]}\` if you know it.`);
    } else {
      eventUnix = now + 24 * H; hadTime = true;
      warnings.push("No date or deadline found, so I assumed 24 hours from now. Add one with `| Sat 5pm` or write e.g. 'by Dec 31' or 'before 2027'.");
    }
  }
  if ((useDl || ch.unix !== null) && !hadTime && eventish) warnings.push(`No time found, so I assumed ${sportsLike ? "20:00" : "23:59"} WAT. Add one with \`| Sat 5pm\` if that is wrong.`);

  const dateTxt = fmtWatDate(eventUnix);
  const timeTxt = fmtWat(eventUnix);
  const exact = exactWat(eventUnix);
  // Phrase used at the end of deadline-style questions. Never appended twice.
  const phrase = useDl ? dl!.phrase : hadTime ? `by ${timeTxt}` : `by ${longDate(eventUnix)}`;

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
    const down = /below|under/i.test(price[2]);
    const lvl = level !== null ? `$${level.toLocaleString("en-US")}` : price[3];
    const touch = useDl && !/^on\b/i.test(text.slice(dl!.index, dl!.index + dl!.length)) && !/\bclose\b/i.test(body);
    if (touch) {
      question = `Will ${coin.name} (${coin.ticker}) ${down ? "drop below" : "reach"} ${lvl} ${phrase}?`;
      title = `${coin.ticker} ${down ? "below" : "hits"} ${lvl} ${phrase}?`;
      rule =
        `Resolves YES if, at any time from market creation until ${exact}, the ${coin.ticker}-USD price on Coinbase trades ${down ? "below" : "at or above"} ${lvl} ` +
        `(any 1-minute candle ${down ? "low below" : "high at or above"} ${lvl}). If Coinbase is unavailable, CoinGecko's ${coin.ticker}/USD price history is used. ` +
        `Resolves NO if that never happens before the deadline. Prices on other exchanges, wicks on illiquid pairs, and stablecoin pairs other than USD do not count.`;
    } else {
      const dir = down ? "below" : "at or above";
      question = `Will ${coin.name} (${coin.ticker}) be ${dir} ${lvl} at ${timeTxt}?`;
      title = `${coin.ticker} ${down ? "<" : "≥"} ${lvl}?`;
      rule =
        `Resolves YES if the ${coin.ticker}/USD price shown by CoinGecko is ${dir} ${lvl} at ${timeTxt} ` +
        `(the price at that minute; if CoinGecko is unavailable, the close of Coinbase's ${coin.ticker}-USD 1-minute candle for that minute is used). Otherwise resolves NO.`;
    }
    sources = ["https://www.coingecko.com", "https://www.coinbase.com/price"];
  } else if (reality) {
    kind = "reality";
    question = `Will ${body} (by ${dateTxt})?`;
    title = cap(body);
    rule =
      `Resolves YES if the following is confirmed by the official Big Brother Naija announcement (live show or official Africa Magic / Showmax channels) by ${fmtWat(eventUnix + 3 * H)}: ` +
      `${cap(body)}. Resolves NO if the official announcement says otherwise or nothing is announced by then. Fan polls and leaks do not count.`;
    sources = ["https://www.africamagic.tv", "https://www.showmax.com", "https://x.com/BBNaija"];
  } else if (office && office[1].split(" ").length <= 5) {
    kind = "office";
    const who = clean(office[1]);
    const h = HOLDERS.find(([re]) => re.test(who))?.[1] ?? null;
    const officeTxt = h?.office ?? (office[2] ? `the ${clean(office[2])}` : "their current office");
    const short = h?.short ?? (office[2] ? clean(office[2]) : "office holder");
    const name = h?.name ?? cap(who);
    question = `Will ${name} leave office as ${short} ${phrase}?`;
    title = `${name} out as ${short} ${phrase}?`;
    rule = officeRule(h, name, officeTxt, exact);
    sources = h || category === "politics" ? sourcesFor(`${text} ${h ? h.office : ""}`, "politics") : sourcesFor(text, category);
    if (!h) warnings.push(`I don't know ${name}'s exact office. Check the office name in the question and rule.`);
  } else if (election) {
    kind = "election";
    const who = cap(withFullNames(clean(election[1])));
    let contest = clean(election[2]);
    if (NG_RE.test(text) && /^(20\d\d\s+)?(general\s+|presidential\s+)?elections?$/i.test(contest)) contest = `${/20\d\d/.exec(contest)?.[0] ?? ""} Nigerian presidential election`.trim();
    const authority = NG_RE.test(text) ? "INEC (the Independent National Electoral Commission)" : US_RE.test(text) ? "the official certified result (an AP race call is accepted as the trigger)" : "the official electoral authority";
    question = `Will ${who} win the ${contest}${useDl ? ` ${phrase}` : ""}?`;
    title = `${who} to win the ${contest}?`;
    rule =
      `Resolves YES if ${who} is officially declared the winner of the ${contest} by ${authority} by ${exact}. ` +
      `Resolves NO if another candidate is declared the winner, if ${who} withdraws or is disqualified, or if no winner is declared by the deadline (including a postponement). ` +
      `A run-off counts only if it is decided by the deadline. Court or tribunal challenges after the declaration do not change the result unless a final ruling is made before the deadline.`;
    sources = sourcesFor(text, "politics");
  } else {
    kind = "generic";
    const clause = withFullNames(body);
    question = `Will ${clause} ${phrase}?`;
    title = cap(question);
    rule =
      `This market asks: "${cap(question)}" Resolves YES if that actually happens on or before the deadline, ${exact}, as confirmed by at least one of the listed sources. ` +
      `Plans, announcements, rumours or leaks that it will happen do not count. If it happens earlier, the market resolves YES straight away. ` +
      `Resolves NO if it has not clearly happened by the deadline. If the sources disagree, the first listed source wins.`;
    sources = sourcesFor(text, category);
    warnings.push("I couldn't match a template (match, scorer, price, office, election, BBNaija), so check the rule and sources carefully.");
  }

  const t = timing(kind, eventUnix, now);
  if (t.end <= now) warnings.push("That time is already in the past. Pick a future time with `| <when>`.");
  if (t.marketType === "standard") warnings.push(`Starts more than 72h from now, so this is a standard market ($${LIMITS.fees.standard} fee).`);
  if (t.eventInProgress) warnings.push("The event starts within the hour, so it is created as 'event in progress' (breaking).");
  if (/sun rise|will .* exist|100%|guaranteed/i.test(text)) warnings.push("Looks one-sided. If over 90% of traders pick one side, the creator royalty is cut.");

  question = cap(question.replace(/\s+/g, " ").replace(/\s+\?/, "?").replace(/\?\?+$/, "?"));
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
  if (d.marketType === "standard" && d.startTime - now < LIMITS.breakingWindowSec - 3600) errs.push("standard markets must start more than ~72h from now (use breaking)");
  if (d.creationFeeUsdc !== LIMITS.fees[d.marketType]) errs.push("fee doesn't match the market type");
  if (d.sourcesOfTruth.some((u) => !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(u))) errs.push("sources must be https links");
  for (const b of d.blockers ?? []) errs.push(b);
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
