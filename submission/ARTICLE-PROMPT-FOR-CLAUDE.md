# Prompt for Claude: write my X Article about Pot

I want you to write an X Article (long-form post on X) about Pot, a project I built for a hackathon. Write it in MY voice and MY usual structure. I'm attaching or pasting some of my past X articles below; match how I write (tone, sentence length, how I structure sections, how I open and close). Do not copy the style of other builders' "why I built X" posts. I only used those for the general idea of a builder's story.

## About me
- Baheet Adeniji, @baheet_ on X. Bio: "Prediction markets & onchain market structure · Research @schemacap".
- Research writer at Schema Capital. Former intern and affiliate at Trepa, where I found high-demand trending markets to list and wrote their rules and resolution sources. Ambassador or affiliate at Pred, Markets.xyz, Trendle and Kalshi.
- I write about prediction markets and market structure for builders and contributors. One view I hold: a price isn't a probability until it's been tested.
- Past articles: "What It Actually Takes to Build the Aggregation and Routing Layer for Prediction Markets", "Prediction Markets Are Coming to Your Everyday Apps" (Agg Build), a thread on wallets and apps as the new distribution layer for prediction markets, and an article on the game theory behind prediction markets.
  [PASTE 1–2 OF MY PAST ARTICLES HERE AS STYLE REFERENCE]

## The article's structure (my outline; follow it)
1. **The core idea behind permissionless prediction markets.**
   - Lots of arguments and debates about real-world events never make it past the timeline or the group chat.
   - KOLs, influencers and micro-influencers have niche audiences with an appetite to put money behind their convictions.
   - It could be sports, games, entertainment or politics. The idea is to bring prediction markets to where these people already are.
2. **People shouldn't have to go to a venue** to trade or search for a market. They should be able to trade right where the argument started.
3. **For influencers: monetize your audience by becoming a market creator.**
   - You own the community, you control the audience, and you know what they like and argue about.
   - You can become a market creator and earn the creator's cut.
4. **This is one way to solve distribution for permissionless prediction markets.**
   - Unlike curated venues, their core selling point is that anyone can spin up a market.
   - For that to work, creating one has to be as simple as possible in the UI/UX.
5. **This is exactly why I decided to try building this** when I saw the Panta hackathon.
6. **What we built and how Pot works.**
7. **Challenges and ideas from building.**
   - For example, I found there has to be an AI layer that filters and critiques new markets, and helps restructure them, so they aren't spam, are good quality and can actually be resolved.
8. **Who it's really for.**
9. **Close:** where it stands, plus links.

## The facts (use only these; don't invent stats or traction)
- **What it is:** Pot is a Telegram bot (@pantapotbot, t.me/pantapotbot) plus a website (pot-navy.vercel.app). Code: github.com/Baheet18/pot. Built on Panta's API (@PantaHQ) for the Panta API Sidetrack in Colosseum's Crypto World's Fair hackathon ($5,000 USDG prize pool).
- **Panta:** a permissionless prediction-market protocol on Solana with USDC.
  - Markets are binary YES/NO.
  - Anyone can create one: $20 for a "breaking" market (event within about 72 hours) or $50 for a standard one.
  - There's a buy-only first phase, then the market graduates to an order book.
  - Payouts are parimutuel, so winners split the pot.
  - The trading fee is 2%.
  - Creators earn a creator's cut of up to 20%. It drops when nearly everyone is on one side.
- **How Pot works:**
  1. A group admin types `/new <question>`.
  2. The AI drafts a clean market: a YES/NO question, when buying closes, the settlement rule and the sources. The admin can edit it in plain words.
  3. The admin taps Create. The pay link arrives by private message, so nobody else can take the creator's cut. They pay the creation fee in Phantom and the market goes live on Panta.
  4. Members tap YES or NO in the chat and buy with USDC from their phones in Phantom. They see a payout preview first. Grouped alerts show new buys. Markets can be shared to X as a link or Blink with referral credit.
  5. When Panta resolves the market, Pot automatically posts a receipt in the group: who backed which side, their stake, and their payout or loss.
  6. `/panta` shows real live Panta markets in the chat. There's also a group leaderboard (`/top`) and personal history (`/mine`).
- **The AI quality layer (a key lesson from building):**
  - Vague questions get clarifying questions or a rewrite into a clean YES/NO question with a named public source.
  - Questions with several answers ("who wins BBNaija?") are split into one YES/NO market per option, because Panta is binary. The admin can also reply with the names.
  - Personal bets that can't be settled ("will Tolu pay me back?") are politely refused.
  - Matches are checked against the real fixture list, so buying closes at kick-off. Early on, the bot got a date wrong when I typed "tomorrow" after midnight, and a draft once used a fixture that didn't exist. That's why it now uses real fixture data and never lets the AI invent times.
  - This ties to my Trepa experience: a market is only as good as its resolution rules.
- **Other building lessons, optional:**
  - I first built a "reading layer" that rated whether a market's price could be trusted. I dropped it because in a group chat people care about who's on which side and who won, not price analysis. That's why settlement receipts became the core.
  - When everyone picks the same side, Panta still pays out by shares, so late buyers can get back less than they put in. The receipt explains this honestly.
  - The creator link was first posted in the group. A code review caught that anyone could take over a market's creation, so it now goes privately to the admin.
- **Example debates:** football ("Arsenal are bottling it"), BBNaija, elections and Nigerian politics, celebrity news, movies and box office, music releases and streams (e.g. "Wizkid's album beats Burna's first-week streams"), crypto prices.
- **Who it's for:**
  - influencers and KOLs who want to earn from their community;
  - fan communities and group chats;
  - Panta, which gets distribution: each community brings first-time traders who never had to find the app.
- **Honest status:**
  - It currently runs on Panta's sandbox. Practice markets are tracked by Pot.
  - Live mode is fully built, checked against Panta's real API with read-only calls, and switches on with one command.
  - Real Panta markets already show in the bot via `/panta`.
  - I chose not to put real money behind code that isn't battle-tested yet.
  - Don't claim live users, volume or traction numbers.
  [ADD REAL TESTER NUMBERS HERE IF ANY]
- **Other builders in the same track:**
  - PantaChat: a Telegram/Discord bot where you reply `/market`.
  - Panta Rooms: a debate room for each market.
  Don't mention them in the article; this is just context so you don't make Pot sound like the only idea of its kind. Pot's edge is clean, settleable markets, automatic group receipts, and its focus on communities and creators.

## Rules
- My voice and structure, plain English, no jargon walls. Explain any crypto term in a few words.
- Don't fabricate numbers, quotes or traction.
- Keep it readable on a phone: short paragraphs, a few clear section headers.
- Suggest where to put 3–4 images or GIFs: the draft card, the receipt, the BBNaija split, the demo video.
- Give me a title plus 2 alternatives, and a one-line hook for the post that shares the article.
- Length: whatever my past articles usually are (roughly 900–1,400 words if unsure).
