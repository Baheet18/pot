import { draftMarket, fmtWat, LIMITS, PANTA_CATEGORIES, validateDraft, type MarketDraft, type PantaCategory } from "@pot/core";
import { geminiKey } from "./secrets";

/**
 * AI market drafter (Gemini, structured JSON). The model writes the market; this file checks every field
 * (times in the future and ordered, breaking/standard and fee from the timing, https sources, lengths) and
 * falls back to the rule-based drafter only when Gemini is unavailable or returns something unusable.
 * The API key travels only in the x-goog-api-key header and is never logged.
 */
// gemini-2.5-flash is closed to new API users ("no longer available to new users"), so use the current Flash
// model with a preview fallback. Override with POT_GEMINI_MODEL.
// The free tier allows ~20 requests/day per model, so several Flash models are tried in order.
export const GEMINI_MODELS = (process.env.POT_GEMINI_MODEL || "gemini-3.8-flash,gemini-3-flash-preview,gemini-3.6-flash,gemini-3.5-flash").split(",").map((s) => s.trim()).filter(Boolean);
const ENDPOINT = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const H = 3600;

export type DraftResult =
  | { kind: "draft"; draft: MarketDraft }
  | { kind: "clarify"; question: string };

export interface AiOptions {
  now?: number;
  key?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const FLAG_TYPES = ["ambiguous", "unverifiable", "already_decided", "too_soon", "one_sided", "disallowed", "date_uncertain"] as const;

/** Gemini responseSchema (OpenAPI subset). */
export const AI_SCHEMA = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["draft", "clarify"] },
    clarifyingQuestion: { type: "STRING", description: "Only when status=clarify: one short question to the admin." },
    question: { type: "STRING" },
    title: { type: "STRING" },
    description: { type: "STRING" },
    resolutionRule: { type: "STRING" },
    sourcesOfTruth: { type: "ARRAY", items: { type: "STRING" } },
    category: { type: "STRING", enum: [...PANTA_CATEGORIES] },
    region: { type: "STRING" },
    buyingClosesAt: { type: "STRING", description: "ISO 8601 with +01:00 offset. Panta startTime." },
    endsAt: { type: "STRING", description: "ISO 8601 with +01:00 offset. Panta endTime." },
    resolvesAt: { type: "STRING", description: "ISO 8601 with +01:00 offset. Panta resolutionTime." },
    marketType: { type: "STRING", enum: ["breaking", "standard"] },
    eventInProgress: { type: "BOOLEAN" },
    dateConfidence: { type: "STRING", enum: ["high", "medium", "low"] },
    flags: { type: "ARRAY", items: { type: "OBJECT", properties: { type: { type: "STRING", enum: [...FLAG_TYPES] }, note: { type: "STRING" } }, required: ["type", "note"] } },
  },
  required: ["status"],
  propertyOrdering: ["status", "clarifyingQuestion", "question", "title", "description", "resolutionRule", "sourcesOfTruth", "category", "region",
    "buyingClosesAt", "endsAt", "resolvesAt", "marketType", "eventInProgress", "dateConfidence", "flags"],
};

function nowLine(now: number) {
  const d = new Date(now * 1000).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${d} WAT (Africa/Lagos, UTC+1, no daylight saving). Unix time ${now}.`;
}

export function systemPrompt(now: number): string {
  return `You write prediction markets for Pot, a Telegram bot that creates markets on Panta (Solana). A group admin typed a rough idea; turn it into one excellent, unambiguous YES/NO market. The admin reviews your draft before paying, so be precise and honest about doubts.

NOW: ${nowLine(now)}
All times you output are ISO 8601 with the +01:00 offset (WAT). Write times for people as e.g. "23:59 WAT on 31 December 2026".

QUESTION
- One clean, grammatical YES/NO question starting with "Will". Fix the admin's grammar and shorthand (e.g. "Trump out as President" -> "Will Donald Trump leave office as US President ..."). Use full names and official competition names.
- State the deadline or time frame naturally ONCE (e.g. "before January 1, 2027", "in the 2026–27 UEFA Champions League", "on Friday, 9 October 2026"). Never append a second "by <date>". Never add a time-of-day to a question unless it matters.
- "this season", "this year", "next election" etc. must be resolved to the real competition/period (e.g. this season Champions League = 2026–27 UEFA Champions League; final expected late May / early June 2027).
- title: short version (max 80 chars) for cards.

RESOLUTION RULE (max ~1500 characters, plain English)
- Exactly when it resolves YES and when NO.
- What counts and what doesn't (e.g. for leaving office: resignation, removal, death, constitutional succession such as the US 25th Amendment; an acting/temporary handover does not count; announcements of intent don't count). For football: regular time + stoppage time unless the question is about winning a trophy/tie (then extra time and penalties count). For prices: name the exact feed, pair, and whether it is a touch (any time before the deadline) or a close/reading at a set minute.
- Postponements, cancellations, abandonments, ties/draws, void or replayed events, disputed or overturned results, and what happens if the event never takes place by the deadline.
- Official vs reported: say which announcement decides (e.g. official league/organiser result, electoral commission declaration) and that rumours/leaks/fan polls don't count. If sources disagree, the first listed source wins.
- State the deadline in WAT. Every deadline or cut-off mentioned in the rule (including for postponements) must be exactly endsAt, so the rule and the market times never disagree.
- Panta markets resolve only YES or NO. There is no "void", "refund" or "cancelled market" outcome; say explicitly whether each edge case resolves YES or NO (usually NO if the event doesn't happen as described by the deadline).

SOURCES: 2–3 authoritative https URLs matched to the topic and country. Examples: US politics: https://apnews.com, https://www.reuters.com, https://www.whitehouse.gov. Nigeria politics: https://www.premiumtimesng.com, https://www.channelstv.com (+ https://www.inecnigeria.org for elections). UK: https://www.bbc.co.uk/news, https://www.gov.uk. Football: the official organiser first (https://www.uefa.com, https://www.premierleague.com, https://www.cafonline.com, https://thenff.com, https://www.fifa.com) then https://www.espn.com/soccer/ or https://www.bbc.com/sport/football. Crypto: https://www.coinbase.com/price and https://www.coingecko.com. BBNaija: https://www.africamagic.tv, https://www.showmax.com. Use homepages or stable section pages, never invented deep links.

TIMES (Panta rules)
- buyingClosesAt (Panta startTime): buying is only open before this. For a single event (match, show, announcement at a known time) = the scheduled start/kick-off. For "will X happen by <deadline>" questions = 1 hour before the deadline, or earlier if a decisive scheduled event exists (e.g. a final's kick-off).
- endsAt (Panta endTime): when the outcome is known or the deadline passes (for a match: kick-off + about 2.5 hours; for a season trophy: shortly after the final ends; for a deadline: the deadline itself).
- resolvesAt (Panta resolutionTime): about 1–24 hours after endsAt, enough for the official result.
- Order must be: now + 1 hour <= buyingClosesAt < endsAt <= resolvesAt.
- Matches: buyingClosesAt = kick-off; endsAt = kick-off + about 2.5 hours (or the end of the postponement window you allow in the rule).
- If the decisive date is uncertain, put buyingClosesAt on the EARLIEST plausible date of the decisive event (so nobody can buy after the result is known) and endsAt on the LATEST plausible date (e.g. 30 June 2027 for a final expected late May / early June 2027).
- marketType: "breaking" only if buyingClosesAt is within 72 hours of now (fee $20); otherwise "standard" (fee $50). Long-dated events are always standard.
- eventInProgress: true only for a breaking market whose event has already started or starts within the hour.
- Only use specific dates (fixtures, finals, elections, shows) when you are confident they are scheduled. If you are not sure of the exact date, pick a safe later deadline, set dateConfidence "low" and add a date_uncertain flag telling the admin what to check. Do not invent kick-off times; if a match day is known but the time isn't, use a reasonable time and flag it.

CATEGORY: one of ${PANTA_CATEGORIES.join(", ")}. REGION: "Nigeria" for Nigerian topics, "Kenya" for Kenyan topics, otherwise "Global".

FLAGS (add every one that applies, each with a short note to the admin):
- ambiguous: a term could be read two ways (say which reading you chose).
- unverifiable: no reliable public source can settle it.
- already_decided: the outcome is already known, or the event already happened.
- too_soon: the event starts in under an hour or the deadline is too close for a fair market.
- one_sided: almost everyone would pick one side (over 90% on one side cuts the creator royalty).
- disallowed: the market is ABOUT someone's death, injury, assassination or harm, terrorism or violence, sexual content, minors, private individuals' personal lives, illegal activity, or outcomes the creator or group can directly control (manipulation). Still return status "draft" with a neutral question, but add this flag with the reason. Markets about leaving office, elections, appointments, resignations, trophies or prices are allowed even if death is one of many paths in the rule; do NOT flag those.
- date_uncertain: see TIMES.

CLARIFY: if the idea is too vague to write a fair market, return status "clarify" with ONE short, friendly question and nothing else. Too vague means: no clear event or measurable outcome ("/new football tomorrow", "will it be good"), or an event without saying what YES means ("/new BBNaija winner" -> ask which housemate or group of housemates YES should be; "/new Arsenal match" -> ask which match and which result). Do not invent the outcome yourself. When there is one sensible reading, draft it and flag any doubt instead of asking: "Team A vs Team B <day>" means "Will Team A win?" (Team A = the first-named team, e.g. "Super Eagles vs Benin Friday" -> "Will Nigeria beat Benin ...?").`;
}

interface AiOut {
  status?: string; clarifyingQuestion?: string; question?: string; title?: string; description?: string; resolutionRule?: string;
  sourcesOfTruth?: string[]; category?: string; region?: string; buyingClosesAt?: string; endsAt?: string; resolvesAt?: string;
  marketType?: string; eventInProgress?: boolean; dateConfidence?: string; flags?: Array<{ type?: string; note?: string }>;
}

const toUnix = (s: unknown): number | null => {
  if (typeof s !== "string" || !s.trim()) return null;
  // Treat a bare local time as WAT.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s.trim()) ? s.trim() : `${s.trim()}+01:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};
const isHttps = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && !!x.hostname.includes("."); } catch { return false; } };

/** Turn the model's JSON into a MarketDraft, correcting what can be corrected. Returns problems that can't be fixed. */
export function toMarketDraft(o: AiOut, now: number): { draft: MarketDraft | null; problems: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  let question = (o.question ?? "").replace(/\s+/g, " ").trim();
  const rule = (o.resolutionRule ?? "").trim();
  if (!question) problems.push("missing question");
  if (!rule) problems.push("missing resolutionRule");
  if (question && !question.endsWith("?")) question += "?";
  if (question.length > LIMITS.question) problems.push("question too long");
  if (rule.length > LIMITS.rule) problems.push(`resolutionRule is ${rule.length} characters (max ${LIMITS.rule})`);
  if (rule && rule.length < 350) problems.push("resolutionRule is too thin: spell out what counts and what doesn't, postponement/edge cases, which source decides, and the deadline in WAT");

  const raw = Array.isArray(o.sourcesOfTruth) ? o.sourcesOfTruth.map((s) => String(s).trim()) : [];
  const sources = [...new Set(raw.filter(isHttps))].slice(0, 3);
  if (raw.length > sources.length && sources.length) warnings.push("Dropped source links that weren't valid https URLs.");
  if (!sources.length) problems.push("no valid https sources");

  const start = toUnix(o.buyingClosesAt), end = toUnix(o.endsAt);
  let resolution = toUnix(o.resolvesAt);
  if (start === null || end === null) problems.push("buyingClosesAt/endsAt must be ISO dates");
  if (start !== null && end !== null) {
    if (resolution === null || resolution < end) resolution = end + H;
    if (!(start < end)) problems.push("buyingClosesAt must be before endsAt");
    if (end <= now) problems.push("endsAt is in the past");
  }
  if (problems.length) return { draft: null, problems };

  const s = start!, e = end!, r = resolution!;
  const untilStart = s - now;
  const marketType: "breaking" | "standard" = untilStart <= LIMITS.breakingWindowSec ? "breaking" : "standard";
  if (o.marketType && o.marketType !== marketType && marketType === "breaking") warnings.push("Set to breaking because buying closes within 72h from now.");
  let eventInProgress = false;
  if (untilStart < LIMITS.minStartDelaySec) {
    if (marketType === "breaking" && e > now + 15 * 60) { eventInProgress = true; warnings.push("Starts within the hour, so it's created as a breaking market with the event in progress."); }
    else problems.push("buying must close at least 1 hour from now");
  }
  if (problems.length) return { draft: null, problems };

  const category = (PANTA_CATEGORIES as readonly string[]).includes(o.category ?? "") ? (o.category as PantaCategory) : "other";
  const region = typeof o.region === "string" && /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(o.region) ? o.region : "Global";
  const labels: Record<string, string> = { ambiguous: "Ambiguous", unverifiable: "Hard to verify", already_decided: "Already decided", too_soon: "Too soon", one_sided: "Looks one-sided", disallowed: "Not allowed on Panta", date_uncertain: "Check the date" };
  for (const f of o.flags ?? []) {
    if (!f?.type || !(FLAG_TYPES as readonly string[]).includes(f.type)) continue;
    const line = `${labels[f.type]}: ${String(f.note ?? "").slice(0, 300)}`;
    if (f.type === "disallowed" || f.type === "already_decided") blockers.push(line);
    else warnings.push(line);
  }
  if (o.dateConfidence === "low" && !(o.flags ?? []).some((f) => f?.type === "date_uncertain")) warnings.push("Check the date: the AI wasn't sure of the exact schedule.");
  if (marketType === "standard") warnings.push(`Long-dated, so this is a standard market ($${LIMITS.fees.standard} fee).`);

  const title = (o.title ?? question).replace(/\s+/g, " ").trim().slice(0, 120);
  const draft: MarketDraft = {
    kind: "ai",
    question,
    title,
    description: `Created from a group chat with Pot. ${(o.description ?? "").trim() || rule}`.slice(0, 1000),
    resolutionRule: rule,
    sourcesOfTruth: sources,
    category,
    marketType,
    eventInProgress,
    startTime: s,
    endTime: e,
    resolutionTime: r,
    region,
    creationFeeUsdc: LIMITS.fees[marketType],
    warnings,
    drafter: "ai",
    blockers,
  };
  return { draft, problems: [] };
}

class GeminiHttpError extends Error { constructor(public status: number) { super(`Gemini HTTP ${status}`); } }

/** Overall time budget for one draft (Telegram webhook functions run up to 60s). */
const BUDGET_MS = 42_000;

/** Models that hit their quota (429) are skipped for a while on this server instance. */
const cooldown = new Map<string, number>();
export const _resetGeminiCooldown = () => cooldown.clear();

async function callGemini(key: string, contents: unknown[], now: number, opts: AiOptions, deadline: number): Promise<AiOut> {
  let last: unknown = new Error("all AI models are busy or over quota");
  // Two rounds: Gemini sometimes returns 503 or stalls at busy moments. Over-quota models are not retried.
  for (let round = 0; round < 2; round++) {
    for (const model of GEMINI_MODELS) {
      if ((cooldown.get(model) ?? 0) > Date.now()) continue;
      const left = deadline - Date.now();
      if (left < 4000) throw last;
      try { return await callModel(model, key, contents, now, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? 22_000, left) }); }
      catch (e) {
        last = e;
        if (e instanceof GeminiHttpError && e.status === 429) { cooldown.set(model, Date.now() + 30 * 60_000); continue; }
        const retryable = (e as Error).name === "AbortError" || (e instanceof GeminiHttpError && [404, 500, 502, 503, 504].includes(e.status));
        if (!retryable) throw e;
        if (e instanceof GeminiHttpError && e.status === 404) cooldown.set(model, Date.now() + 24 * 3600_000);
      }
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw last;
}

async function callModel(model: string, key: string, contents: unknown[], now: number, opts: AiOptions): Promise<AiOut> {
  const f = opts.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await f(ENDPOINT(model), {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(now) }] },
        contents,
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: AI_SCHEMA,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    });
    if (!res.ok) throw new GeminiHttpError(res.status);
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    const text = j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error("Gemini returned no content");
    return JSON.parse(text) as AiOut;
  } finally {
    clearTimeout(timer);
  }
}

const userTurn = (text: string, when?: string) => ({
  role: "user",
  parts: [{ text: `Admin's idea: ${JSON.stringify(text)}${when ? `\nAdmin's timing note: ${JSON.stringify(when)}` : ""}\nDraft the market as JSON.` }],
});

/** Rule-based fallback, clearly labelled. */
function rulesDraft(text: string, now: number, why: string): DraftResult {
  const d = draftMarket(text, { now });
  d.drafter = "rules";
  d.warnings.unshift(`AI drafter unavailable (${why}), so this was written by the basic rule-based drafter. Check everything carefully.`);
  return { kind: "draft", draft: d };
}

/**
 * Draft a market from a /new message (or revise `previous` with an admin instruction).
 * Tries Gemini (with one repair attempt if validation fails), then falls back to the rule-based drafter.
 */
export async function draftWithAI(input: string, opts: AiOptions & { previous?: MarketDraft; instruction?: string } = {}): Promise<DraftResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  let text = input.replace(/^\/new(@\w+)?\s*/i, "").trim();
  let when: string | undefined;
  if (text.includes("|")) { const [a, ...rest] = text.split("|"); text = a.trim(); when = rest.join(" ").trim(); }
  if (!text && !opts.previous) throw new Error("Tell me the question, e.g. /new Will Nigeria beat Benin on Friday 5pm?");
  const key = opts.key === undefined ? geminiKey() : opts.key;
  if (!key) {
    if (opts.previous) throw new Error("The AI drafter isn't set up, so use /edit <field> <value> instead.");
    return rulesDraft(input, now, "no AI key");
  }

  const contents: unknown[] = opts.previous
    ? [{ role: "user", parts: [{ text: `Here is the current draft as JSON:\n${JSON.stringify(publicFields(opts.previous))}\n\nThe admin asks for this change: ${JSON.stringify(opts.instruction ?? input)}\nReturn the full revised market as JSON (keep everything else unless the change requires it).` }] }]
    : [userTurn(text, when)];
  const deadline = Date.now() + (opts.timeoutMs ? opts.timeoutMs * 3 : BUDGET_MS);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0 && deadline - Date.now() < 12_000) break; // no time left for a repair round
      const out = await callGemini(key, contents, now, opts, deadline);
      if (out.status === "clarify" && !opts.previous) {
        const q = (out.clarifyingQuestion ?? "").trim();
        if (q) return { kind: "clarify", question: q.slice(0, 400) };
      }
      const { draft, problems } = toMarketDraft(out, now);
      if (draft) {
        const left = validateDraft({ ...draft, blockers: [] }, now);
        if (!left.length) return { kind: "draft", draft };
        problems.push(...left);
      }
      contents.push({ role: "model", parts: [{ text: JSON.stringify(out) }] });
      contents.push({ role: "user", parts: [{ text: `That draft has problems: ${problems.join("; ")}. Fix them and return the full JSON again.` }] });
    }
    if (opts.previous) throw new Error("The AI couldn't apply that change cleanly. Try /edit <field> <value>.");
    return rulesDraft(input, now, "AI draft failed validation");
  } catch (e) {
    if (opts.previous) throw e instanceof Error && /AI couldn't/.test(e.message) ? e : new Error("The AI drafter is unavailable right now. Use /edit <field> <value> instead.");
    const why = (e as Error).name === "AbortError" ? "timed out" : /HTTP (\d+)/.exec((e as Error).message)?.[0] ?? "error";
    console.error("[pot] AI draft fallback:", why);
    return rulesDraft(input, now, why);
  }
}

/** Fields shown to the model when revising (WAT ISO times). */
function publicFields(d: MarketDraft) {
  const iso = (u: number) => new Date((u + H) * 1000).toISOString().replace(/\.\d{3}Z$/, "+01:00");
  return {
    question: d.question, title: d.title, resolutionRule: d.resolutionRule, sourcesOfTruth: d.sourcesOfTruth, category: d.category, region: d.region,
    buyingClosesAt: iso(d.startTime), endsAt: iso(d.endTime), resolvesAt: iso(d.resolutionTime), marketType: d.marketType,
  };
}

// ---------------------------------------------------------------- /edit <field> <value>
export const EDIT_FIELDS = ["question", "title", "rule", "sources", "closes", "ends", "resolves", "category", "region"] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

/** Apply a deterministic edit; times accept ISO or natural text in WAT (e.g. "31 May 2027 21:00"). Recomputes type and fee. */
export function applyEdit(d: MarketDraft, field: string, value: string, now = Math.floor(Date.now() / 1000), parseWhen?: (s: string) => number | null): MarketDraft {
  const v = value.trim();
  if (!v) throw new Error(`Give a value, e.g. /edit ${field} …`);
  const out: MarketDraft = { ...d, warnings: d.warnings.filter((w) => !/standard market|breaking market|Set to (breaking|standard)/.test(w)) };
  const when = (s: string) => {
    const t = toUnixLoose(s) ?? parseWhen?.(s) ?? null;
    if (t === null) throw new Error(`I couldn't read "${s}" as a date/time. Try e.g. 31 May 2027 21:00`);
    return t;
  };
  switch (field.toLowerCase()) {
    case "question": out.question = v.endsWith("?") ? v : `${v}?`; break;
    case "title": out.title = v.slice(0, 120); break;
    case "rule": out.resolutionRule = v; out.description = `Created from a group chat with Pot. ${v}`.slice(0, 1000); break;
    case "sources": {
      const list = v.split(/[\s,]+/).filter(Boolean);
      const bad = list.filter((u) => !isHttps(u));
      if (bad.length) throw new Error(`Sources must be https links: ${bad.join(" ")}`);
      out.sourcesOfTruth = list.slice(0, LIMITS.maxSources); break;
    }
    case "closes": case "close": case "start": out.startTime = when(v); break;
    case "ends": case "end": out.endTime = when(v); if (out.resolutionTime < out.endTime) out.resolutionTime = out.endTime + H; break;
    case "resolves": case "resolution": out.resolutionTime = when(v); break;
    case "category": {
      if (!(PANTA_CATEGORIES as readonly string[]).includes(v.toLowerCase())) throw new Error(`Category must be one of: ${PANTA_CATEGORIES.join(", ")}`);
      out.category = v.toLowerCase() as PantaCategory; break;
    }
    case "region": out.region = v.slice(0, 40); break;
    default: throw new Error(`I can edit: ${EDIT_FIELDS.join(", ")}. Example: /edit ends 31 May 2027 23:00`);
  }
  const untilStart = out.startTime - now;
  out.marketType = untilStart <= LIMITS.breakingWindowSec ? "breaking" : "standard";
  out.eventInProgress = out.marketType === "breaking" && untilStart < LIMITS.minStartDelaySec && out.endTime > now + 15 * 60;
  out.creationFeeUsdc = LIMITS.fees[out.marketType];
  if (out.marketType === "standard") out.warnings.push(`Long-dated, so this is a standard market ($${LIMITS.fees.standard} fee).`);
  return out;
}
function toUnixLoose(s: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(s.trim())) return toUnix(s.trim().replace(" ", "T"));
  return null;
}

export const describeTimes = (d: MarketDraft) => `buying closes ${fmtWat(d.startTime)}, ends ${fmtWat(d.endTime)}`;
