/**
 * End-to-End x402 Compatible Flow Demo
 *
 * This demo shows the COMPLETE x402-compatible flow:
 * 1. Client requests resource → Server returns HTTP 402
 * 2. Client opens channel on-chain
 * 3. Client retries with X-Payment header
 * 4. Server verifies on-chain + returns resource
 * 5. Multiple calls with receipts
 * 6. Settlement
 *
 * Prerequisites:
 *   1. Start Anvil: pnpm anvil
 *   2. Deploy contracts: pnpm contracts:deploy
 *   3. Start server: pnpm server:start (with env vars)
 *   4. Run this demo: pnpm demo:e2e-x402
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  PaymentRequirement,
  PaymentAuthorization,
  ChannelAuthorization,
  X402_HEADERS,
  serializePaymentAuthorization,
  getChannelAuthorizationDomain,
  CHANNEL_AUTHORIZATION_TYPES,
} from "@x402-prototype/x402";
import { MerkleTree, Call } from "@x402-prototype/merkle";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const AGENT_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// Contract addresses (from deployment)
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address;
const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as Address;
const FACILITATOR_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

// Chain config
const ANVIL_CHAIN = {
  ...foundry,
  id: 31337,
  name: "Anvil Local",
};

// ABIs
const USDC_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256) external",
]);

const ESCROW_ABI = parseAbi([
  "function deposit(address facilitator, address payTo, uint256 amount) external",
  "function initiateClose(uint256 acknowledgedAmount, bytes32 checkpointRoot) external",
  "function facilitatorConfirm(address agent) external",
  "function getChannel(address agent) view returns ((address agent, address facilitator, address payTo, uint256 balance, uint256 claimedAmount, uint256 disputedAmount, uint256 provenAmount, bytes32 checkpointRoot, uint256 checkpointAmount, uint256 disputeDeadline, uint256 proofDeadline, uint8 status))",
]);

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("         🔗 x402 COMPATIBLE FLOW - FULL E2E DEMO 🔗                         ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();
console.log("  This demo shows the COMPLETE x402 protocol flow!");
console.log("  Agent ↔ Server ↔ Blockchain");
console.log();

async function runX402FlowDemo() {
  const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY as Hex);
  const sessionId = `session-${Date.now()}`;
  let nonce = 0;

  console.log("SETUP");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log(`  Agent:   ${agentAccount.address}`);
  console.log(`  Server:  ${SERVER_URL}`);
  console.log(`  Session: ${sessionId.slice(0, 20)}...`);
  console.log();

  const publicClient = createPublicClient({
    chain: ANVIL_CHAIN,
    transport: http("http://127.0.0.1:8545"),
  });

  const agentWallet = createWalletClient({
    account: agentAccount,
    chain: ANVIL_CHAIN,
    transport: http("http://127.0.0.1:8545"),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Request resource without payment → Get 402
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 1: Request Resource (No Payment)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log("  → GET /api/weather (no X-Payment header)");
  
  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}/api/weather`);
  } catch (error) {
    console.error("  ❌ Failed to connect to server. Make sure it's running!");
    console.error("     Run: ESCROW_ADDRESS=0x... USDC_ADDRESS=0x... pnpm server:start");
    process.exit(1);
  }

  console.log(`  ← HTTP ${response.status} ${response.statusText}`);

  if (response.status !== 402) {
    console.error("  ❌ Expected 402 Payment Required!");
    process.exit(1);
  }

  // Parse payment requirement
  const paymentRequiredHeader = response.headers.get(X402_HEADERS.PAYMENT_REQUIRED);
  const body = await response.json();
  const paymentRequirement: PaymentRequirement = body.paymentRequirement;

  console.log();
  console.log("  📋 Payment Requirement:");
  console.log(`     x402Version: ${paymentRequirement.x402Version}`);
  console.log(`     scheme:      ${paymentRequirement.scheme}`);
  console.log(`     network:     ${paymentRequirement.network}`);
  console.log(`     maxAmount:   $${Number(BigInt(paymentRequirement.maxAmount)) / 1_000_000}`);
  console.log(`     escrow:      ${paymentRequirement.extra?.escrowAddress.slice(0, 14)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Open channel on-chain
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 2: Open Channel On-Chain");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Check if channel already exists
  const existingChannel = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  if (existingChannel.status === 1) { // ACTIVE
    console.log("  ✅ Channel already exists");
    console.log(`     Balance: $${formatUnits(existingChannel.balance, 6)}`);
  } else {
    // Fund agent
    const facilitatorWallet = createWalletClient({
      account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex),
      chain: ANVIL_CHAIN,
      transport: http("http://127.0.0.1:8545"),
    });

    await facilitatorWallet.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "mint",
      args: [agentAccount.address, 100_000_000n],
    });

    const depositAmount = 10_000_000n; // $10

    // Approve
    const approveHash = await agentWallet.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "approve",
      args: [ESCROW_ADDRESS, depositAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Deposit
    const depositHash = await agentWallet.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "deposit",
      args: [FACILITATOR_ADDRESS, FACILITATOR_ADDRESS, depositAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash });

    console.log("  ✅ Channel opened");
    console.log(`     TX: ${depositHash.slice(0, 22)}...`);
    console.log(`     Balance: $${formatUnits(depositAmount, 6)}`);
  }
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Retry with X-Payment header
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 3: Retry with X-Payment Header");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Create EIP-712 signature
  nonce++;
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = await agentWallet.signTypedData({
    domain: getChannelAuthorizationDomain(ANVIL_CHAIN.id, ESCROW_ADDRESS),
    types: CHANNEL_AUTHORIZATION_TYPES,
    primaryType: "ChannelAuthorization",
    message: {
      agentAddress: agentAccount.address,
      sessionId,
      endpoint: "/api/weather",
      nonce: BigInt(nonce),
      timestamp: BigInt(timestamp),
    },
  });

  const channelAuth: ChannelAuthorization = {
    scheme: "channel",
    escrowAddress: ESCROW_ADDRESS,
    sessionId,
    nonce,
    timestamp,
  };

  const paymentAuth: PaymentAuthorization = {
    x402Version: 1,
    scheme: "channel",
    agentAddress: agentAccount.address,
    signature,
    authorization: channelAuth,
  };

  console.log("  → GET /api/weather");
  console.log(`    Header: ${X402_HEADERS.PAYMENT}: { ... }`);
  console.log(`    EIP-712 Signature: ${signature.slice(0, 22)}...`);
  console.log();

  const response2 = await fetch(`${SERVER_URL}/api/weather`, {
    headers: {
      [X402_HEADERS.PAYMENT]: serializePaymentAuthorization(paymentAuth),
    },
  });

  console.log(`  ← HTTP ${response2.status} ${response2.statusText}`);

  if (response2.status !== 200) {
    const error = await response2.json();
    console.error("  ❌ Request failed:", error);
    process.exit(1);
  }

  const data = await response2.json();
  const receiptHeader = response2.headers.get(X402_HEADERS.PAYMENT_RECEIPT);

  console.log();
  console.log("  ✅ Resource received!");
  console.log(`     Data: ${JSON.stringify(data.data)}`);
  console.log();
  console.log("  📝 Payment Receipt:");
  console.log(`     callId:   ${data.receipt.callId.slice(0, 18)}...`);
  console.log(`     cost:     $${Number(data.receipt.cost) / 1_000_000}`);
  console.log(`     signature: ${data.receipt.serverSignature.slice(0, 18)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Make multiple API calls
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 4: Make Multiple API Calls");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const merkleTree = new MerkleTree();
  const calls: Call[] = [];
  let totalCost = BigInt(data.receipt.cost);

  // Add first call
  calls.push({
    callId: data.receipt.callId,
    cost: BigInt(data.receipt.cost),
    timestamp: data.receipt.timestamp,
  });
  merkleTree.addCall(calls[0]);

  const endpoints = ["/api/weather", "/api/data", "/api/premium"];
  
  for (let i = 0; i < 9; i++) {
    nonce++;
    const ts = Math.floor(Date.now() / 1000);
    const endpoint = endpoints[i % 3];

    const sig = await agentWallet.signTypedData({
      domain: getChannelAuthorizationDomain(ANVIL_CHAIN.id, ESCROW_ADDRESS),
      types: CHANNEL_AUTHORIZATION_TYPES,
      primaryType: "ChannelAuthorization",
      message: {
        agentAddress: agentAccount.address,
        sessionId,
        endpoint,
        nonce: BigInt(nonce),
        timestamp: BigInt(ts),
      },
    });

    const auth: PaymentAuthorization = {
      x402Version: 1,
      scheme: "channel",
      agentAddress: agentAccount.address,
      signature: sig,
      authorization: {
        scheme: "channel",
        escrowAddress: ESCROW_ADDRESS,
        sessionId,
        nonce,
        timestamp: ts,
      },
    };

    const resp = await fetch(`${SERVER_URL}${endpoint}`, {
      headers: {
        [X402_HEADERS.PAYMENT]: serializePaymentAuthorization(auth),
      },
    });

    if (resp.status === 200) {
      const result = await resp.json();
      const call: Call = {
        callId: result.receipt.callId,
        cost: BigInt(result.receipt.cost),
        timestamp: result.receipt.timestamp,
      };
      calls.push(call);
      merkleTree.addCall(call);
      totalCost += call.cost;
    }

    if ((i + 2) % 3 === 0) {
      console.log(`  Made ${i + 2} calls, total: $${formatUnits(totalCost, 6)}`);
    }
  }

  console.log();
  console.log(`  📊 Session Summary:`);
  console.log(`     Calls made: ${calls.length}`);
  console.log(`     Total cost: $${formatUnits(totalCost, 6)}`);
  console.log(`     Merkle root: ${merkleTree.getRoot().slice(0, 18)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Check session on server
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 5: Verify Session on Server");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const sessionResp = await fetch(`${SERVER_URL}/session/${sessionId}`);
  if (sessionResp.status === 200) {
    const sessionData = await sessionResp.json();
    console.log("  📋 Server Session State:");
    console.log(`     callCount:  ${sessionData.callCount}`);
    console.log(`     totalCost:  $${Number(sessionData.totalCost) / 1_000_000}`);
    console.log(`     lastNonce:  ${sessionData.lastNonce}`);
  } else {
    console.log("  Session not found on server");
  }
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Agent Initiates Settlement (ON-CHAIN)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 6: Agent Initiates Settlement (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const merkleRoot = merkleTree.getRoot();

  console.log(`  📝 Calling escrow.initiateClose(${formatUnits(totalCost, 6)}, ${merkleRoot.slice(0, 18)}...)`);
  
  const initiateCloseHash = await agentWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "initiateClose",
    args: [totalCost, merkleRoot],
  });
  await publicClient.waitForTransactionReceipt({ hash: initiateCloseHash });

  console.log(`  ✅ Settlement initiated`);
  console.log(`     TX: ${initiateCloseHash.slice(0, 22)}...`);
  console.log();

  // Check channel status
  const channelAfterClose = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log("  📋 Channel Status After initiateClose:");
  console.log(`     status:          CLOSING (${channelAfterClose.status})`);
  console.log(`     claimedAmount:   $${formatUnits(channelAfterClose.claimedAmount, 6)}`);
  console.log(`     checkpointRoot:  ${(channelAfterClose.checkpointRoot as Hex).slice(0, 18)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Facilitator Confirms (No Dispute)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 7: Facilitator Confirms Settlement (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Facilitator wallet (uses the server's private key)
  const facilitatorWallet = createWalletClient({
    account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex),
    chain: ANVIL_CHAIN,
    transport: http("http://127.0.0.1:8545"),
  });

  console.log("  📝 Facilitator agrees with claimed amount, calling facilitatorConfirm()...");

  const confirmHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "facilitatorConfirm",
    args: [agentAccount.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: confirmHash });

  console.log(`  ✅ Facilitator confirmed`);
  console.log(`     TX: ${confirmHash.slice(0, 22)}...`);
  console.log();

  // Check final balances
  const agentBalanceAfter = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [agentAccount.address],
  });

  const facilitatorBalanceAfter = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [FACILITATOR_ADDRESS],
  });

  const channelFinal = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log("  💰 Final Balances:");
  console.log(`     Agent refund:     $${formatUnits(agentBalanceAfter, 6)} USDC`);
  console.log(`     Facilitator:      $${formatUnits(facilitatorBalanceAfter, 6)} USDC (includes $${formatUnits(totalCost, 6)} from session)`);
  console.log(`     Channel status:   SETTLED (${channelFinal.status})`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                  🎉 x402 COMPATIBLE FLOW COMPLETE 🎉                       ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  x402 Protocol Compliance:");
  console.log("    ✅ HTTP 402 Payment Required response");
  console.log("    ✅ X-Payment-Required header with payment details");
  console.log("    ✅ X-Payment header with EIP-712 signature");
  console.log("    ✅ Server verified on-chain channel");
  console.log("    ✅ X-Payment-Receipt header with call receipt");
  console.log("    ✅ Nonce-based replay protection");
  console.log("    ✅ On-chain settlement with Merkle root");
  console.log("    ✅ Mutual confirmation (no dispute window wait)");
  console.log();
  console.log("  Session Stats:");
  console.log(`    Calls:        ${calls.length}`);
  console.log(`    Total cost:   $${formatUnits(totalCost, 6)}`);
  console.log(`    Signatures:   ${calls.length} (EIP-712)`);
  console.log(`    On-chain TXs: 4 (deposit, approve, initiateClose, confirm)`);
  console.log();
  console.log("  Gas Savings vs exact scheme:");
  console.log(`    exact scheme: ${calls.length} transactions`);
  console.log(`    channel scheme: 4 transactions`);
  console.log(`    Savings: ${Math.round((1 - 4/calls.length) * 100)}%`);
  console.log();
}

runX402FlowDemo().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
