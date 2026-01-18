/**
 * x402 Flow Demo
 *
 * Demonstrates the complete x402 channel payment flow:
 * 1. Agent requests resource → Server returns 402
 * 2. Agent opens channel on-chain
 * 3. Agent retries with payment authorization
 * 4. Server verifies channel and returns resource
 * 5. Settlement with Merkle proofs
 */

import { MerkleTree, Call, createCheckpoint } from "@x402-prototype/merkle";
import {
  PaymentRequirement,
  PaymentAuthorization,
  ChannelAuthorization,
  X402_HEADERS,
  createChannelPaymentRequirement,
  serializePaymentAuthorization,
  cronosTestnet,
} from "@x402-prototype/x402";

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("               x402 CHANNEL SCHEME - COMPLETE FLOW DEMO                     ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();
console.log("  Network: Cronos Testnet (Chain ID: 338)");
console.log("  Scheme:  channel (proposed x402 extension)");
console.log();

async function runX402FlowDemo() {
  const agentAddress = "0xAI_AGENT_ADDRESS_1234567890123456789012345678" as const;
  const facilitatorAddress = "0xFACILITATOR_ADDRESS_12345678901234567890" as const;
  const escrowAddress = "0xESCROW_CONTRACT_ADDRESS_123456789012345678" as const;
  const usdcAddress = "0xUSDC_ADDRESS_1234567890123456789012345678901" as const;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: AI Agent requests resource (no payment)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 1: AI Agent Requests Resource");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();
  console.log("  → Agent: GET /api/weather");
  console.log("  ← Server: HTTP 402 Payment Required");
  console.log();

  // Simulate 402 response with payment requirement
  const paymentRequirement = createChannelPaymentRequirement({
    chainId: cronosTestnet.id,
    network: "cronos-testnet",
    payTo: facilitatorAddress,
    asset: usdcAddress,
    maxAmount: 10_000n, // $0.01
    escrowAddress,
    facilitatorAddress,
    description: "Payment required for /api/weather",
  });

  console.log("  Payment Requirement:");
  console.log(`    x402Version: ${paymentRequirement.x402Version}`);
  console.log(`    scheme:      ${paymentRequirement.scheme}`);
  console.log(`    network:     ${paymentRequirement.network}`);
  console.log(`    chainId:     ${paymentRequirement.chainId}`);
  console.log(`    maxAmount:   $${Number(BigInt(paymentRequirement.maxAmount)) / 1_000_000}`);
  console.log(`    asset:       ${paymentRequirement.asset.slice(0, 10)}...`);
  console.log(`    escrow:      ${paymentRequirement.extra?.escrowAddress.slice(0, 10)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Agent opens channel on-chain
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 2: Agent Opens Channel On-Chain");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();
  console.log("  Agent sees 402 → Checks if channel exists → Opens new channel");
  console.log();
  console.log("  On-Chain Transaction:");
  console.log("    → approve(escrow, $10)");
  console.log("    → deposit(facilitator, payTo, $10)");
  console.log();
  console.log("  Channel State:");
  console.log("    status:      ACTIVE");
  console.log("    balance:     $10.00");
  console.log("    facilitator: 0xFACILI...");
  console.log("    payTo:       0xFACILI...");
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Agent retries with payment authorization
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 3: Agent Retries with Payment Authorization");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const sessionId = `session-${Date.now()}`;
  const nonce = 1;
  const timestamp = Math.floor(Date.now() / 1000);

  // Simulate signed authorization
  const channelAuth: ChannelAuthorization = {
    scheme: "channel",
    escrowAddress,
    sessionId,
    nonce,
    timestamp,
  };

  const paymentAuth: PaymentAuthorization = {
    x402Version: 1,
    scheme: "channel",
    agentAddress,
    signature: "0xSIGNED_EIP712_AUTHORIZATION..." as `0x${string}`,
    authorization: channelAuth,
  };

  console.log("  → Agent: GET /api/weather");
  console.log(`    Header: ${X402_HEADERS.PAYMENT}`);
  console.log();
  console.log("  Payment Authorization:");
  console.log(`    x402Version: ${paymentAuth.x402Version}`);
  console.log(`    scheme:      ${paymentAuth.scheme}`);
  console.log(`    agentAddress: ${agentAddress.slice(0, 12)}...`);
  console.log(`    sessionId:   ${sessionId.slice(0, 20)}...`);
  console.log(`    nonce:       ${nonce}`);
  console.log(`    signature:   EIP-712 typed data signature`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Server verifies and returns resource
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 4: Server Verifies and Returns Resource");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();
  console.log("  Server Verification Steps:");
  console.log("    1. Parse X-Payment header           ✓");
  console.log("    2. Verify EIP-712 signature         ✓");
  console.log("    3. Check channel exists on-chain    ✓");
  console.log("    4. Verify channel.status = ACTIVE   ✓");
  console.log("    5. Verify channel.balance >= cost   ✓");
  console.log("    6. Check nonce > lastNonce          ✓");
  console.log();
  console.log("  ← Server: HTTP 200 OK");
  console.log();

  // Simulate response
  const callId = `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join("")}`;
  const cost = 10_000n;

  console.log("  Response Body:");
  console.log("    {");
  console.log('      "data": { "temperature": 25, "humidity": 60, "condition": "sunny" },');
  console.log('      "receipt": {');
  console.log(`        "callId": "${callId.slice(0, 18)}...",`);
  console.log('        "endpoint": "/api/weather",');
  console.log('        "cost": "10000",');
  console.log(`        "timestamp": ${timestamp},`);
  console.log('        "serverSignature": "0xSERVER_SIGNATURE..."');
  console.log("      }");
  console.log("    }");
  console.log();
  console.log(`  Header: ${X402_HEADERS.PAYMENT_RECEIPT}: { callId, cost, ... }`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Multiple calls tracked in Merkle tree
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 5: Multiple Calls Tracked in Merkle Tree");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const merkleTree = new MerkleTree();
  const calls: Call[] = [];
  let totalCost = 0n;

  // Simulate 50 calls
  for (let i = 0; i < 50; i++) {
    const call: Call = {
      callId: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      cost: 10_000n,
      timestamp: timestamp + i,
    };
    calls.push(call);
    merkleTree.addCall(call);
    totalCost += call.cost;
  }

  console.log("  Calls made: 50");
  console.log(`  Total cost: $${Number(totalCost) / 1_000_000}`);
  console.log();

  const checkpoint = createCheckpoint(merkleTree, totalCost, 50);
  console.log("  📍 Checkpoint Created:");
  console.log(`     Root:  ${checkpoint.root.slice(0, 18)}...`);
  console.log(`     Total: $${Number(checkpoint.totalCost) / 1_000_000}`);
  console.log(`     Calls: ${checkpoint.callCount}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Settlement
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 6: Settlement");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();
  console.log("  Agent initiates close:");
  console.log("    → initiateClose($0.50, merkleRoot)");
  console.log();
  console.log("  After 7-day dispute window (no dispute):");
  console.log("    → confirmClose()");
  console.log();
  console.log("  Settlement:");
  console.log("    → Server receives: $0.50");
  console.log("    → Agent refunded:  $9.50");
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                          x402 CHANNEL FLOW SUMMARY                         ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  Standard x402 Compliance:");
  console.log("    ✅ HTTP 402 Payment Required response");
  console.log("    ✅ Payment requirement in header/body");
  console.log("    ✅ X-Payment authorization header");
  console.log("    ✅ EIP-712 typed data signatures");
  console.log("    ✅ On-chain channel verification");
  console.log("    ✅ Replay protection (nonces)");
  console.log();
  console.log("  Channel Scheme Benefits:");
  console.log("    ✅ Single deposit → Many API calls");
  console.log("    ✅ ~98% gas savings vs per-call payments");
  console.log("    ✅ Merkle proof dispute resolution");
  console.log("    ✅ Facilitator bond slashing");
  console.log("    ✅ Checkpoint-based batching");
  console.log();
  console.log("  Network: Cronos EVM Compatible");
  console.log("    Chain ID:     338 (testnet) / 25 (mainnet)");
  console.log("    Token:        USDC");
  console.log("    Settlement:   Optimistic with proofs");
  console.log();
}

runX402FlowDemo().catch(console.error);
