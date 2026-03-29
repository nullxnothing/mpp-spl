<p align="center">
  <h1 align="center">mpp-spl</h1>
  <p align="center">SPL Token + Pump.fun payment layer for the <a href="https://mpp.dev">Machine Payments Protocol</a></p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mpp-spl"><img src="https://img.shields.io/npm/v/mpp-spl?style=flat&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://github.com/nullxnothing/mpp-spl/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/mpp-spl?style=flat&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://github.com/nullxnothing/mpp-spl"><img src="https://img.shields.io/github/stars/nullxnothing/mpp-spl?style=flat&colorA=000000&colorB=000000" alt="stars" /></a>
</p>

<br />

Accept any Solana SPL token as payment in MPP-gated APIs. Includes first-class support for pre-graduation pump.fun tokens via direct bonding curve reads.

## The Problem

[`@solana/mpp`](https://github.com/solana-foundation/mpp-sdk) handles the 402 payment flow but operates in raw base units. There's no token registry, no price conversion, and no way to price pre-graduation pump.fun tokens that don't exist on Jupiter yet.

`mpp-spl` is a thin ergonomics layer that fills both gaps.

## Install

```bash
npm i mpp-spl @solana/mpp @solana/kit mppx
```

## Quick Start

### Gate an endpoint with BONK

```ts
import { Mppx, solana } from '@solana/mpp/server'
import { resolveChargeConfig, buildSolanaChargeParams } from 'mpp-spl'

const config = await resolveChargeConfig({
  token: 'BONK',
  recipient: 'RecipientPubkey...',
  usdAmount: 0.01,
})

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [solana.charge(buildSolanaChargeParams(config))],
})

export async function handler(request: Request) {
  const result = await mppx.charge({
    amount: config.amount,
    currency: config.currency,
  })(request)

  if (result.status === 402) return result.challenge
  return result.withReceipt(Response.json({ data: '...' }))
}
```

### Gate an endpoint with your own pump.fun token

```ts
import { registerToken, resolveChargeConfig } from 'mpp-spl'

registerToken({
  symbol: 'MYTOKEN',
  name: 'My AI Token',
  mint: 'YourMintAddress...',
  decimals: 6,
  program: 'spl',
})

// Price is read directly from the bonding curve on-chain
const config = await resolveChargeConfig({
  token: 'MYTOKEN',
  recipient: 'RecipientPubkey...',
  usdAmount: 0.01,
  heliusRpcUrl: process.env.HELIUS_RPC_URL,
})
```

### Autonomous agent client

```ts
import { Mppx, solana } from '@solana/mpp/client'

const mppx = Mppx.create({
  methods: [solana.charge({ signer })],
})

// 402 challenges are handled automatically
const response = await mppx.fetch('https://api.example.com/paid-endpoint')
```

## Features

### Token Registry

Curated map of 10 SPL tokens, extensible at runtime. Indexed by both symbol and mint address for O(1) lookups.

```ts
import { getToken, registerToken, getAllTokens } from 'mpp-spl/registry'

getToken('BONK')           // by symbol (case-insensitive)
getToken('DezXAZ8z...')    // by mint address
registerToken({ symbol, name, mint, decimals, program })
getAllTokens()
```

Built-in: `USDC` `USDT` `SOL` `BONK` `WIF` `JUP` `PYUSD` `RAY` `POPCAT` `MEW`

### Price Providers

Two providers with a shared interface. Auto-detection tries Jupiter first and falls back to the bonding curve when a Helius RPC URL is configured.

```ts
import {
  JupiterPriceProvider,
  PumpFunPriceProvider,
  resolvePrice,
  createPriceResolver,
} from 'mpp-spl/price'

// Auto-detect: Jupiter -> PumpFun fallback
const price = await resolvePrice({
  mint: 'DezXAZ8z...',
  heliusRpcUrl: process.env.HELIUS_RPC_URL,
})
// -> { usdPerToken: 0.00001234, decimals: 5, source: 'jupiter', cached: false }

// Reusable resolver (shared cache across providers)
const resolver = createPriceResolver({
  jupiterApiKey: process.env.JUPITER_API_KEY,
  heliusRpcUrl: process.env.HELIUS_RPC_URL,
})
await resolver.getPrice(mint)

// PumpFun bonding curve directly
const pumpfun = new PumpFunPriceProvider({ rpcUrl: process.env.HELIUS_RPC_URL })
const result = await pumpfun.getPrice('YourMint...')
// -> { usdPerToken, bondingCurve: { progressPercent, isComplete, estimatedSolToGraduation } }
```

**Jupiter Price Provider** — Hits [Jupiter Price API v3](https://dev.jup.ag/docs/price/v3). 30-second in-process cache. Supports batch queries (up to 50 mints).

**PumpFun Price Provider** — Derives the bonding curve PDA (`seeds: ["bonding-curve", mint]`), fetches via `getAccountInfo`, and computes price from the constant-product formula. Returns graduation status, curve progress, and estimated SOL to graduation. Automatically delegates to Jupiter when a token has graduated.

### USD / Base Unit Conversion

BigInt arithmetic throughout. No float64 for base-unit math.

```ts
import { usdToBaseUnits, baseUnitsToUsd } from 'mpp-spl/price'

usdToBaseUnits(0.01, 0.00001234, 5)   // -> "81037"
baseUnitsToUsd('81037', 0.00001234, 5) // -> ~0.01
```

### Charge Config Resolver

Combines registry + price provider into a single call that returns everything `@solana/mpp` needs.

```ts
import { resolveChargeConfig, buildSolanaChargeParams } from 'mpp-spl/server'

const config = await resolveChargeConfig({
  token: 'BONK',           // symbol or mint address
  recipient: 'pubkey...',
  usdAmount: 0.01,         // OR tokenAmount: '83400'
  heliusRpcUrl: '...',     // required for pump.fun tokens
  jupiterApiKey: '...',    // optional
})
// -> { currency, decimals, amount, displayAmount, recipient, tokenProgram, token, price }

buildSolanaChargeParams(config)
// -> { recipient, currency, decimals, tokenProgram }
```

Two charge modes:

- **`usdAmount`** — dollar amount floats with market price; token quantity adjusts per request
- **`tokenAmount`** — fixed token quantity; no price lookup needed

## How It Works

```
resolveChargeConfig({ token: "MYTOKEN", usdAmount: 0.01 })

  1. getToken("MYTOKEN")
       -> { mint, decimals, program }

  2a. JupiterPriceProvider.getPrice(mint)       // if listed
       -> { usdPerToken, cached }

  2b. PumpFunPriceProvider.getPrice(mint)       // if not on Jupiter
       -> getAccountInfo(bondingCurvePDA)
       -> price = virtualSolReserves / virtualTokenReserves * solUsdPrice

  3. usdToBaseUnits(0.01, price, decimals)      // BigInt math
       -> "840336"

  4. Return ResolvedChargeConfig
       -> pass to solana.charge() + mppx.charge()
```

## Pump.fun Mechanic

The interesting use case isn't "accept USDC." It's: **your API accepts payment in its own token.**

1. Launch `$YOURTICKER` on pump.fun
2. Register it with `registerToken()`
3. Gate your API with `resolveChargeConfig({ token: 'YOURTICKER', usdAmount: 0.01 })`
4. Every API call requires `$YOURTICKER` — agents buy it to use your service
5. Buys progress the bonding curve toward graduation ($69K mcap)
6. Graduation creates a PumpSwap pool with locked liquidity

The token and the product are the same thing. Demand is structural, not speculative. The utility exists on day one.

See [`examples/pumpfun-launch.ts`](examples/pumpfun-launch.ts) for the full end-to-end template.

## Architecture

```
mpp-spl/
├── src/
│   ├── index.ts              # All public exports
│   ├── registry.ts           # Token registry + getToken() + registerToken()
│   ├── server.ts             # resolveChargeConfig() + middleware helpers
│   └── price/
│       ├── index.ts          # PriceProvider interface + auto-detection
│       ├── jupiter.ts        # Jupiter Price API v3 provider
│       └── pumpfun.ts        # Bonding curve PDA reader + on-chain pricing
└── examples/
    ├── express-server.ts     # Multi-token: BONK, USDC, pump.fun
    ├── nextjs-api-route.ts   # App Router pattern
    ├── agent-client.ts       # Autonomous paying agent
    └── pumpfun-launch.ts     # Deploy token -> gate API -> go
```

**Package exports:**

| Path | Contents |
|------|----------|
| `mpp-spl` | Full re-export of all modules |
| `mpp-spl/server` | `resolveChargeConfig` + charge helpers |
| `mpp-spl/registry` | Token registry |
| `mpp-spl/price` | Price providers + conversion utils |

**Zero runtime dependencies.** Everything external is a peer dep.

## Environment Variables

| Variable | Side | Required | Purpose |
|----------|------|----------|---------|
| `MPP_SECRET_KEY` | Server | Yes | HMAC key for challenge binding |
| `RECIPIENT_PUBKEY` | Server | Yes | Wallet that receives payments |
| `HELIUS_RPC_URL` | Server | For pump.fun | RPC endpoint for bonding curve reads |
| `JUPITER_API_KEY` | Server | No | Jupiter Price API key (recommended) |
| `AGENT_PRIVATE_KEY` | Client | Yes | Agent paying wallet (base58) |

## Examples

| Example | Description |
|---------|-------------|
| [`express-server.ts`](examples/express-server.ts) | Multi-token server: BONK, USDC flat-rate, pump.fun token |
| [`nextjs-api-route.ts`](examples/nextjs-api-route.ts) | Next.js App Router with `withReceipt()` |
| [`agent-client.ts`](examples/agent-client.ts) | Autonomous agent paying via `mppx.fetch()` |
| [`pumpfun-launch.ts`](examples/pumpfun-launch.ts) | Full launch template: deploy, register, gate, go |

## Scope

`mpp-spl` explicitly does **not**:

- Implement any MPP protocol logic (lives in `@solana/mpp`)
- Manage wallets or private keys
- Swap tokens or route trades
- Track payment history or analytics
- Support EVM chains or cross-chain flows

If `@solana/mpp` makes a breaking change, `mpp-spl` tracks it at the peer dep level.

## Related

- [`@solana/mpp`](https://github.com/solana-foundation/mpp-sdk) — Solana payment method for MPP
- [`mppx`](https://github.com/wevm/mppx) — TypeScript SDK for the Machine Payments Protocol
- [MPP Specification](https://paymentauth.org) — HTTP Payment Authentication Scheme
- [Jupiter Price API](https://dev.jup.ag/docs/price/v3) — Token price data
- [Pump.fun Docs](https://github.com/pump-fun/pump-public-docs) — Bonding curve reference

## License

[MIT](LICENSE)
