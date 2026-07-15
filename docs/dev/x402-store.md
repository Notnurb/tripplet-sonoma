# x402 Store — accountless, agent-first

The Tripplet Store (`/store`, `/api/x402/*`) sells AI inference over the
[x402 protocol](https://www.x402.org) (v1, `exact` scheme, USDC on Base). There is **no login
anywhere in the loop** — no accounts, no cookies, no OAuth. Payment or key possession is the
only credential.

Two ways to buy:

1. **Pay per call** — `POST /api/x402/chat/completions` with an `X-PAYMENT` header. Each
   request settles its own USDC micro-payment ($0.01–$0.03 by model). Stateless: no key, no
   DB row; EIP-3009's on-chain nonce is the replay protection.
2. **Prepaid keys** — pay a pack at `/api/x402/buy/{starter|builder|power}`; the receipt's
   `grant.apiKey` is a `trpl_x4_…` bearer key holding token credits. Then it's a plain
   OpenAI-style API (`Authorization: Bearer …`), credits metered on actual usage. An
   exhausted key gets HTTP 402 whose `accepts[]` are the packs — pay one with the key in the
   `X-Tripplet-Key` header and retry. The 402 loop closes itself.

Pricing/credits live in `src/lib/x402/catalog.ts` (product decisions — edit freely).

## Surface

| Endpoint | What |
|---|---|
| `GET /.well-known/x402` | Bazaar-shaped discovery doc (`{x402Version, items[]}`) — every paid resource, one GET. |
| `GET /api/x402/catalog` | Rich machine catalog: models + per-call prices, packs, full `PaymentRequirements`, flow description. |
| `GET/POST /api/x402/buy/{packId}` | x402 resource. 402 challenge → pay → receipt with `grant.apiKey`. `X-Tripplet-Key: <key>` tops up instead of minting. |
| `POST /api/x402/chat/completions` | OpenAI-shaped inference. `X-PAYMENT` (per-call) or `Bearer trpl_x4_…` (prepaid; wins when both are sent). `GET` returns the price card as a 402. |
| `GET /api/x402/key` | Balance introspection with the bearer key. |

All endpoints send CORS `*` and never read cookies. Model ids are the public persona ids
(`astro-5`, `tura-3`, `majuli-3`, `suzhou-3`); upstreams resolve via `resolveBackend()` in
`src/lib/ai/llm.ts`, and **real upstream model names/URLs must never leak into responses or
errors** (see `src/lib/x402/inference.ts`'s sanitization contract).

## Configuration

All optional — unset means `/store` shows "warming up" and paid endpoints answer 503.

| Var | Meaning |
|---|---|
| `X402_PAY_TO` | **Required to enable.** Merchant wallet (0x…) that receives USDC. |
| `X402_NETWORK` | `base-sepolia` (default) or `base`. |
| `X402_FACILITATOR_URL` | Default on testnet: `https://x402.org/facilitator` (free, keyless). **Mainnet has no default.** |
| `X402_FACILITATOR_API_KEY` | Sent as `Authorization: Bearer` to the facilitator if set. |

Tables: `x402_payments` + `x402_api_keys` in `db/schema.sql` (raw-SQL layer, same as
`developer_api_keys`) — apply with `npm run setup:db`. Endpoints fail closed (503) until they
exist. Prepaid keys are HMAC-derived with `JWT_SECRET`; rotating it orphans existing keys'
recoverability-by-replay (the keys themselves keep working — only their hash matters).

## Testnet walkthrough (free)

1. Set `X402_PAY_TO` to any wallet you control; leave `X402_NETWORK` unset.
2. Get testnet USDC on Base Sepolia at <https://faucet.circle.com> (payers never need ETH —
   the facilitator pays gas).
3. `/store` → buy the $0.99 Starter with a browser wallet → copy the key from the receipt →
   `curl /api/x402/chat/completions -H "Authorization: Bearer trpl_x4_…" …`.
4. Agents: `GET /api/x402/catalog`, then the standard 402 loop (x402-fetch does it in ~5 lines).

## Payment integrity (read before touching payments.ts / the chat route)

- **Pack purchases are replay-safe**: unique `(network, payer, nonce)` on `x402_payments`;
  a re-sent `X-PAYMENT` header returns the original receipt **including the key** (re-derived
  from the row id — only its SHA-256 is stored). Lost responses never strand a purchase.
- **Fails closed**: DB or facilitator unreachable → 503, never "grant now, reconcile later".
  The unpaid 402 challenge path touches no DB.
- **Ambiguity recovery**: a `/settle` timeout leaves the row `pending` + flagged; on retry the
  server probes `authorizationState(from, nonce)` on USDC over public RPC — consumed means the
  funds reached `payTo` (grant), not consumed means safe to retry. The chain is the arbiter.
- **Per-call**: verify → settle → serve, no DB. A settle timeout returns 503 "retry same
  header" (an unsettled authorization stays spendable; a settled one fails the next verify).
  If inference fails *after* a settle, the error response still carries the settlement proof —
  loss bounded to one micro-payment.
- **Top-up targets are validated before money moves**; if a key is revoked in the gap, a fresh
  key is minted rather than stranding paid credits.
- **Credits** may overdraw slightly on a key's final call (bounded by `max_tokens`); the next
  call is blocked. Charging happens post-completion and never throws away a produced response.
- `value` must equal the price **exactly** — `exact` settles the full signed value, so `>=`
  would overcharge payers.
- USDC's EIP-712 domain name differs per network (`USDC` on Base Sepolia, `USD Coin` on Base
  mainnet) — encoded in `src/lib/x402/config.ts`; don't "simplify" it.

## Going to mainnet

1. `X402_NETWORK=base` + `X402_FACILITATOR_URL` (+ key) for a mainnet-capable facilitator.
2. `X402_PAY_TO` should be a hardware/multisig wallet — it accumulates revenue.
3. Apply the two tables to prod Neon (`npm run setup:db` or by hand, same as the oauth_* tables).
4. Sanity-check per-call prices against upstream cost per request before flipping.
