/**
 * Real fixture lookup (ESPN's free, keyless public scoreboard JSON). Used so kick-off times come from the schedule,
 * never from the AI or a guess. One request per sport per WAT day; results cached in memory for 30 minutes.
 *   soccer: site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=YYYYMMDD (every league ESPN covers:
 *           EPL, La Liga, UCL, NPFL, internationals, …)   basketball: …/basketball/nba/scoreboard?dates=YYYYMMDD
 */
const H = 3600;
const WAT = H; // UTC+1, no DST
export interface Fixture { id: string; sport: "soccer" | "basketball"; league: string; home: string; away: string; homeAliases: string[]; awayAliases: string[]; kickoff: number; status: string }

const SOURCES = [
  { sport: "soccer" as const, url: (d: string) => `https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${d}&limit=1000` },
  { sport: "basketball" as const, url: (d: string) => `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d}` },
];

/** Common nicknames → words that appear in ESPN's team names. */
const ALIASES: Record<string, string[]> = {
  "super eagles": ["nigeria"], "black stars": ["ghana"], "bafana bafana": ["south africa"], "lions of teranga": ["senegal"], "pharaohs": ["egypt"],
  "gunners": ["arsenal"], "spurs": ["tottenham"], "man utd": ["manchester united"], "man u": ["manchester united"], "man united": ["manchester united"],
  "man city": ["manchester city"], "barca": ["barcelona"], "psg": ["paris saint-germain"], "juve": ["juventus"], "inter": ["internazionale"],
  "villa": ["aston villa"], "wolves": ["wolverhampton"], "forest": ["nottingham forest"], "palace": ["crystal palace"], "atletico": ["atlético madrid"],
  "real": ["real madrid"], "bayern": ["bayern munich"], "dortmund": ["borussia dortmund"], "lakers": ["los angeles lakers"], "warriors": ["golden state"],
};
const GENERIC = new Set(["united", "city", "town", "real", "athletic", "sporting", "club", "fc", "afc", "cf", "sc", "the", "and", "de", "of", "hotspur", "albion", "county", "rovers", "wanderers", "women", "u20", "u23", "hove"]);

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function aliasesFor(t: { displayName?: string; shortDisplayName?: string; name?: string; location?: string }): string[] {
  const out = new Set<string>();
  for (const n of [t.displayName, t.shortDisplayName, t.location, t.name]) {
    if (!n) continue;
    const x = norm(n).replace(/\b(fc|afc|cf|sc)\b/g, "").replace(/\s+/g, " ").trim();
    if (x.length >= 3) out.add(x);
    const first = x.split(" ")[0];
    if (first && first.length >= 4 && !GENERIC.has(first)) out.add(first); // "leeds", "arsenal", "tottenham"
  }
  return [...out];
}
const has = (text: string, alias: string) => new RegExp(`(^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(text);
/** Normalized question text with nicknames expanded. */
export function expandAliases(text: string): string {
  let t = ` ${norm(text)} `;
  for (const [k, v] of Object.entries(ALIASES)) if (has(t.trim(), k)) t += ` ${v.join(" ")} `;
  return t.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- fetching (cached)
type Fetcher = typeof fetch;
let fetcher: Fetcher = (...a) => fetch(...a);
/** Tests only. */
export const setFixtureFetcher = (f: Fetcher | null) => { fetcher = f ?? ((...a) => fetch(...a)); cache.clear(); };
const cache = new Map<string, { at: number; data: Promise<Fixture[]> }>();
const TTL_MS = 30 * 60_000;

export const watDay = (unix: number) => new Date((unix + WAT) * 1000).toISOString().slice(0, 10).replace(/-/g, "");

async function fetchDay(src: (typeof SOURCES)[number], day: string): Promise<Fixture[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetcher(src.url(day), { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const j = (await res.json()) as { events?: any[] };
    return (j.events ?? []).flatMap((e): Fixture[] => {
      const c = e?.competitions?.[0]?.competitors ?? [];
      const home = c.find((x: any) => x.homeAway === "home")?.team, away = c.find((x: any) => x.homeAway === "away")?.team;
      const kickoff = Math.floor(Date.parse(e?.date) / 1000);
      if (!home || !away || !Number.isFinite(kickoff)) return [];
      const league = String(e?.season?.slug ?? "").replace(/^\d{4}(-\d{2})?-/, "").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || src.sport;
      return [{ id: String(e.id), sport: src.sport, league, home: home.displayName, away: away.displayName, homeAliases: aliasesFor(home), awayAliases: aliasesFor(away), kickoff, status: String(e?.status?.type?.name ?? "") }];
    });
  } catch { return []; } finally { clearTimeout(timer); }
}
function cachedDay(src: (typeof SOURCES)[number], day: string): Promise<Fixture[]> {
  const k = `${src.sport}:${day}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = fetchDay(src, day);
  cache.set(k, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------- matching
export interface FixtureMatch { fixture: Fixture; both: boolean }
/** Teams named in the text, against fixtures. Both teams named beats one. Only upcoming (not started/finished) fixtures. */
export function matchFixtures(text: string, fixtures: Fixture[], now: number): FixtureMatch[] {
  const t = expandAliases(text);
  const hit = (al: string[]) => al.some((a) => has(t, a));
  const out: FixtureMatch[] = [];
  const seen = new Set<string>();
  for (const f of fixtures) {
    if (seen.has(f.id) || f.kickoff <= now || /FINAL|IN_PROGRESS|POSTPONED|CANCELED/.test(f.status)) continue;
    const h = hit(f.homeAliases), a = hit(f.awayAliases);
    if (h || a) { out.push({ fixture: f, both: h && a }); seen.add(f.id); }
  }
  const both = out.filter((m) => m.both);
  return (both.length ? both : out).sort((x, y) => x.fixture.kickoff - y.fixture.kickoff);
}

export const SPORTS_RE = /\b(vs\.?|v\.?|versus|against|beat|beats|draw|match|game|fixture|derby|kick[- ]?off|win (?:against|over|at|vs|today|tonight|tomorrow|tmrw|this weekend|on))\b/i;

/**
 * Look up the real fixture for a sports question, from today (WAT) up to `days` ahead.
 * Returns the matches found (nearest first). Nothing is guessed: no match → [].
 */
export async function lookupFixtures(text: string, now: number, days = 7): Promise<FixtureMatch[]> {
  if (!SPORTS_RE.test(text)) return [];
  const dayList = Array.from({ length: days + 1 }, (_, i) => watDay(now + i * 86_400));
  // Near days first (most /new questions are about today/tomorrow); the rest only if nothing matched.
  for (const chunk of [dayList.slice(0, 2), dayList.slice(2)]) {
    if (!chunk.length) continue;
    const lists = await Promise.all(chunk.flatMap((d) => SOURCES.map((s) => cachedDay(s, d))));
    const found = matchFixtures(text, lists.flat(), now);
    if (found.length) return found;
  }
  return [];
}
