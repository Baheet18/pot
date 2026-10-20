# Pot: TestSprite test plan

Target: **https://pot-navy.vercel.app** (practice mode: no real money; buys are a free signed message, not a transaction).
Sample open market id: `2L6W6EQUqw2527XHCBj8iGQP6BV44jhHzKP378B2Pi3N` (any `/m/<id>` link on the home page works).
Sample wallet (valid base58 format): `11111111111111111111111111111111`.
Valid buy amounts: **$1 to $500** inclusive. Sides: `yes` / `no`.

Paste the sections below into the TestSprite portal as the product description / test scope.

## 1. Pages (frontend)

| Route | Expected |
|---|---|
| `/` | 200. Hero for Pot, link to the Telegram bot, list of markets each linking to `/m/<id>`. |
| `/m/<id>` | 200 for a real market: question, YES/NO money split, practice-mode notice, buy controls, share/Blink link. |
| `/m/notamarket` | 404 page (not a crash). |
| `/blink/<id>` | 200, Blink-friendly market page for the same market. |
| `/claim/<id>` | 200, claim page for the market (shows result/claim state). |
| `/leaderboard` | 200, groups / members ranked by buys credited through their links. |
| `/link` | 200, wallet-link page (needs a token from the bot to complete; without one it shows an expired/invalid-link message). |
| `/create/<draftId>` | 200; an unknown draft shows a clear "link expired / not found" state. |
| any unknown path | 404 page. |

## 2. Solana Actions / Blinks

| Request | Expected |
|---|---|
| `GET /actions.json` | 200 JSON `{rules:[...]}` mapping `/m/*` and `/blink/*` to `/api/actions/m/*`, with CORS headers. |
| `OPTIONS /api/actions/m/<id>` | 200 with Actions CORS headers. |
| `GET /api/actions/m/<id>` | 200 JSON `type:"action"`, `icon`, `title` (the question), `description` mentioning practice mode, buy links. |
| `GET /api/actions/m/notamarket` | 404 JSON. |
| `POST /api/actions/m/<id>?amount=5&side=yes` body `{"account":"<wallet>"}` | 200 JSON `type:"message"` (practice) with `data` = message to sign and `links.next.href` → `/api/actions/m/<id>/next?...`. |
| same, `amount` = blank, whitespace, `0`, `-5`, `9999`, `abc` | **400** JSON `{message}` asking for an amount between $1 and $500. |
| `POST` with a missing / invalid `account` | 400 JSON `{message}`. |

## 3. Buy API (JSON, `POST`)

`POST /api/pot/buy/start` body `{marketId, side, amountUsdc, wallet}`

| Case | Expected |
|---|---|
| valid (`amountUsdc: 5`, `side: "yes"`) | 200 with `orderId` (`ord_p_…`), `quoteId`, `side`, `amountUsdc: 5`, `shares > 0`, `feeUsdc: 0`, `practiceMessage` containing the wallet, market id and `YES $5.00`, `sandbox: true`. |
| `amountUsdc` = `""`, `"  "`, `null`, `0`, `-5`, `500.01`, `9999`, `"abc"` | **400** `{code:"BAD_AMOUNT", message}`. Blank input must never be treated as 0 or as a number. |
| `amountUsdc` = `1`, `500`, `"25.50"` | 200 (boundaries accepted). |
| `side: "maybe"` | 400 `BAD_SIDE`. |
| bad `marketId` | 400 `BAD_MARKET`. |
| bad `wallet` | 400 `BAD_WALLET`. |
| body `{` (malformed JSON) | 400 `BAD_JSON`. |
| body > 20 KB | 413 `TOO_BIG`. |

`POST /api/pot/buy/finish` body `{orderId, quoteId, marketId, side, amountUsdc, wallet, practiceMessage, practiceSignature}`

| Case | Expected |
|---|---|
| blank / zero / negative / over-max `amountUsdc` | 400 `BAD_AMOUNT`. |
| practice message/signature missing or not from Pot | 400 `BAD_PRACTICE`. |
| (Happy path needs a real wallet signature; not testable without a wallet.) | |

## 4. Other APIs (negative paths only; happy paths need bot-issued tokens or wallet signatures)

| Request | Expected |
|---|---|
| `POST /api/pot/link` `{}` | 401 `BAD_TOKEN` "This link expired…". |
| `POST /api/pot/create/start` `{}` | 401 `BAD_TOKEN`. |
| `POST /api/pot/claim/build` `{}` | 400 `BAD_WALLET`. |
| `POST /api/pot/claim/report` `{}` | 400 `BAD_PRACTICE`. |
| `GET /api/og/<id>` | 200 `image/png` (market card image). |
| `GET /api/pot/ready`, `GET /api/cron/settle`, `POST /api/pot/test-data`, `POST /api/pot/draft-check` without `Authorization: Bearer …` | 401 (operator-only, never leak config). |
| `GET /api/pot/test-data` | 405 (POST only). |

## 5. Cross-cutting

- Every error response is JSON `{code, message}` (Blinks: `{message}`) and never includes secrets, stack traces or Panta keys.
- Pages load in under ~3 s; no console errors on `/` and `/m/<id>`.
- All amounts shown with 2 decimals; practice-mode wording ("no real money") visible on market pages and Blinks.
