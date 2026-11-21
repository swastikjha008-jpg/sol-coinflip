# FFFLIP SOL

Animated ASCII/dither coin flip on Solana. Vite + React + TS front end, Canvas2D art engine, wallet-adapter (Phantom, Solflare), and a small settlement API (Vercel functions). **Devnet and mainnet** are switchable in the header (mainnet asks for confirmation and is OFF server-side until you enable it).

## How a flip works
1. Browser sends **one transaction**: `SystemProgram.transfer(player -> house)` + a Memo `ffflip:v1:<heads|tails>`.
2. `POST /api/flip {network, signature}`. The server reads that tx **from the chain** (never trusts the client), checks amount/limits/age/layout, and claims the signature in the store (`SET NX`) = replay protection.
3. Outcome = `HMAC-SHA256(FLIP_SECRET, network:signature)` first bit. Unknowable before the tx exists; not `Math.random()`, not client-controlled.
4. Win: house sends `2x wager - 3% of wager`. Loss: nothing. Invalid bet (bad memo, over/under limits, expired, house can't cover): **refund**. The signed payout tx is persisted *before* broadcast and only ever re-broadcast, so a crash/retry can't pay twice.

**Honest limits:** this is a house-operated game with a trusted server, not an on-chain program. `FLIP_SECRET` is committed by hash (shown in the UI) but not yet revealed on-chain, and the house key is a hot wallet. Fine for devnet/testing; for real money get an audit and consider moving to an on-chain program + VRF.

## Run locally
    pnpm install
    cp .env.example .env      # fill HOUSE_SECRET_KEY + FLIP_SECRET
    pnpm dev:all              # web :5173 + api :8787 (in-memory store, dev only)
    pnpm test                 # 21 tests: settlement, replay, refunds, payouts, fee maths
    pnpm build

Generate secrets:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"            # FLIP_SECRET
    node -e "const k=require('@solana/web3.js').Keypair.generate();console.log(require('bs58').default.encode(k.secretKey),k.publicKey.toBase58())"   # HOUSE_SECRET_KEY, address

Fund the house address with devnet SOL (`solana airdrop 2 <addr> -u devnet`) so it can pay winners. Max bet is capped to 1/4 of (house balance − reserve).

## Deploy (Vercel)
1. Push to GitHub, import in Vercel (settings come from `vercel.json`; pnpm is auto-detected from `packageManager`).
2. Add a **Vercel KV / Upstash Redis** store (sets `KV_REST_API_URL/TOKEN`). It is **required**: without it the API refuses bets (serverless has no shared memory).
3. Set env vars from `.env.example`: `HOUSE_SECRET_KEY`, `FLIP_SECRET`, `RPC_DEVNET`, `VITE_RPC_DEVNET`. For mainnet also `RPC_MAINNET`, `VITE_RPC_MAINNET` (use a paid RPC), fund the mainnet house wallet, and set `MAINNET_ENABLED=true`.
4. Put your artwork at `public/hands.png`.

Never set `VITE_DEMO_MODE=true` in production (UI-only, `Math.random()`, moves no funds).

## Layout
- `src/ascii/` engine (25 render modes, post fx, animation) · `src/components/` UI · `src/wallet/` network + balance
- `src/game/` fee preview + browser client · `shared/protocol.ts` wire format
- `server/` settlement core + handlers + tests · `api/` Vercel functions
