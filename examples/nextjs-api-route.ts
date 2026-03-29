/**
 * Next.js App Router API route with MPP charge gate.
 *
 * File: app/api/paid/route.ts
 *
 * Env:
 *   MPP_SECRET_KEY     — HMAC key
 *   RECIPIENT_PUBKEY   — your Solana wallet
 *   HELIUS_RPC_URL     — Helius RPC (for pump.fun tokens)
 */

import { Mppx, solana } from '@solana/mpp/server';
import { resolveChargeConfig, buildSolanaChargeParams } from 'mpp-spl';

const config = await resolveChargeConfig({
  token: 'BONK',
  recipient: process.env.RECIPIENT_PUBKEY!,
  usdAmount: 0.01,
  jupiterApiKey: process.env.JUPITER_API_KEY,
});

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [
    solana.charge({
      ...buildSolanaChargeParams(config),
      rpcUrl: process.env.HELIUS_RPC_URL,
    }),
  ],
});

export async function GET(request: Request) {
  const result = await mppx.charge({
    amount: config.amount,
    currency: config.currency,
  })(request);

  if (result.status === 402) return result.challenge;

  return result.withReceipt(
    Response.json({
      data: 'This endpoint costs ' + config.displayAmount,
      timestamp: Date.now(),
    }),
  );
}
