<p align="center">
  <h1 align="center">mpp-spl</h1>
  <p align="center">Accept any Solana token as payment in your API — including pump.fun tokens that just launched.</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mpp-spl"><img src="https://img.shields.io/npm/v/mpp-spl?style=flat&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://github.com/nullxnothing/mpp-spl/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/mpp-spl?style=flat&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://github.com/nullxnothing/mpp-spl"><img src="https://img.shields.io/github/stars/nullxnothing/mpp-spl?style=flat&colorA=000000&colorB=000000" alt="stars" /></a>
</p>

---

## What is this?

[MPP](https://mpp.dev) (Machine Payments Protocol) is a new standard that lets APIs charge for access using the HTTP `402 Payment Required` flow. Think of it like a toll booth for API calls — an AI agent hits your endpoint, gets a "please pay" response, sends a Solana transaction, and gets the data back. No API keys, no credit cards, no humans involved.

The official [`@solana/mpp`](https://github.com/solana-foundation/mpp-sdk) SDK handles the payment plumbing, but it only speaks raw token amounts. It doesn't know that BONK has 5 decimals, can't convert "$0.01 worth of BONK" into the right number, and has zero support for pump.fun tokens that haven't graduated to a DEX yet.

**`mpp-spl` bridges that gap.** You tell it "charge $0.01 in BONK" and it handles the rest — token lookup, price feed, decimal math, and formatting. For pump.fun tokens, it reads the bonding curve directly on-chain since Jupiter has no data for pre-graduation tokens.

## Install

```bash
npm i mpp-spl @solana/mpp @solana/kit mppx
```

## Quick Start

### Charge $0.01 in BONK per API call

```ts
import { Mppx, solana } from '@solana/mpp/server'
import { resolveChargeConfig, buildSolanaChargeParams } from 'mpp-spl'

// "I want to charge $0.01 in BONK" — mpp-spl figures out the rest
const config = await resolveChargeConfig({
  token: 'BONK',
  recipient: 'YourWalletPubkey...',
  usdAmount: 0.01,
})

// Wire it into MPP
const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [solana.charge(buildSolanaChargeParams(config))],
})

// Your API handler
export async function handler(request: Request) {
  const result = await mppx.charge({
    amount: config.amount,
    currency: config.currency,
  })(request)

  // Agent hasn't paid yet — send them the payment challenge
  if (result.status === 402) return result.challenge

  // Agent paid — return the goods
  return result.withReceipt(Response.json({ data: '...' }))
}
```

### Charge in your own pump.fun token

This is the interesting part. You launch a token, gate your API behind it, and every API call creates buy pressure on the bonding curve.

```ts
import { registerToken, resolveChargeConfig } from 'mpp-spl'

// Your token launched 5 minutes ago — Jupiter doesn't know about it yet
registerToken({
  symbol: 'MYTOKEN',
  name: 'My AI Token',
  mint: 'YourMintAddress...',
  decimals: 6,
  program: 'spl',
})

// mpp-spl reads the price directly from the bonding curve on-chain
const config = await resolveChargeConfig({
  token: 'MYTOKEN',
  recipient: 'YourWalletPubkey...',
  usdAmount: 0.01,
  heliusRpcUrl: process.env.HELIUS_RPC_URL, // needed for bonding curve reads
})
```

### Build an AI agent that pays automatically

```ts
import { Mppx, solana } from '@solana/mpp/client'

const mppx = Mppx.create({
  methods: [solana.charge({ signer })],
})

// The agent calls your API. If it gets a 402, it pays and retries. Automatic.
const response = await mppx.fetch('https://api.example.com/paid-endpoint')
```

## How it works

```
You: "Charge $0.01 in BONK"

mpp-spl:
  1. Looks up BONK → mint address, 5 decimals, SPL program
  2. Fetches price from Jupiter ($0.00001234 per BONK)
  3. Calculates: $0.01 / $0.00001234 = 810.37 BONK = 81037 base units
  4. Returns everything @solana/mpp needs to create the charge

For pump.fun tokens (not on Jupiter yet):
  2b. Derives the bonding curve PDA from the mint address
  2c. Reads virtualSolReserves / virtualTokenReserves on-chain
  2d. Converts to USD using SOL price from Jupiter
```

## API Reference

### Token Registry

A map of known tokens. Comes with 10 built-in (USDC, USDT, SOL, BONK, WIF, JUP, PYUSD, RAY, POPCAT, MEW). Add your own at runtime.

```ts
import { getToken, registerToken, getAllTokens } from 'mpp-spl/registry'

getToken('BONK')           // look up by symbol (case-insensitive)
getToken('DezXAZ8z...')    // look up by mint address
registerToken({ ... })     // add a new token
getAllTokens()              // list everything registered
```

### Price Providers

Two price sources with automatic fallback.

```ts
import { resolvePrice, createPriceResolver } from 'mpp-spl/price'

// One-shot: tries Jupiter, falls back to pump.fun bonding curve
const price = await resolvePrice({
  mint: 'DezXAZ8z...',
  heliusRpcUrl: process.env.HELIUS_RPC_URL,
})
// -> { usdPerToken: 0.00001234, decimals: 5, source: 'jupiter' }

// Reusable (shared cache, better for multiple lookups)
const resolver = createPriceResolver({
  jupiterApiKey: process.env.JUPITER_API_KEY,
  heliusRpcUrl: process.env.HELIUS_RPC_URL,
})
await resolver.getPrice(mint)
```

**Jupiter provider** — [Price API v3](https://dev.jup.ag/docs/price/v3). 30-second cache. Batch queries up to 50 mints.

**PumpFun provider** — Reads bonding curve PDAs on-chain. Returns price, graduation status, curve progress %, and estimated SOL to graduation. Auto-delegates to Jupiter when a token graduates.

### USD / Base Unit Conversion

```ts
import { usdToBaseUnits, baseUnitsToUsd } from 'mpp-spl/price'

usdToBaseUnits(0.01, 0.00001234, 5)   // -> "81037" (string, BigInt safe)
baseUnitsToUsd('81037', 0.00001234, 5) // -> ~0.01
```

### Charge Config Resolver

The main helper. One call that gives you everything `@solana/mpp` needs.

```ts
import { resolveChargeConfig, buildSolanaChargeParams } from 'mpp-spl/server'

const config = await resolveChargeConfig({
  token: 'BONK',            // symbol or mint address
  recipient: 'pubkey...',   // wallet that gets paid
  usdAmount: 0.01,          // dollar amount (price adjusts per request)
  // OR: tokenAmount: '83400' // fixed token amount (no price lookup)
  heliusRpcUrl: '...',      // needed for pump.fun tokens
  jupiterApiKey: '...',     // optional, helps with rate limits
})

// Pass directly to @solana/mpp
const chargeParams = buildSolanaChargeParams(config)
// -> { recipient, currency, decimals, tokenProgram }
```

## The Pump.fun Play

This is why this library exists. Here's the mechanic:

1. **Launch a token** on pump.fun — `$YOURTICKER`
2. **Build an API** — AI endpoints, data feeds, tools, whatever
3. **Gate it with mpp-spl** — `resolveChargeConfig({ token: 'YOURTICKER', usdAmount: 0.01 })`
4. **Agents need your token to use your API** — they buy it
5. **Every buy pushes the bonding curve** toward graduation ($69K mcap)
6. **Graduation** creates a PumpSwap pool with locked liquidity

Most tokens launch with hype and bolt on utility later. This ships utility first. The token and the product are the same thing from day one.

See [`examples/pumpfun-launch.ts`](examples/pumpfun-launch.ts) for the full template.

## Project Structure

```
mpp-spl/
├── src/
│   ├── index.ts              # All public exports
│   ├── registry.ts           # Token registry
│   ├── server.ts             # resolveChargeConfig + helpers
│   └── price/
│       ├── index.ts          # Auto-detection (Jupiter -> PumpFun)
│       ├── jupiter.ts        # Jupiter Price API v3
│       └── pumpfun.ts        # Bonding curve reader
└── examples/
    ├── express-server.ts     # Multi-token Express server
    ├── nextjs-api-route.ts   # Next.js App Router
    ├── agent-client.ts       # Autonomous paying agent
    └── pumpfun-launch.ts     # Full launch template
```

**Package exports:**

| Import | What you get |
|--------|-------------|
| `mpp-spl` | Everything |
| `mpp-spl/server` | `resolveChargeConfig`, charge helpers |
| `mpp-spl/registry` | Token lookup and registration |
| `mpp-spl/price` | Price providers, conversion utils |

Zero runtime dependencies. All external packages are peer deps.

## Environment Variables

| Variable | Where | Required | What it does |
|----------|-------|----------|-------------|
| `MPP_SECRET_KEY` | Server | Yes | Random string for HMAC challenge signing |
| `RECIPIENT_PUBKEY` | Server | Yes | Your Solana wallet (receives payments) |
| `HELIUS_RPC_URL` | Server | For pump.fun tokens | RPC endpoint for bonding curve reads |
| `JUPITER_API_KEY` | Server | No | Avoids Jupiter rate limits |
| `AGENT_PRIVATE_KEY` | Client | Yes | Agent wallet private key (base58) |

## Examples

| File | What it shows |
|------|--------------|
| [`express-server.ts`](examples/express-server.ts) | Accept BONK, USDC, and a pump.fun token in one server |
| [`nextjs-api-route.ts`](examples/nextjs-api-route.ts) | Next.js App Router pattern |
| [`agent-client.ts`](examples/agent-client.ts) | AI agent that pays for API calls automatically |
| [`pumpfun-launch.ts`](examples/pumpfun-launch.ts) | Launch token, register it, gate your API, go |

## What this does NOT do

- MPP protocol logic (that's [`@solana/mpp`](https://github.com/solana-foundation/mpp-sdk))
- Wallet management or key storage
- Token swaps or DEX routing
- Payment history or analytics
- EVM or cross-chain anything

## Links

- [`@solana/mpp`](https://github.com/solana-foundation/mpp-sdk) — Solana MPP SDK
- [`mppx`](https://github.com/wevm/mppx) — TypeScript MPP framework
- [MPP Spec](https://paymentauth.org) — The protocol standard
- [Jupiter Price API](https://dev.jup.ag/docs/price/v3) — Token prices
- [Pump.fun Docs](https://github.com/pump-fun/pump-public-docs) — Bonding curve reference

## License

[MIT](LICENSE)
