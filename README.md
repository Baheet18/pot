# 🍯 Pot: prediction markets for your group chat, powered by Panta

**Live (sandbox / test mode):** https://pot-navy.vercel.app · **Telegram:** [@pantapotbot](https://t.me/pantapotbot)

Pot turns a Telegram group into a prediction-market crew on [Panta](https://www.panta.market/):

1. **Make it:** a group admin types `/new Will Super Eagles beat Ghana Sat 8pm?`. The bot drafts a fair market: a clear YES/NO rule, official sources, and times in WAT (Lagos time), plus breaking ($20) vs standard ($50) type.
2. **Create it:** the admin taps **✅ Create**, opens the signed link, and signs/pays the Panta fee in **their own wallet** (Phantom). They become the creator and earn the creator royalty. The bot posts the market card in the group.
3. **Join it:** members tap **Buy YES / Buy NO** and sign in Phantom, or share the market as a **Solana Blink** on X. Every buy is credited to the group and to the member whose link was used (`/top` leaderboard). The bot posts each buy, then "buying closed" and the result, with claim links.
4. **Settle it:** when the market resolves, the bot posts a **receipt** in the group: the question, the result, the final pot, and every member who bought (Telegram name), their side, stake and payout or loss. Live markets settle from Panta (the cron polls market status); practice markets are settled by a group admin with `/settle yes|no`. One receipt per market per group. The market page shows the settled result and the same receipt.

   Payout math follows Panta's parimutuel rules: winners split the pot minus the creator royalty (20%, cut to 10/5/0% when 90%+ of traders pick one side), pro rata by shares; live buys also pay Panta's 2% trading fee. Receipts mark numbers "≈ approx" because Panta sets final payouts after its 1-hour dispute window.

**Drafting rules:** for matches and events, buying closes at kick-off (checked on the server; if the start time is unknown the bot asks for it). Personal bets that no public source can settle ("will Tolu pay me back?") are politely refused with a suggestion. Multi-outcome questions ("who wins BBNaija?") are offered as a few YES/NO markets for the top named options (the admin picks), or one rephrased YES/NO question, because Panta markets are binary.

Pot never holds anyone's keys or money: every payment, buy and claim is signed by the user in their own wallet.

## What's in the box
| Part | What it does |
|---|---|
| **Telegram bot** (`apps/bot`, grammY) | `/new` `/markets` `/post` `/market` `/share` `/top` `/mine` `/link` `/admin` `/settle` (practice) `/help`; buy alerts; buying-closed posts and settlement receipts. Runs as a **webhook** on the Vercel app (`/api/telegram/webhook`, checked with Telegram's `secret_token`), or with long polling locally. |
| **Website** (`apps/web`, Next.js 16) | Landing + open markets, `/m/[id]` market page (split, pot, Phantom buy, settled result + receipt, share as Blink, "Open in Phantom" on mobile), `/create/[draftId]`, `/claim/[id]`, `/link` (free signed message links a wallet to Telegram), `/leaderboard` |
| **Blinks / Solana Actions** | `/actions.json`, `GET/POST /api/actions/m/[id]` (YES/NO $2/$5/$10 + custom amount), chained `POST /api/actions/m/[id]/next` that confirms with Panta and records the buy. CORS + `X-Action-Version` / `X-Blockchain-Ids` headers. |
| **Core logic** (`packages/core`) | Payout + creator-royalty estimates, settlement receipts, market drafting (chrono-node, WAT), Telegram card renderer, Actions payloads, referral refs |
| **Server** (`packages/server`) | Panta API client (rate limiter, cache, write allowlist, live-write guard), Postgres/SQLite store, HMAC-signed links and refs, buy/create/claim/link flows |

## Panta API endpoints used (`https://live-api.panta.market/api/v1`)
**Read:** `GET /markets/` · `GET /markets/{id}/` · `GET /markets/{id}/trades/` · `GET /positions/?wallet=` · `GET /wallets/{wallet}/trades/` · `GET /trades/{signature}/`

**Buy (user signs):** `POST /primaryorderquote/` → `POST /primaryorderbuild/` → wallet signs + broadcasts → `POST /primaryordersubmit/` → `POST /primaryorderverify/` → `POST /trades/` (attribution, with `userId` / `X-User-Id` = the group or member ref)

**Create (admin signs + pays):** `POST /markets/create/quote/` → `POST /markets/create/build/` → wallet signs → `POST /markets/register/`

**Claims:** `POST /claim/build/` (winnings) · `POST /claim/creator-fees/build/` (creator royalty) → `POST /trades/` report

Only these POST paths can be called at all (allowlist), and **with the live key every write is blocked** unless `POT_ALLOW_LIVE_WRITES=1` is set.

## Modes
* `PANTA_MODE=test` (default, and what the public deployment runs today): uses a `pk_test` key. Panta answers with **sandbox fixtures** (one test market, canned quote/build/verify; nothing touches mainnet). Because the sandbox returns no instructions, Pot swaps in a **free Solana devnet memo transaction**, so the real wallet sign → broadcast → submit path still runs. A "Simulate" button (`sandbox_…` signature) covers when devnet is busy.
* `PANTA_MODE=live`: real mainnet markets with the live key. Writes still need `POT_ALLOW_LIVE_WRITES=1`.

## Run it locally
```bash
npm install
npm test                  # 59 tests: core, server (sandbox fixtures, fetch mocked), bot (fake Telegram updates)
npm run typecheck
npm run dev:web           # http://localhost:3100
npm run dev:bot           # long polling (refuses to start while the hosted webhook is active)
npx tsx scripts/sandbox-e2e.ts   # Blink GET→POST→sign→next, web buy with group ref, create, wallet link, leaderboard
npm run build
```

### Secrets: never in the repo
Read at runtime only, from chmod-600 files locally or from Vercel **Secret** env vars when hosted:

| Local file | Vercel env var | Purpose |
|---|---|---|
| `~/.panta/test_key` | `POT_PANTA_TEST_KEY` | Panta `pk_test` key |
| `~/.panta/api_key` | `POT_PANTA_LIVE_KEY` | Panta `pk_live` key (not set on the deployment yet) |
| `~/.pot/telegram_token` | `POT_TELEGRAM_TOKEN` | Bot token |
| `~/.pot/hmac_secret` | `POT_HMAC_SECRET` | Signs create/link tokens and group refs |
| `~/.pot/webhook_secret` | `POT_TELEGRAM_WEBHOOK_SECRET` | Telegram webhook `secret_token` |
| – | `CRON_SECRET` | Protects the daily `/api/cron/settle` job |
| – | `DATABASE_URL` | Hosted Postgres (Neon via Vercel Marketplace). Without it, SQLite is used. |

`python3 scripts/secret-scan.py .` checks source, build output and data for any of these values.

### Deploying (Vercel)
Project root directory `apps/web` (npm workspaces install from the repo root, see `apps/web/vercel.json`). Set the env vars above, then point Telegram at the app: `python3 scripts/set-webhook.py https://<your-domain>/api/telegram/webhook`.

---
Built for the Panta bounty. **Powered by [Panta](https://www.panta.market/).** Not financial advice; payouts shown are estimates.
