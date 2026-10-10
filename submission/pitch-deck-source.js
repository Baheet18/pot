'use strict';
// Pot pitch deck. Palette, type and the stripe/plate motifs come from the
// "automotive_car_sales_pitch" template (dark charcoal + yellow + navy).
const PptxGenJS = require('pptxgenjs');
const IMG = __dirname + '/img/';
const C = { bg: '262626', panel: '333333', line: '4A4A4A', navy: '0C3C56', navyL: '1B5C80', yellow: 'FFD101',
  ink: 'F2F2F2', muted: 'B5B5B5', yes: '2FD394', no: 'FF6B7D', black: '0F0F0F' };
const F = { head: 'Russo One', body: 'Raleway' };
const W = 13.333, M = 0.6;

function tx(s, runs, o) { s.addText(runs, Object.assign({ fontFace: F.body, color: C.ink, valign: 'top', margin: 0 }, o)); }
function poly(s, x, y, w, h, pts, o) {
  s.addShape('custGeom', Object.assign({ x, y, w, h, points: pts.map(p => ({ x: p[0] * w, y: p[1] * h })).concat([{ close: true }]) }, o));
}
function plate(s, x, y, w, h, adj, color) { const dx = (adj * Math.min(w, h)) / w; poly(s, x, y, w, h, [[0, 1], [dx, 0], [1, 0], [1 - dx, 1]], { fill: { color } }); }
function stripes(s, x, y, w, h) {
  const bar = 0.0529, skew = 0.0723, pts = [];
  for (let i = 0; i < 7; i++) { const l = i * 0.1458; pts.push({ x: l * w, y: h, moveTo: true }, { x: (l + skew) * w, y: 0 }, { x: (l + skew + bar) * w, y: 0 }, { x: (l + bar) * w, y: h }, { close: true }); }
  s.addShape('custGeom', { x, y, w, h, fill: { color: C.yellow }, points: pts });
}
function check(s, x, y, d) { poly(s, x, y, d, d, [[0, 0.46], [0.18, 0.28], [0.38, 0.5], [0.82, 0.04], [1, 0.22], [0.38, 0.9]], { fill: { color: C.yellow } }); }
function logo(s) { tx(s, [{ text: 'POT', options: { color: C.yellow } }, { text: '  ·  powered by Panta', options: { color: C.muted, fontFace: F.body, fontSize: 11 } }], { x: M, y: 0.3, w: 5, h: 0.3, fontFace: F.head, fontSize: 14 }); }
function foot(s, n) {
  tx(s, 'Panta API Sidetrack · Colosseum Crypto World\'s Fair', { x: M, y: 7.0, w: 6, h: 0.25, fontSize: 10, color: C.muted });
  tx(s, String(n), { x: W - M - 1, y: 6.98, w: 1, h: 0.3, fontSize: 12, fontFace: F.head, color: C.muted, align: 'right' });
}
function title(s, runs, o) {
  tx(s, runs.map(r => typeof r === 'string' ? { text: r } : { text: r[0], options: { color: C.yellow } }),
    Object.assign({ x: M, y: 0.85, w: 12, h: 1.2, fontFace: F.head, fontSize: 34, color: 'FFFFFF', valign: 'top' }, o));
}
function frame(s, path, x, y, w, h) {
  s.addShape('rect', { x: x - 0.04, y: y - 0.04, w: w + 0.08, h: h + 0.08, fill: { color: C.black }, line: { color: C.line, width: 1 } });
  s.addImage({ path, x, y, w, h });
}
function base(p, n) { const s = p.addSlide(); s.background = { color: C.bg }; if (n > 1) { logo(s); foot(s, n); } return s; }

const pres = new PptxGenJS();
pres.defineLayout({ name: 'WIDE', width: W, height: 7.5 }); pres.layout = 'WIDE';
pres.author = 'Baheet Adeniji'; pres.title = 'Pot: prediction markets for your group chat';

/* 1 Title */
{ const s = base(pres, 1);
  plate(s, 8.0, 0, 1.9, 7.5, 0.9, C.yellow); plate(s, 9.15, 0, 2.6, 7.5, 0.55, C.yellow);
  poly(s, 10.9, 0, 2.433, 7.5, [[0.35, 0], [1, 0], [1, 1], [0, 1]], { fill: { color: C.navy } });
  stripes(s, M, 0.7, 1.0, 0.22);
  tx(s, 'POT', { x: M, y: 1.4, w: 7, h: 1.5, fontFace: F.head, fontSize: 96, color: C.yellow });
  tx(s, 'Prediction markets for your group chat, powered by Panta', { x: M, y: 3.05, w: 7, h: 1.2, fontFace: F.head, fontSize: 26, color: 'FFFFFF' });
  tx(s, 'Any debate in a group chat becomes a Panta market: BBNaija, elections, celebrity news, movies, music drops and streams, football. Members back a side from their phones and get a receipt when it settles.', { x: M, y: 4.3, w: 6.8, h: 1.3, fontSize: 15, color: C.ink });
  tx(s, [{ text: 'Baheet Adeniji', options: { bold: true, color: 'FFFFFF', breakLine: true } }, { text: '@pantapotbot  ·  pot-navy.vercel.app  ·  github.com/Baheet18/pot', options: { breakLine: true } }, { text: 'Panta API Sidetrack · Colosseum Crypto World\'s Fair' }], { x: M, y: 5.75, w: 7, h: 1.1, fontSize: 13, color: C.muted, paraSpaceAfter: 3 });
}

/* 2 Problem */
{ const s = base(pres, 2);
  title(s, ['Every group chat says ', ['"bet?"'], ' Then nothing happens.']);
  const qs = ['"Your fave is getting evicted this Sunday."', '"That album does 100M streams in week one."', '"Super Eagles will lose on Saturday."'];
  qs.forEach((q, i) => { const y = 2.35 + i * 1.05;
    s.addShape('roundRect', { x: M, y, w: 5.6, h: 0.8, rectRadius: 0.12, fill: { color: i === 1 ? C.navy : C.panel } });
    tx(s, q, { x: M + 0.3, y: y + 0.22, w: 5.2, h: 0.4, fontSize: 18, color: 'FFFFFF', italic: true }); });
  tx(s, 'BBNaija, elections, celebrity news, movies, music, football: nobody writes it down, agrees what counts, or holds the money.', { x: M, y: 5.6, w: 5.8, h: 0.9, fontSize: 15, color: C.muted });
  s.addShape('line', { x: 7.0, y: 2.35, w: 0, h: 4.0, line: { color: C.line, width: 1 } });
  tx(s, 'Meanwhile, on Panta', { x: 7.5, y: 2.35, w: 5.2, h: 0.4, fontFace: F.head, fontSize: 18, color: C.yellow });
  tx(s, [
    { text: 'Real markets on Solana, fair payouts, a creator\'s cut, and a clean API.', options: { breakLine: true } },
    { text: ' ', options: { breakLine: true, fontSize: 8 } },
    { text: 'But a market is only fun when your friends are on the other side, and most Panta markets have very little money in them today.', options: { breakLine: true } },
    { text: ' ', options: { breakLine: true, fontSize: 8 } },
    { text: 'The arguments live in group chats. The markets live on a website.', options: { bold: true, color: 'FFFFFF' } }],
    { x: 7.5, y: 2.95, w: 5.2, h: 3.4, fontSize: 17 });
}

/* 3 How it works: 4 steps */
{ const s = base(pres, 3);
  title(s, ['Four taps from argument to ', ['receipt']]);
  const steps = [['1', 'Make it', 'Admin types /new and the question. AI writes the YES/NO rule, sources and times (Lagos time).'],
    ['2', 'Create it', 'Admin taps Create and signs in Phantom. They become the Panta creator and earn the creator\'s cut.'],
    ['3', 'Join it', 'Members tap Buy YES or Buy NO on their phone, or buy from a Blink shared on X.'],
    ['4', 'Settle it', 'When the result is in, the bot posts a receipt: who backed which side, stake and payout.']];
  const cw = 2.85, gap = 0.2;
  steps.forEach((st, i) => { const x = M + i * (cw + gap), y = 2.5;
    s.addShape('rect', { x, y, w: cw, h: 3.6, fill: { color: i === 3 ? C.navy : C.panel } });
    s.addShape('rect', { x, y, w: cw, h: 0.08, fill: { color: C.yellow } });
    tx(s, st[0], { x: x + 0.3, y: y + 0.35, w: 1, h: 0.9, fontFace: F.head, fontSize: 48, color: C.yellow });
    tx(s, st[1], { x: x + 0.3, y: y + 1.35, w: cw - 0.5, h: 0.5, fontFace: F.head, fontSize: 20, color: 'FFFFFF' });
    tx(s, st[2], { x: x + 0.3, y: y + 1.95, w: cw - 0.5, h: 1.5, fontSize: 14 });
    if (i < 3) poly(s, x + cw + 0.03, y + 1.6, 0.14, 0.4, [[0, 0], [1, 0.5], [0, 1]], { fill: { color: C.yellow } }); });
  tx(s, 'Pot never holds keys or money. Every payment, buy and claim is signed by the user in their own wallet.', { x: M, y: 6.35, w: 12, h: 0.4, fontSize: 13, color: C.muted });
}

/* 4 AI drafting with guard rails + screenshot */
{ const s = base(pres, 4);
  title(s, ['The AI writes a ', ['fair'], ' market, and says no to bad ones'], { w: 7.2, h: 1.4, fontSize: 30 });
  const rules = [['Buying closes at kick-off', 'Checked on the server. If the start time is unknown, Pot asks.'],
    ['Personal bets get a polite no', '"Will Tolu pay me back?" can\'t be settled by a public source, so Pot suggests one that can.'],
    ['Big questions get split', '"Who wins BBNaija?" becomes a few YES/NO markets the admin picks, because Panta markets are binary.']];
  rules.forEach((r, i) => { const y = 2.6 + i * 1.3;
    check(s, M, y + 0.05, 0.32);
    tx(s, r[0], { x: M + 0.55, y, w: 6.3, h: 0.4, fontFace: F.head, fontSize: 18, color: 'FFFFFF' });
    tx(s, r[1], { x: M + 0.55, y: y + 0.45, w: 6.3, h: 0.7, fontSize: 14 }); });
  const h = 5.5, w = h * 480 / 603; frame(s, IMG + 'draft.png', 12.73 - w, 0.95, w, h);
  tx(s, 'A /new draft in Telegram (practice mode)', { x: 12.73 - w, y: 6.55, w, h: 0.3, fontSize: 11, color: C.muted, align: 'center' });
}

/* 5 Buy from anywhere: Blink + Phantom */
{ const s = base(pres, 5);
  title(s, ['Buy from the chat, the website, or ', ['a post on X']], { w: 6.6, h: 1.4, fontSize: 30 });
  tx(s, [
    { text: 'Phantom on the web page. ', options: { bold: true, color: 'FFFFFF' } }, { text: 'Tap YES or NO, pick $2, $5, $10 or any amount, sign. "Open in Phantom" on mobile.', options: { breakLine: true } },
    { text: ' ', options: { breakLine: true, fontSize: 8 } },
    { text: 'A Blink on X. ', options: { bold: true, color: 'FFFFFF' } }, { text: 'Share the market link and Phantom or Backpack users see buy buttons right inside the post. Pot serves its own Solana Actions.', options: { breakLine: true } },
    { text: ' ', options: { breakLine: true, fontSize: 8 } },
    { text: 'Credit for bringing people. ', options: { bold: true, color: 'FFFFFF' } }, { text: 'Every buy carries the group\'s or member\'s link, which feeds the /top leaderboard.' }],
    { x: M, y: 2.35, w: 6.3, h: 2.4, fontSize: 15 });
  const bw = 6.3, bh = bw * 320 / 1026; frame(s, IMG + 'buy.png', M, 4.85, bw, bh);
  const h = 5.75, w = h * 780 / 1540; frame(s, IMG + 'blink.png', 12.73 - w, 0.95, w, h);
  tx(s, 'Blink preview (practice market, demo data)', { x: 12.73 - w - 0.5, y: 6.75, w: w + 0.5, h: 0.25, fontSize: 10, color: C.muted, align: 'center' });
}

/* 6 The receipt */
{ const s = base(pres, 6);
  const h = 5.9, w = h * 940 / 1216; frame(s, IMG + 'receipt.png', M, 0.95, w, h);
  const x = M + w + 0.7, tw = 12.73 - x;
  stripes(s, x, 1.05, 0.9, 0.2);
  tx(s, [{ text: 'The receipt is ' }, { text: 'the product', options: { color: C.yellow } }], { x, y: 1.45, w: tw, h: 1.2, fontFace: F.head, fontSize: 34, color: 'FFFFFF' });
  tx(s, 'When a market settles, Pot posts one receipt in the group: the result, the final pot, the creator\'s cut, and every member\'s side, stake and payout.', { x, y: 2.75, w: tw, h: 1.2, fontSize: 16 });
  const pts = ['It turns "I told you so" into proof people screenshot.', 'Payout maths follows Panta\'s rules, marked "approx" until Panta\'s 1-hour dispute window ends.', 'One-sided markets get honest wording: nobody won or lost.'];
  pts.forEach((t, i) => { const y = 4.15 + i * 0.75; check(s, x, y + 0.04, 0.26); tx(s, t, { x: x + 0.45, y, w: tw - 0.45, h: 0.7, fontSize: 14 }); });
  tx(s, 'Demo receipt from Pot\'s test group (practice money).', { x, y: 6.5, w: tw, h: 0.3, fontSize: 10, color: C.muted });
}

/* 7 Integration depth: every Panta API feature and where Pot uses it */
{ const s = base(pres, 7);
  title(s, ['Every Panta API feature, and ', ['where Pot uses it']], { fontSize: 30 });
  tx(s, '15', { x: M, y: 2.1, w: 3.0, h: 1.7, fontFace: F.head, fontSize: 110, color: C.yellow });
  tx(s, 'Panta endpoints, from making a market to claiming the creator\'s cut', { x: M, y: 3.9, w: 3.1, h: 1.0, fontSize: 14 });
  tx(s, 'Checked read-only against the live API (scripts/live-probe.mts). Full flow runs end to end in the sandbox (scripts/sandbox-e2e.ts). 177 automated tests.', { x: M, y: 5.0, w: 3.1, h: 1.6, fontSize: 12, color: C.muted });
  const rows = [['Panta feature', 'Endpoints', 'Where Pot uses it'],
    ['Market data', 'GET /markets/ · /markets/{id}/ · /markets/{id}/trades/', 'Live cards in chat (/panta), home page, market page, receipts'],
    ['Positions', 'GET /positions/ · /wallets/{w}/trades/', '/mine, claim links, "first-ever Panta trade"'],
    ['Primary buys', 'primaryorderquote → build → submit → verify', 'Buy YES/NO on the web page and in Blinks on X'],
    ['Attribution', 'POST /trades/ (userId)', 'Credit to the group and member link, /top'],
    ['Market creation', 'markets/create/quote → build → register', 'Admin taps Create; fee checked against $20 / $50'],
    ['Claims', 'claim/build · claim/creator-fees/build', 'Winnings and the community owner\'s creator cut']];
  const tbl = rows.map((r, i) => r.map((t, j) => ({ text: t, options: i === 0
    ? { bold: true, color: C.bg, fill: { color: C.yellow }, fontFace: F.head, fontSize: 12, valign: 'middle' }
    : { color: j === 0 ? 'FFFFFF' : C.ink, bold: j === 0, fill: { color: i % 2 ? C.bg : C.panel }, fontSize: 11, valign: 'middle', fontFace: F.body } })));
  s.addTable(tbl, { x: 3.95, y: 2.1, w: 8.78, colW: [1.7, 3.5, 3.58], rowH: 0.6, border: { type: 'solid', pt: 1, color: C.line }, margin: 0.08 });
}

/* 8 Distribution layer diagram */
{ const s = base(pres, 8);
  title(s, ['Every Telegram group becomes a ', ['Panta venue']]);
  const groups = ['BBNaija and reality-TV fans', 'Music and movie stans', 'Football and politics chats', 'Influencer communities'];
  groups.forEach((g, i) => { const y = 2.35 + i * 0.95;
    s.addShape('roundRect', { x: M, y, w: 3.4, h: 0.75, rectRadius: 0.1, fill: { color: i === 3 ? C.navy : C.panel } });
    tx(s, g, { x: M + 0.25, y: y + 0.22, w: 3.0, h: 0.35, fontSize: 15, color: 'FFFFFF', bold: i === 3 }); });
  s.addShape('line', { x: 4.15, y: 4.0, w: 0.8, h: 0, line: { color: C.yellow, width: 3, endArrowType: 'triangle' } });
  s.addShape('roundRect', { x: 5.05, y: 3.05, w: 2.3, h: 1.9, rectRadius: 0.15, fill: { color: C.yellow } });
  tx(s, 'POT', { x: 5.05, y: 3.35, w: 2.3, h: 0.7, fontFace: F.head, fontSize: 32, color: C.bg, align: 'center' });
  tx(s, 'bot + website + Blinks', { x: 5.05, y: 4.1, w: 2.3, h: 0.4, fontSize: 12, color: C.bg, align: 'center', bold: true });
  s.addShape('line', { x: 7.45, y: 4.0, w: 0.8, h: 0, line: { color: C.yellow, width: 3, endArrowType: 'triangle' } });
  s.addShape('roundRect', { x: 8.35, y: 3.05, w: 1.9, h: 1.9, rectRadius: 0.15, fill: { color: C.navy } });
  tx(s, 'PANTA', { x: 8.35, y: 3.5, w: 1.9, h: 0.6, fontFace: F.head, fontSize: 22, color: 'FFFFFF', align: 'center' });
  tx(s, 'markets on Solana', { x: 8.35, y: 4.1, w: 1.9, h: 0.4, fontSize: 11, color: C.ink, align: 'center' });
  const gains = [['Community owner', 'earns the creator\'s cut on every market'], ['Members', 'play with friends, from their phones'], ['Panta', 'new people, local markets, real volume']];
  gains.forEach((g, i) => { const y = 2.45 + i * 1.25;
    tx(s, g[0], { x: 10.6, y, w: 2.2, h: 0.35, fontFace: F.head, fontSize: 14, color: C.yellow });
    tx(s, g[1], { x: 10.6, y: y + 0.38, w: 2.2, h: 0.75, fontSize: 13 }); });
  tx(s, 'Pot gives Panta distribution: it brings people to Panta from the chats where the debates already happen. Community owners earn the creator\'s cut.', { x: M, y: 6.35, w: 12, h: 0.4, fontSize: 14, color: C.muted });
}

/* 9 Honest status + traction placeholders */
{ const s = base(pres, 9);
  title(s, ['An honest sandbox submission. ', ['Live is one switch away.']], { fontSize: 28 });
  const hdr = (t) => ({ text: t, options: { bold: true, color: C.bg, fill: { color: C.yellow }, fontFace: F.head, fontSize: 14, valign: 'middle' } });
  const cell = (t, i, o) => ({ text: t, options: Object.assign({ color: C.ink, fill: { color: i % 2 ? C.bg : C.panel }, fontSize: 12, fontFace: F.body, valign: 'middle' }, o || {}) });
  const rows = [['', 'Practice (running now)', 'Live (built, switched off)'],
    ['Money', 'None. Wallets sign a free message', 'Real USDC on Solana'],
    ['Markets', 'Tracked by Pot with Panta\'s payout rules', 'Created on Panta by the admin'],
    ['Result', 'Group admin runs /settle yes|no', 'Panta\'s own result, then receipt'],
    ['Panta data', 'Real live Panta markets and prices in the chat (/panta)', 'Same, plus buys on them'],
    ['Checked', 'Sandbox end-to-end script; real groups and phones', 'Read-only live probe (live-probe.mts)']];
  s.addTable(rows.map((r, i) => i === 0 ? r.map(hdr) : r.map((t, j) => cell(t, i, j === 0 ? { bold: true, color: 'FFFFFF' } : {}))),
    { x: M, y: 2.3, w: 7.4, colW: [1.3, 3.05, 3.05], rowH: 0.56, border: { type: 'solid', pt: 1, color: C.line }, margin: 0.1 });
  tx(s, 'One switch: scripts/go-live.sh (GO-LIVE.md) · back: scripts/rollback-to-practice.sh. The demo video shows the live flow at launch.', { x: M, y: 5.85, w: 7.4, h: 0.5, fontSize: 12, color: C.muted });
  const tx0 = 8.6, tw = 4.13;
  s.addShape('rect', { x: tx0, y: 2.3, w: tw, h: 4.25, fill: { color: C.navy } });
  tx(s, 'Practice run with a real community', { x: tx0 + 0.3, y: 2.5, w: tw - 0.6, h: 0.7, fontFace: F.head, fontSize: 16, color: C.yellow });
  const stats = [['[N]', 'practice markets'], ['[N]', 'people who bought'], ['[N]', 'buys from a shared link or Blink'], ['[N]', 'receipts posted']];
  stats.forEach((st, i) => { const y = 3.3 + i * 0.72;
    tx(s, st[0], { x: tx0 + 0.3, y, w: 1.1, h: 0.55, fontFace: F.head, fontSize: 24, color: 'FFFFFF' });
    tx(s, st[1], { x: tx0 + 1.45, y: y + 0.1, w: tw - 1.7, h: 0.5, fontSize: 13 }); });
  tx(s, '[GROUP NAME], [MEMBERS] members. Replace before submitting.', { x: tx0 + 0.3, y: 6.05, w: tw - 0.6, h: 0.42, fontSize: 10, color: C.muted, italic: true });
}

/* 10 What's next + links */
{ const s = base(pres, 10);
  plate(s, 10.6, 0, 1.2, 7.5, 0.9, C.yellow);
  poly(s, 11.45, 0, 1.883, 7.5, [[0.4, 0], [1, 0], [1, 1], [0, 1]], { fill: { color: C.navy } });
  title(s, ['What\'s ', ['next']], { w: 9 });
  const nx = ['Go live in one group: the ~$21 smoke test in GO-LIVE.md, then one real market.', 'Bring in 2-3 Nigerian football and crypto communities, then influencer communities.', 'Faster receipts, one-tap match-day markets, and an owner dashboard.', 'WhatsApp communities and Discord servers next. The core isn\'t tied to Telegram.'];
  nx.forEach((t, i) => { const y = 2.0 + i * 0.82;
    tx(s, String(i + 1), { x: M, y, w: 0.5, h: 0.5, fontFace: F.head, fontSize: 24, color: C.yellow });
    tx(s, t, { x: M + 0.6, y: y + 0.06, w: 8.8, h: 0.7, fontSize: 16 }); });
  s.addShape('line', { x: M, y: 5.45, w: 9.4, h: 0, line: { color: C.line, width: 1 } });
  tx(s, [{ text: 'Try it: ', options: { color: C.yellow, fontFace: F.head } }, { text: '@pantapotbot on Telegram  ·  pot-navy.vercel.app  ·  github.com/Baheet18/pot' }], { x: M, y: 5.7, w: 9.6, h: 0.4, fontSize: 16, color: 'FFFFFF' });
  tx(s, 'Not financial advice. Payouts shown are estimates. Powered by Panta.', { x: M, y: 6.25, w: 9.4, h: 0.3, fontSize: 11, color: C.muted });
}

pres.writeFile({ fileName: __dirname + '/pot-pitch-deck.pptx' }).then(f => console.log('wrote', f));
