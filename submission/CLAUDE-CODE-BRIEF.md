# Pot: review brief for Claude Code

## What this is
Pot is a hackathon entry for the **Panta API Sidetrack** (Colosseum Crypto World's Fair).
- **Prize:** $5,000 USDG in total.
- **Deadline:** Tue Oct 13 2026, 07:59 WAT.
- **Judging:** depth of Panta integration, execution, UX, originality, impact and traction.

Pot is a Telegram bot ([@pantapotbot](https://t.me/pantapotbot)) plus a website (https://pot-navy.vercel.app). It turns group-chat arguments into Panta prediction markets. Panta runs on Solana mainnet with USDC: binary YES/NO markets, a buy-only first phase, then graduation to an order book. Payouts are parimutuel, so winners split the pot.

- **Repo:** https://github.com/Baheet18/pot, a Next.js + TypeScript monorepo, deployed on Vercel. The database is Neon Postgres.
- **Pitch angle:** any Telegram community, including influencer communities, becomes a Panta venue. Members back their convictions, and the community owner earns Panta's creator's cut. That gives Panta distribution.

## Core flow
1. The admin runs `/new <question>`. Gemini drafts a market (falling back to a rule-based drafter) with:
   - kick-off-aware closing, so buying closes at the event start;
   - a polite refusal for personal bets that can't be settled;
   - multi-outcome questions split into one YES/NO market per option;
   - clarifying questions when a request is vague.
2. The admin edits the draft with `/edit` or a reply in plain words, then creates it. Creation costs $20 for a breaking market or $50 for a standard one.
3. Members buy YES/NO from their phones in Phantom, or from an X share link or Blink (`/m/<id>?ref=…`, `/blink/<id>`, `actions.json`), with referral credit.
4. When the market settles, the bot posts a receipt in the group: who was on each side, their stake, and their payout or loss.
   - In practice mode the admin settles with `/settle`.
   - Live markets settle by cron, after Panta's 1-hour dispute window.
   - One-sided markets follow Panta's rules: there is no refund, so the receipt says "no losing side".
5. Other commands are `/markets`, `/share`, `/top`, `/link` (a free wallet signature), `/mine` and `/admin`, and the bot posts buy alerts.

## Current mode (important)
- `PANTA_MODE=test`, which uses Panta's test key and sandbox. Practice markets live in Pot's own database (`practicemarket.ts`) and use Panta's payout maths. Nothing touches the chain.
- Live mode is built but switched off: `scripts/go-live.sh` and `scripts/rollback-to-practice.sh`, documented in `GO-LIVE.md`. Its request shapes were checked against Panta's live API with read-only calls only.
- The author has chosen **not to use real money**, so the submission is a working prototype in practice mode.

## Panta API facts
- **Basics:** base URL `https://live-api.panta.market/api/v1`, auth header `X-Api-Key`, and requests need a browser-like User-Agent because of Cloudflare.
- **Fees:**
  - The trading fee is 2% in the primary phase and 1.5% after.
  - The creator royalty is up to 20%. It's cut when about 90% or more of traders are on one side, and drops to 0% at 96% or more.
- **Limits:**
  - There is no sell endpoint and no price history.
  - Attribution (`userId`) is credit only.
  - A "Powered by Panta" badge is required.

## Competitors in the same track
- **PantaChat** by @Bobotrades0: a Telegram/Discord bot where you reply `/market`. It has AI drafting, non-custodial signing, buy buttons in the chat and claim links, and its post says it ran on Devnet. It's very close to Pot.
- **Panta Rooms** by @__cryptowizard: a website with a room per market, showing a live trade feed next to a live debate.
- **Pot's intended differences:**
  - group settlement receipts;
  - closing buying at kick-off;
  - refusing personal bets;
  - splitting questions with several outcomes;
  - X/Blink sharing with referral credit;
  - a focus on communities and creators;
  - clean resolution rules and sources (the author used to write market rules at Trepa).

## Known issues and open items
- The README is out of date: it says 59 tests, but there are 153 now, and its mode wording is old.
- Some screenshots in `shots/` still show the removed "verdict" badge (Ordinary/Thin) and demo wallet counts.
- The "Rephrase as one YES/NO" button sometimes doesn't show on split questions. For BBNaija, the bot could offer the current housemates as buttons.
- Buyers who bought on the website and never linked a wallet show as a short wallet address.
- Vercel's free cron runs daily, so live receipts depend on activity or an external pinger.
- Pot passes Panta's transaction instructions to the wallet without inspecting them.
- The AI once invented a fixture, so drafts with dates need checking.
- The `submission/` folder (deck, script, write-up) isn't committed.

## What I'd like reviewed
1. Correctness and security, especially the live payment paths, the webhook secret, the operator/test routes and any secret leakage.
2. Payout and receipt maths against Panta's rules.
3. UX gaps in the Telegram flow and the market pages.
4. What would most improve the score on each judging criterion in the 3 days left, and how to stand out against PantaChat.
5. Code quality, test coverage and dead code left over from the removed verdict feature.

Don't print or commit secrets. Keys live outside the repo, in Vercel env and `~/.panta`/`~/.pot` on the dev box. Don't switch on live mode or send any transactions.
