/**
 * Express server gated with MPP — accepts BONK, WIF, USDC, or a pump.fun token.
 *
 * Usage:
 *   npx tsx examples/express-server.ts
 *
 * Env:
 *   MPP_SECRET_KEY     — any random string (HMAC key for challenge binding)
 *   RECIPIENT_PUBKEY   — your Solana wallet
 *   HELIUS_RPC_URL     — Helius RPC (required for pump.fun tokens)
 *   JUPITER_API_KEY    — optional, recommended
 */

import express from 'express';
import { Mppx, solana } from '@solana/mpp/server';
import {
  resolveChargeConfig,
  buildSolanaChargeParams,
  registerToken,
} from 'mpp-spl';

const app = express();
const PORT = 3000;

const RECIPIENT = process.env.RECIPIENT_PUBKEY!;
const HELIUS_RPC = process.env.HELIUS_RPC_URL;
const JUPITER_KEY = process.env.JUPITER_API_KEY;

// ── 1. BONK-gated endpoint ($0.01 per request) ──

const bonkConfig = await resolveChargeConfig({
  token: 'BONK',
  recipient: RECIPIENT,
  usdAmount: 0.01,
  jupiterApiKey: JUPITER_KEY,
});

const bonkMppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [solana.charge({
    ...buildSolanaChargeParams(bonkConfig),
    rpcUrl: HELIUS_RPC,
  })],
});

app.get('/api/bonk-data', async (req, res) => {
  const result = await bonkMppx.charge({
    amount: bonkConfig.amount,
    currency: bonkConfig.currency,
  })(req as unknown as Request);

  if (result.status === 402) {
    res.status(402).json(result.challenge);
    return;
  }

  const response = result.withReceipt(
    Response.json({ message: 'Paid with BONK!', price: bonkConfig.displayAmount }),
  );
  res.status(200).json(await response.json());
});

// ── 2. USDC flat-rate endpoint (1 USDC) ──

const usdcConfig = await resolveChargeConfig({
  token: 'USDC',
  recipient: RECIPIENT,
  tokenAmount: '1000000', // 1 USDC (6 decimals)
});

const usdcMppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [solana.charge(buildSolanaChargeParams(usdcConfig))],
});

app.get('/api/premium', async (req, res) => {
  const result = await usdcMppx.charge({
    amount: usdcConfig.amount,
    currency: usdcConfig.currency,
  })(req as unknown as Request);

  if (result.status === 402) {
    res.status(402).json(result.challenge);
    return;
  }

  const response = result.withReceipt(
    Response.json({ message: 'Premium content unlocked', price: '1.00 USDC' }),
  );
  res.status(200).json(await response.json());
});

// ── 3. Pump.fun token endpoint (dynamic pricing) ──

// Register your pump.fun token at runtime
registerToken({
  symbol: 'MYTOKEN',
  name: 'My Pump Token',
  mint: 'YourMintAddressHere...',
  decimals: 6,
  program: 'spl',
});

app.get('/api/pumpfun-gated', async (req, res) => {
  // Dynamic: re-resolves bonding curve price on every request
  try {
    const config = await resolveChargeConfig({
      token: 'MYTOKEN',
      recipient: RECIPIENT,
      usdAmount: 0.01,
      heliusRpcUrl: HELIUS_RPC,
      jupiterApiKey: JUPITER_KEY,
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
    })(req as unknown as Request);

    if (result.status === 402) {
      res.status(402).json(result.challenge);
      return;
    }

    const response = result.withReceipt(
      Response.json({ message: 'Paid with your pump.fun token!', price: config.displayAmount }),
    );
    res.status(200).json(await response.json());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`MPP server running on http://localhost:${PORT}`);
  console.log(`  BONK endpoint:    GET /api/bonk-data (${bonkConfig.displayAmount})`);
  console.log(`  USDC endpoint:    GET /api/premium (1.00 USDC)`);
  console.log(`  PumpFun endpoint: GET /api/pumpfun-gated ($0.01 in MYTOKEN)`);
});
