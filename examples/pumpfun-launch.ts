/**
 * Full pump.fun launch template:
 *   1. Deploy token via pump.fun
 *   2. Register it in mpp-spl
 *   3. Gate your API behind MPP
 *   4. Every API call = structural buy pressure
 *
 * Usage:
 *   npx tsx examples/pumpfun-launch.ts
 *
 * Env:
 *   MPP_SECRET_KEY     — HMAC key
 *   RECIPIENT_PUBKEY   — your Solana wallet
 *   HELIUS_RPC_URL     — Helius RPC endpoint
 *   TOKEN_MINT         — mint address of your pump.fun token (after creation)
 *   TOKEN_SYMBOL       — e.g. "MYAI"
 *   TOKEN_NAME         — e.g. "My AI Agent Token"
 */

import express from 'express';
import { Mppx, solana } from '@solana/mpp/server';
import {
  registerToken,
  resolveChargeConfig,
  buildSolanaChargeParams,
  PumpFunPriceProvider,
} from 'mpp-spl';

const app = express();
const PORT = 3000;

const RECIPIENT = process.env.RECIPIENT_PUBKEY!;
const HELIUS_RPC = process.env.HELIUS_RPC_URL!;
const TOKEN_MINT = process.env.TOKEN_MINT!;
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL ?? 'MYTOKEN';
const TOKEN_NAME = process.env.TOKEN_NAME ?? 'My Token';

// ── Step 1: Register your pump.fun token ──

registerToken({
  symbol: TOKEN_SYMBOL,
  name: TOKEN_NAME,
  mint: TOKEN_MINT,
  decimals: 6, // All pump.fun tokens are 6 decimals
  program: 'spl',
});

console.log(`Registered ${TOKEN_SYMBOL} (${TOKEN_MINT})`);

// ── Step 2: Check bonding curve status ──

const pumpfun = new PumpFunPriceProvider({
  rpcUrl: HELIUS_RPC,
});

const priceData = await pumpfun.getPrice(TOKEN_MINT);
if (priceData && 'bondingCurve' in priceData) {
  const bc = priceData.bondingCurve;
  console.log(`\nBonding Curve Status:`);
  console.log(`  Price:       $${priceData.usdPerToken.toFixed(8)}`);
  console.log(`  Progress:    ${bc.progressPercent.toFixed(2)}%`);
  console.log(`  Graduated:   ${bc.isComplete}`);
  console.log(`  SOL to grad: ~${bc.estimatedSolToGraduation.toFixed(2)} SOL`);
}

// ── Step 3: Create MPP-gated API ──

// Your AI endpoint, data feed, or tool
app.get('/api/ai/generate', async (req, res) => {
  try {
    // Re-resolve price each request (bonding curve price changes with every trade)
    const config = await resolveChargeConfig({
      token: TOKEN_SYMBOL,
      recipient: RECIPIENT,
      usdAmount: 0.01, // $0.01 per API call
      heliusRpcUrl: HELIUS_RPC,
    });

    const mppx = Mppx.create({
      secretKey: process.env.MPP_SECRET_KEY!,
      methods: [solana.charge({
        ...buildSolanaChargeParams(config),
        rpcUrl: HELIUS_RPC,
      })],
    });

    const result = await mppx.charge({
      amount: config.amount,
      currency: config.currency,
      description: `AI generation — ${config.displayAmount}`,
    })(req as unknown as Request);

    if (result.status === 402) {
      res.status(402).json(result.challenge);
      return;
    }

    // Your actual API logic here
    const response = result.withReceipt(
      Response.json({
        result: 'Generated content here...',
        cost: config.displayAmount,
        tokenPrice: config.price?.usdPerToken,
      }),
    );
    res.status(200).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Health check with bonding curve info
app.get('/api/status', async (_req, res) => {
  const price = await pumpfun.getPrice(TOKEN_MINT);
  res.json({
    token: TOKEN_SYMBOL,
    mint: TOKEN_MINT,
    price: price?.usdPerToken,
    bondingCurve: price && 'bondingCurve' in price ? price.bondingCurve : null,
  });
});

app.listen(PORT, () => {
  console.log(`\n${TOKEN_SYMBOL}-gated API running on http://localhost:${PORT}`);
  console.log(`  AI endpoint: GET /api/ai/generate ($0.01 in ${TOKEN_SYMBOL})`);
  console.log(`  Status:      GET /api/status`);
  console.log(`\nEvery API call creates buy pressure on the bonding curve.`);
});
