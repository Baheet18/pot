# Pot: prediction markets for your group chat, powered by Panta

**Code:** https://github.com/Baheet18/pot · **Website:** https://pot-navy.vercel.app · **Telegram:** [@pantapotbot](https://t.me/pantapotbot) · **Demo:** [LOOM LINK HERE]

Built by Baheet Adeniji for the Panta API Sidetrack, Colosseum Crypto World's Fair.

> **In one line:** any debate in a group chat becomes a Panta market (BBNaija evictions, elections, celebrity news, movies, music releases and streams, football), Pot gives Panta distribution into those chats, and the community owner earns the creator's cut.
>
> **Honest status:** this is a sandbox submission. Buying runs in practice mode (no real money). Pot already shows **real, live Panta markets and prices** in the chat, every live call has been checked read-only, the full flow runs end to end in Panta's sandbox, and live mode is one switch away ([`GO-LIVE.md`](https://github.com/Baheet18/pot/blob/main/GO-LIVE.md)). The demo video shows the live flow at launch.

---

## The problem

Every group chat already runs prediction markets. They just don't have a place to put them.

"Your fave is getting evicted on Sunday." "That album does 100M streams in week one." "Obi joins ADC before the year ends." "Super Eagles will lose." Someone says it, five people disagree, and someone says "bet?" Then nothing happens. Nobody writes the bet down, nobody agrees on what counts as a win, nobody holds the money, and a week later nobody remembers who said what.

Panta has the hard parts: real markets on Solana, a fair payout rule, a creator's cut for whoever makes the market, and a clean API. What it needs is people in the markets. A market is only fun when your friends are on the other side, and most of Panta's markets today have very little money in them.

So there's a gap. The arguments live in group chats. The markets live on a website. Pot connects the two.

## The solution

Pot is a Telegram bot ([@pantapotbot](https://t.me/pantapotbot)) and a website (https://pot-navy.vercel.app) that turns a group chat's arguments into Panta markets.

1. **Make it.** A group admin types `/new Will Man United beat Spurs on Saturday?`. Pot's AI writes the market: a clear YES/NO question, the rule for what counts, the sources that settle it, and the times in Lagos time.
2. **Create it.** The admin taps **Create** and signs in their own Phantom wallet. They become the market's creator on Panta, so they earn the creator's cut. The bot posts the market card in the group.
3. **Join it.** Members tap **Buy YES** or **Buy NO** and sign from their phone. Anyone can share the market on X as a Blink (a post with buy buttons in it). Each buy is credited to the group and to the member whose link was used.
4. **Settle it.** When the result is in, the bot posts a receipt in the group: the result, the final pot, and every member who joined, with their side, their stake, and what they got back.

That receipt is the point. It's the thing people screenshot. It turns "I told you so" into proof, and it makes the next market easier to fill.

### Who earns what
- **The person who makes the market** earns Panta's creator's cut: 20% of the pot, dropping to 10%, 5% or 0% when almost everyone picks the same side (Panta's rule). Pot shows a running estimate in `/admin`.
- **Winners** split the rest of the pot, by shares.
- **Panta** gets real trades from people who would never have found a market on their own.
- **Pot** never holds anyone's keys or money. Every payment, buy and claim is signed by the user in their own wallet.

## Pot as a distribution layer for Panta

The bigger idea: **every Telegram group can become a Panta venue.**

Any debate can become a market: BBNaija and reality-TV evictions, elections and politics, celebrity news, movie box office, music releases and streaming numbers, football. So any community can host them: a BBNaija fan group, a music stan chat, a football group, a politics chat, a campus group, a fantasy league. Most of all, an influencer's community: a creator with 20,000 people in a Telegram channel and a group can run a market every match day, share it on X as a Blink, and earn the creator's cut on every one.

For Panta, that means:
- **New people.** Each group brings its own members. Pot marks buys that are someone's first-ever Panta trade.
- **New markets that people actually care about.** Local football, Nigerian politics, campus elections, the questions a global site would never list.
- **Volume that comes with the market.** A market made in a group starts with a crowd that already disagrees.
- **A reason for community owners to keep doing it.** The creator's cut pays the group owner, not a middleman.

Pot doesn't compete with Panta's website. It brings people to Panta's markets from the places they already spend time.

## Every Panta API feature, and where Pot uses it

All calls go from Pot's server to `https://live-api.panta.market/api/v1`; the API key never reaches the browser or the bot chat.

| Panta feature | Endpoints | Where Pot uses it |
|---|---|---|
| Market data | `GET /markets/` · `GET /markets/{id}/` · `GET /markets/{id}/trades/` | **Live Panta markets in the chat (`/panta`)** and on the home page; market cards and pages; Blinks; the YES/NO split; receipts; settlement checks |
| Positions | `GET /positions/?wallet=` · `GET /wallets/{wallet}/trades/` | `/mine`, claim links, spotting a wallet's first-ever Panta trade |
| Primary-market buys | `POST /primaryorderquote/` → `/primaryorderbuild/` → wallet signs → `/primaryordersubmit/` → `/primaryorderverify/` | Buy YES / Buy NO on the market page and in Blinks on X |
| Attribution (referrals) | `POST /trades/` with `userId` / `X-User-Id` | Credits each buy to the group's card or the member's share link; powers `/top` |
| Market creation | `POST /markets/create/quote/` → `/markets/create/build/` → admin signs and pays → `/markets/register/` | Admin taps Create on a `/new` draft and becomes the Panta creator (fee checked against $20 breaking / $50 standard) |
| Claims | `POST /claim/build/` · `POST /claim/creator-fees/build/` | Winners' claim links; the community owner claims the creator's cut |
| Payout rules (how-it-works) | Pool rule, royalty curve (20% → 10% → 5% → 0%), 2% fee, 1-hour dispute window | Payout estimates, `/admin` royalty estimate, receipts |

That's 15 endpoints across the whole life of a market. A few things Pot does on top:
- **Follows Panta's rules exactly.** Payout estimates use Panta's pool rule, including the creator's cut dropping when one side is crowded, the 2% trading fee on live buys, and the fact that one-sided markets don't get refunds. Receipts say "approx" because Panta sets final payouts after its 1-hour dispute window.
- **Checks Panta's numbers before asking anyone to sign.** If Panta quotes a creation fee other than the expected $20 (breaking) or $50 (standard), Pot stops. It also checks the buyer has enough USDC and SOL first, and says what's missing in plain words.
- **Turns Panta's error codes into plain sentences.** For example, `NOT_CLAIMABLE` and `DUPLICATE_MARKET` get a human explanation.
- **Shows live Panta markets in practice mode, read-only.** A separate read-only key (`PANTA_READ_KEY`) can only send GETs; it is not the live-write key, and the live-write lock stays off.
- **Is a polite API client.** Reads are rate-limited under Panta's limit and cached. Only the POST paths above can be called at all, and with a live key every write is blocked unless a second switch is turned on.
- **Uses Panta's referral field.** Every buy through a group's card or a member's Blink link carries that group's or member's ref, which powers the `/top` leaderboard.

## Live Panta data, now in the chat

Even in practice mode, groups see the real thing:
- **`/panta`** lists Panta's open live markets with their real YES/NO prices, pot and closing time (in Lagos time). Markets still in their buying window come first.
- Each one is a card labelled **🔴 Live on Panta** with a **Trade on Panta ↗** button that opens the market on panta.market. An admin can tap **📌 Post in this group** (or `/post <marketId>`) to pin it in the group.
- Pot takes no buys on these cards while it's in practice mode, and says so on the card. Members trade on Panta, or make a free practice market with `/new`.
- The home page at https://pot-navy.vercel.app shows the same **Live on Panta** list.
- When Panta has few or no open markets, the bot and the website say so plainly and point to panta.market and `/new`.

## The UX

Pot is built for a phone in a busy group chat.

- **No new app.** Everything starts in Telegram. The website opens from a button.
- **The AI does the boring part.** `/new` writes the rule, the sources and the dates. The admin reads one message and taps Create, or replies with a fix (`/edit`).
- **It doesn't let a bad market through:**
  - **Buying closes at kick-off.** For a match or event, buying ends when it starts, checked on the server. If Pot can't find the start time, it asks.
  - **Personal bets get a polite no.** "Will Tolu pay me back?" can't be settled by any public source, so Pot says no and suggests a question that can be.
  - **Big questions get split.** Panta markets are YES/NO, so "Who wins BBNaija?" becomes a few YES/NO markets for the top names (the admin picks), or one reworded question.
- **Buying works from anywhere.** Phantom on the website (with "Open in Phantom" on mobile), or a Blink on X with $2 / $5 / $10 buttons and a custom amount.
- **Clear money words.** Every screen says what you pay, what you'd get if you're right, and when buying closes. Errors read like "You cancelled in your wallet. Nothing was sent or charged."
- **Credit where it's due.** `/link` connects your wallet to your Telegram name with a free signed message, so website and Blink buys show your name on the receipt. `/mine` shows your positions privately in DM. `/top` and the website leaderboard show who brings the most buyers.
- **The receipt.** One message per market, posted in the group: result, final pot, the creator's cut, and every member's side, stake and payout. One-sided markets get their own wording, because nobody really won or lost.

## An honest sandbox submission: practice mode vs live mode

**Pot runs in practice mode today. No real money moves.** I chose not to put real money in for this hackathon.

What that means in plain terms:
- **Practice mode** uses Panta's test API key. Markets a group makes in practice mode are practice markets: Pot keeps track of their pot using Panta's payout rules, wallets sign a free message instead of a payment, and a group admin settles them with `/settle yes` or `/settle no` after the event (practice markets have no automatic result). The bot, the website, the Blinks, the leaderboard, `/mine`, `/link` and the receipts all work for real people, in real groups, on real phones. Every practice screen is clearly labelled "practice, no real money".
- **Live mode is fully built.** It runs the real Panta flows listed above with the live key: real market creation, real buys, settlement from Panta's own result, and claims. It turns on with one command (`scripts/go-live.sh`) and turns off with another (`scripts/rollback-to-practice.sh`). Two separate switches must both be on before any real-money call can reach Panta.
- **How it's been checked.** `scripts/sandbox-e2e.ts` runs the whole flow end to end against Panta's sandbox (draft → create → buys → settle → receipt). `scripts/live-probe.mts` makes read-only calls to Panta's live API, with nothing signed or sent, and confirms: buy quotes and builds (including the 2% fee), market-creation quotes and builds ($20 = 20,000,000 base units, of which $5 goes into the market), market lists, details and trades, and the error codes.
- **What can only be checked with real money:** signing and sending on mainnet, Panta's submit → verify → confirmed sequence, buy credit through `/trades/`, registering a real market, real settlement timing and the dispute window, and claims. The full go-live checklist and a ~$21 smoke test are in [`GO-LIVE.md`](https://github.com/Baheet18/pot/blob/main/GO-LIVE.md).
- **Live mode is one switch away.** `scripts/go-live.sh` sets the live env vars on Vercel and redeploys; `scripts/rollback-to-practice.sh` undoes it. `/api/pot/ready` reports whether every go-live setting is in place, without showing any secret.
- **The demo video shows the live flow at launch**: a real market created, bought and settled with real USDC once Pot is switched on. [LOOM LINK HERE]

## Traction (practice mode)

I'm not claiming volume I don't have. Instead, I'm running practice markets with real people in a real community group during the judging week:

| | |
|---|---|
| Community group | [GROUP NAME], [MEMBER COUNT] members |
| Practice markets run | [NUMBER] |
| People who bought at least once | [NUMBER] |
| People who linked a wallet (`/link`) | [NUMBER] |
| Buys that came through a shared link or Blink | [NUMBER] |
| Receipts posted | [NUMBER] |
| What testers said | "[QUOTE]" ([NAME]) |

[REPLACE WITH REAL NUMBERS FROM THE PRACTICE RUN. DELETE ANY ROW YOU CAN'T FILL HONESTLY.]

## What's next

1. **Go live in one group.** Fund one creator wallet and run the ~$21 smoke test from `GO-LIVE.md`, then run one real market in the test community.
2. **Onboard community owners.** Start with two or three Nigerian football and crypto Telegram communities, then influencer communities, where the owner makes the markets and earns the creator's cut.
3. **Faster receipts.** Today a quiet group can wait for the daily check; an outside pinger every 10 minutes fixes that.
4. **Match-day templates.** One tap to make a market for each of this weekend's big games.
5. **Owner dashboard on the website.** The creator's cut earned, buyers per market, and best-performing markets, for each group.
6. **More chat apps.** The core logic isn't tied to Telegram, so WhatsApp communities and Discord servers are next.

## How it's built (short version)

- **Telegram bot:** grammY, running as a webhook on the Vercel app.
- **Website:** Next.js, with the market page, create page, claim page, wallet link page and leaderboard.
- **Blinks:** Pot serves its own Solana Actions (`/actions.json` and `/api/actions/m/[id]`), so a market link on X shows buy buttons in Phantom or Backpack.
- **AI drafting:** a language model writes the draft as structured data; Pot checks it on the server, with a rule-based fallback.
- **Storage:** Postgres (Neon) when hosted, SQLite locally. Every row is tagged practice or live, so the two never mix.
- **Tests:** 177 automated tests (17 files) across the core logic, the server (Panta responses mocked) and the bot (fake Telegram updates).

---

Powered by [Panta](https://www.panta.market/). Not financial advice. Payouts shown are estimates.
