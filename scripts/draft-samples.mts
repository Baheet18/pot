/** Live smoke run of the AI drafter on varied prompts; writes draft-samples.md. Reads the Gemini key via geminiKey() (never printed). */
import { writeFileSync } from "node:fs";
import { fmtWat, validateDraft } from "@pot/core";
import { draftWithAI } from "@pot/server";

const PROMPTS = [
  "/new will PSG win the champions league this season",
  "/new Trump out as President before 2027?",
  "/new Super Eagles vs Benin Friday",
  "/new BTC 150k by Dec 31",
  "/new BBNaija winner",
  "/new Obi joins ADC",
];
const now = Math.floor(Date.now() / 1000);
const out: string[] = [`# Pot AI draft samples`, ``, `Generated ${fmtWat(now)} with the live AI drafter (Panta test mode, nothing created).`, ``];
for (const p of PROMPTS) {
  const t0 = Date.now();
  const r = await draftWithAI(p, { now });
  const ms = Date.now() - t0;
  out.push(`## \`${p}\``, ``);
  if (r.kind === "clarify") { out.push(`**Asks back:** ${r.question}`, ``, `_${ms} ms_`, ``); console.log(p, "→ clarify:", r.question); continue; }
  const d = r.draft;
  const problems = validateDraft(d, now);
  out.push(
    `- **Drafter:** ${d.drafter === "ai" ? "AI" : "rule-based fallback"} (${ms} ms)`,
    `- **Question:** ${d.question}`,
    `- **Buying closes:** ${fmtWat(d.startTime)}`,
    `- **Ends:** ${fmtWat(d.endTime)} · **Result by:** ${fmtWat(d.resolutionTime)}`,
    `- **Type:** ${d.marketType} ($${d.creationFeeUsdc})${d.eventInProgress ? " · event in progress" : ""} · ${d.category} · ${d.region}`,
    `- **Sources:** ${d.sourcesOfTruth.join(", ")}`,
    `- **Warnings:** ${d.warnings.length ? d.warnings.join(" / ") : "none"}`,
    `- **Blocked:** ${problems.length ? problems.join("; ") : "no"}`,
    ``, `**Rule:** ${d.resolutionRule}`, ``,
  );
  console.log(p, "→", d.drafter, "|", d.question, "|", fmtWat(d.endTime), "|", d.marketType);
}
writeFileSync(new URL("../draft-samples.md", import.meta.url), out.join("\n"));
