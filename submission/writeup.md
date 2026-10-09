# Pot: prediction markets for your group chat, powered by Panta

**Code:** https://github.com/Baheet18/pot · **Website:** https://pot-navy.vercel.app · **Telegram:** [@pantapotbot](https://t.me/pantapotbot) · **Demo:** [LOOM LINK HERE]

Built by Baheet Adeniji for the Panta API Sidetrack, Colosseum Crypto World's Fair.

---

## The problem

Every group chat already runs prediction markets. They just don't have a place to put them.

"Super Eagles will lose." "BTC hits 150k by December." "Obi joins ADC before the year ends." Someone says it, five people disagree, and someone says "bet?" Then nothing happens. Nobody writes the bet down, nobody agrees on what counts as a win, nobody holds the money, and a week later nobody remembers who said what.

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

A football fan group, a crypto trading chat, a church youth group, a campus group, a fantasy league. Most of all, an influencer's community: a creator with 20,000 people in a Telegram channel and a group can run a market every match day, share it on X as a Blink, and earn the creator's cut on every one.

For Panta, that means:
- **New people.** Each group brings its own members. Pot marks buys that are someone's first-ever Panta trade.
- **New markets that people actually care about.** Local football, Nigerian politics, campus elections, the questions a global site would never list.
- **Volume that comes with the market.** A market made in a group starts with a crowd that already disagrees.
- **A reason for community owners to keep doing it.** The creator's cut pays the group owner, not a middleman.

Pot doesn't compete with Panta's website. It brings people to Panta's markets from the places they already spend time.

## How deep the Panta integration goes

Pot uses Panta's API for the whole life of a market: making it, buying into it, following it, settling it and claiming from it. All calls go to `https://live-api.panta.market/api/v1` from the server, with the API key kept server-side.

**Reading markets and positions**
| Endpoint | What Pot uses it for |
|---|---|
| `GET /markets/` | Open markets list on the website and `/markets` in the bot |
| `GET /markets/{id}/` | Market card, market page, Blink, settlement checks |
| `GET /markets/{id}/trades/` | Who bought which side; the YES/NO split; the receipt |
| `GET /positions/?wallet=` | `/mine` (your positions) and claim links |
| `GET /wallets/{wallet}/trades/` | Spotting a wallet's first-ever Panta trade |
| `GET /trades/{signature}/` | Confirming a single buy |

**Buying (the user signs in their own wallet)**
`POST /primaryorderquote/` → `POST /primaryorderbuild/` → wallet signs and sends → `POST /primaryordersubmit/` → `POST /primaryorderverify/` → `POST /trades/` (credits the buy to the group or member link through `userId` / `X-User-Id`)

**Making a market (the admin signs and pays the Panta fee)**
`POST /markets/create/quote/` → `POST /markets/create/build/` → wallet signs → `POST /markets/register/`

**Claiming**
`POST /claim/build/` (winnings) · `POST /claim/creator-fees/build/` (the creator's cut) → `POST /trades/` report

That's 16 endpoints across the full flow. A few things Pot does on top:
- **Follows Panta's rules exactly.** Payout estimates use Panta's pool rule, including the creator's cut dropping when one side is crowded, the 2% trading fee on live buys, and the fact that one-sided markets don't get refunds. Receipts say "approx" because Panta sets final payouts after its 1-hour dispute window.
- **Checks Panta's numbers before asking anyone to sign.** If Panta quotes a creation fee other than the expected $20 (breaking) or $50 (standard), Pot stops. It also checks the buyer has enough USDC and SOL first, and says what's missing in plain words.
- **Turns Panta's error codes into plain sentences.** For example, `NOT_CLAIMABLE` and `DUPLICATE_MARKET` get a human explanation.
- **Is a polite API client.** Reads are rate-limited under Panta's limit and cached. Only the POST paths above can be called at all, and with a live key every write is blocked unless a second switch is turned on.
- **Uses Panta's referral field.** Every buy through a group's card or a member's Blink link carries that group's or member's ref, which powers the `/top` leaderboard.

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

## Practice mode vs live mode: an honest note

**Pot runs in practice mode today. No real money moves.** I chose not to put real money in for this hackathon.

What that means in plain terms:
- **Practice mode** uses Panta's test API key. Markets a group makes in practice mode are practice markets: Pot keeps track of their pot using Panta's payout rules, wallets sign a free message instead of a payment, and a group admin settles them with `/settle yes` or `/settle no` after the event (practice markets have no automatic result). The bot, the website, the Blinks, the leaderboard, `/mine`, `/link` and the receipts all work for real people, in real groups, on real phones. Every practice screen is clearly labelled "practice, no real money".
- **Live mode is fully built.** It runs the real Panta flows listed above with the live key: real market creation, real buys, settlement from Panta's own result, and claims. It turns on with one command (`scripts/go-live.sh`) and turns off with another (`scripts/rollback-to-practice.sh`). Two separate switches must both be on before any real-money call can reach Panta.
- **What's been checked against Panta's live API**, with read-only calls and nothing signed or sent: buy quotes and builds (including the 2% fee), market-creation quotes and builds ($20 = 20,000,000 base units, of which $5 goes into the market), market lists, details and trades, and the error codes.
- **What can only be checked with real money:** signing and sending on mainnet, Panta's submit → verify → confirmed sequence, buy credit through `/trades/`, registering a real market, real settlement timing and the dispute window, and claims. The full go-live checklist and a ~$21 smoke test are in [`GO-LIVE.md`](https://github.com/Baheet18/pot/blob/main/GO-LIVE.md).

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
- **Tests:** 153 automated tests (14 files) across the core logic, the server (Panta responses mocked) and the bot (fake Telegram updates).

---

Powered by [Panta](https://www.panta.market/). Not financial advice. Payouts shown are estimates.
