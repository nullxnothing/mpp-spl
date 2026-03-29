/**
 * Autonomous agent that pays for API calls automatically.
 *
 * Uses mppx client to handle 402 challenges transparently.
 * The agent holds SPL tokens and spends them on API requests.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=... npx tsx examples/agent-client.ts
 *
 * Env:
 *   AGENT_PRIVATE_KEY  — base58 private key for the agent's wallet
 *   HELIUS_RPC_URL     — RPC endpoint for transactions
 */

import { Mppx, solana } from '@solana/mpp/client';
import { createKeyPairSignerFromBytes } from '@solana/kit';

// Decode base58 private key to create a signer
const privateKeyBytes = decodeBase58(process.env.AGENT_PRIVATE_KEY!);
const signer = await createKeyPairSignerFromBytes(privateKeyBytes);

console.log(`Agent wallet: ${signer.address}`);

// Create MPP client — handles 402 automatically
const mppx = Mppx.create({
  methods: [
    solana.charge({
      signer,
      rpcUrl: process.env.HELIUS_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
      onProgress: (event) => {
        switch (event.type) {
          case 'challenge':
            console.log(`Payment required: ${event.amount} of ${event.currency} to ${event.recipient}`);
            break;
          case 'signing':
            console.log('Signing transaction...');
            break;
          case 'signed':
            console.log('Transaction signed, sending to server...');
            break;
        }
      },
    }),
  ],
});

// Make a paid API call — 402 is handled transparently
const response = await mppx.fetch('https://api.example.com/api/bonk-data');
const data = await response.json();
console.log('Response:', data);

// Make multiple calls — agent pays each one
for (let i = 0; i < 5; i++) {
  const res = await mppx.fetch('https://api.example.com/api/bonk-data');
  console.log(`Call ${i + 1}:`, res.status, await res.json());
}

// -- Base58 decode helper --
function decodeBase58(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes: number[] = [0];
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of str) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}
