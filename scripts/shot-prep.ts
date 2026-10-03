/** Prepares screenshot inputs: a fresh create link, and Telegram-style previews of the bot's draft + card messages. */
import { writeFileSync } from "node:fs";
import { draftMarket, validateDraft } from "@pot/core";
import { getMarketView, saveDraft, sign } from "@pot/server";
import { cardFor, cardMessage, draftPreview } from "../apps/bot/src/bot";
(async () => {
  const d = draftMarket("Will Super Eagles beat Ghana on Saturday 8pm?");
  const row = saveDraft(-1009990001, 7, d);
  writeFileSync("shots/.create_url", `http://localhost:3100/create/${row.id}?t=${sign({ d: row.id, u: 7 }, 3 * 3600)}`);
  const v = await getMarketView("TestMarket1111111111111111111111111111111");
  const card = cardFor(v, { kind: "group", chatId: -1009990001 });
  const msg = cardMessage(card);
  const bubble = (html: string, kb: string) => `<div class="b">${html.replace(/\n/g, "<br>")}</div>${kb}`;
  const kb = `<div class="kb">${card.keyboard.map((r) => `<div class="row">${r.map((b) => `<span>${b.text}</span>`).join("")}</div>`).join("")}</div>`;
  const dkb = validateDraft(d).length ? `<div class="kb"><div class="row"><span>❌ Cancel</span></div></div>` : `<div class="kb"><div class="row"><span>✅ Create ($${d.creationFeeUsdc})</span><span>❌ Cancel</span></div></div>`;
  writeFileSync("shots/telegram.html", `<!doctype html><meta charset=utf-8><style>
    body{background:#0e1621;font:15px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#fff;margin:0;padding:20px;width:440px}
    .h{color:#7f91a4;font-size:13px;margin:14px 0 6px}.b{background:#182533;border-radius:12px;padding:10px 12px}
    .me{background:#2b5278;border-radius:12px;padding:8px 12px;margin-left:auto;width:max-content;max-width:90%}
    a{color:#6ab3f3}code{background:#0006;padding:0 3px;border-radius:3px}.kb .row{display:flex;gap:4px;margin-top:4px}
    .kb span{flex:1;text-align:center;background:#2b5278aa;border-radius:8px;padding:7px 4px;font-size:14px}</style>
    <div class="h">Naija Ballers · group</div><div class="me">/new Will Super Eagles beat Ghana on Saturday 8pm?</div>
    <div class="h">Pot (@pantapotbot)</div>${bubble(draftPreview(d, validateDraft(d)), dkb)}
    <div class="h">Pot (@pantapotbot) · /markets</div>${bubble(card.html, kb)}
    <div class="h">Pot · buy alert</div><div class="b">🟩 BSCD…HxW bought <b>NO</b> $10.00 on <b>Sandbox test market</b> via Ada's link · 🎉 first ever Panta trade for this wallet 🧪</div>`);
  void msg;
  console.log("ok");
})();
