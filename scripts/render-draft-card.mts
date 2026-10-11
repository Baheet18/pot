/** Renders a Telegram-style image source of a REAL bot draft: the production AI drafter (operator demo route) + the bot's own draftPreview/draftKeyboard. */
import { readFileSync, writeFileSync } from "node:fs";
import { validateDraft } from "@pot/core";
import { draftKeyboard, draftPreview } from "../apps/bot/src/bot";
const Q = process.argv[2], B = "https://pot-navy.vercel.app";
const S = readFileSync(process.env.HOME + "/.pot/cron_secret", "utf8").trim();
const r = await fetch(B + "/api/pot/test-data", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${S}` }, body: JSON.stringify({ demo: Q }) });
const j = await r.json();
if (!j.draft) { console.log("not a draft:", JSON.stringify(j).slice(0, 400)); process.exit(1); }
const d = j.draft, problems = validateDraft(d);
const kb = draftKeyboard("demo", d, problems) as any;
const rows = (kb.inline_keyboard as any[][]).map((row) => `<div class="row">${row.map((b) => `<span>${b.text}</span>`).join("")}</div>`).join("");
writeFileSync(process.argv[3], `<!doctype html><meta charset=utf-8><style>
body{background:#0e1621;font:15px/1.45 -apple-system,Segoe UI,Roboto,"Noto Color Emoji",sans-serif;color:#fff;margin:0;padding:18px;width:394px}
.h{color:#7f91a4;font-size:13px;margin:12px 0 6px}.b{background:#182533;border-radius:12px;padding:10px 12px}
.me{background:#2b5278;border-radius:12px;padding:8px 12px;margin-left:auto;width:max-content;max-width:88%}
a{color:#6ab3f3}code{background:#0006;padding:0 3px;border-radius:3px}.kb .row{display:flex;gap:4px;margin-top:4px}
.kb span{flex:1;text-align:center;background:#2b5278aa;border-radius:8px;padding:7px 4px;font-size:14px}
.lab{color:#7f91a4;font-size:11px;text-align:center;margin-top:14px}</style>
<div class="h">Pot demo group</div><div class="me">/new ${Q.replace(/</g, "&lt;")}</div>
<div class="h">Pot (@pantapotbot)</div><div class="b">${draftPreview(d, problems).replace(/\n/g, "<br>")}</div><div class="kb">${rows}</div>
<div class="lab">Rendered from the real Pot bot output (production AI drafter + the bot's own message code), ${new Date().toISOString().slice(0, 10)}. Telegram styling is a mock-up.</div>`);
console.log("ok", d.title);
