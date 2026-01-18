/**
 * End-to-End x402 BOTH PARTIES LIE Demo
 *
 * This demo shows what happens when BOTH parties try to cheat:
 * - Agent underclaims (tries to pay less)
 * - Facilitator overclaims (tries to get more)
 * 
 * Result: CRYPTOGRAPHIC TRUTH WINS!
 * The Merkle proofs + signatures determine the actual settlement.
 *
 * Prerequisites:
 *   pnpm e2e:x402-both-lie (runs everything automatically)
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
  PaymentAuthorization,
  ChannelAuthorization,
  X402_HEADERS,
  serializePaymentAuthorization,
  getChannelAuthorizationDomain,
  CHANNEL_AUTHORIZATION_TYPES,
  getCallAuthorizationDomain,
  CALL_AUTHORIZATION_TYPES,
} from "@x402-prototype/x402";
import { MerkleTree, Call } from "@x402-prototype/merkle";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const AGENT_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const FACILITATOR_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

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
  "function facilitatorDispute(address agent, uint256 counterAmount, bytes32 merkleRoot) external",
  "function submitProofs(address agent, (bytes32 callId, uint256 cost, uint256 timestamp, bytes signature)[] calldata calls, bytes32[][] calldata proofs) external",
  "function finalizeDispute(address agent) external",
  "function getChannel(address agent) view returns ((address agent, address facilitator, address payTo, uint256 balance, uint256 claimedAmount, uint256 disputedAmount, uint256 provenAmount, bytes32 checkpointRoot, uint256 checkpointAmount, uint256 disputeDeadline, uint256 proofDeadline, uint8 status))",
  "function getFacilitatorBond(address facilitator) view returns (uint256)",
]);

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("       🎭 BOTH PARTIES LIE - WHO WINS? 🎭                                   ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();
console.log("  This demo shows what happens when BOTH parties try to cheat!");
console.log("  Agent underclaims → Facilitator overclaims → TRUTH WINS!");
console.log();

async function runBothLieDemo() {
  const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY as Hex);
  const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY as Hex);
  const sessionId = `session-${Date.now()}`;
  let nonce = 0;

  console.log("SETUP");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log(`  Agent:       ${agentAccount.address}`);
  console.log(`  Facilitator: ${facilitatorAccount.address}`);
  console.log(`  Server:      ${SERVER_URL}`);
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

  const facilitatorWallet = createWalletClient({
    account: facilitatorAccount,
    chain: ANVIL_CHAIN,
    transport: http("http://127.0.0.1:8545"),
  });

  // Get initial states
  const initialBond = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getFacilitatorBond",
    args: [FACILITATOR_ADDRESS],
  });

  console.log(`  💰 Initial Facilitator Bond: $${formatUnits(initialBond, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Agent Opens Channel
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 1: Agent Opens Channel (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Fund agent
  await facilitatorWallet.writeContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "mint",
    args: [agentAccount.address, 100_000_000n],
  });

  const depositAmount = 10_000_000n; // $10

  // Approve and deposit
  const approveHash = await agentWallet.writeContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "approve",
    args: [ESCROW_ADDRESS, depositAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const depositHash = await agentWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "deposit",
    args: [FACILITATOR_ADDRESS, FACILITATOR_ADDRESS, depositAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });

  console.log("  ✅ Channel opened");
  console.log(`     Balance: $${formatUnits(depositAmount, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Make API Calls via x402 Protocol
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 2: Make API Calls via x402 Protocol");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const merkleTree = new MerkleTree();
  const calls: Call[] = [];
  let actualTotalCost = 0n;

  const endpoints = ["/api/weather", "/api/data", "/api/premium"];
  
  for (let i = 0; i < 5; i++) {
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
      const callId = result.receipt.callId as Hex;
      const callCost = BigInt(result.receipt.cost);
      const callTimestamp = result.receipt.timestamp;

      // Sign the call authorization for on-chain proof
      const callSignature = await agentWallet.signTypedData({
        domain: getCallAuthorizationDomain(ANVIL_CHAIN.id, ESCROW_ADDRESS),
        types: CALL_AUTHORIZATION_TYPES,
        primaryType: "CallAuthorization",
        message: {
          callId,
          cost: callCost,
          timestamp: BigInt(callTimestamp),
          escrow: ESCROW_ADDRESS,
        },
      });

      const call: Call = {
        callId,
        cost: callCost,
        timestamp: callTimestamp,
        signature: callSignature,
      };
      calls.push(call);
      merkleTree.addCall(call);
      actualTotalCost += call.cost;
      console.log(`  Call ${i + 1}: ${endpoint} → $${formatUnits(call.cost, 6)}`);
    }
  }

  console.log();
  console.log(`  ═══════════════════════════════════════════════════════════════════════`);
  console.log(`  📊 ACTUAL USAGE (CRYPTOGRAPHIC TRUTH): $${formatUnits(actualTotalCost, 6)}`);
  console.log(`  ═══════════════════════════════════════════════════════════════════════`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: BOTH PARTIES LIE!
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 3: BOTH PARTIES DECIDE TO LIE!");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Agent wants to underclaim (pay less)
  const agentLie = actualTotalCost / 2n; // Claims half
  // Facilitator wants to overclaim (get more)
  const facilitatorLie = actualTotalCost * 3n; // Claims 3x

  console.log(`  🎭 THE LIES:`);
  console.log(`     ─────────────────────────────────────────────────────────────────────`);
  console.log(`     TRUTH (signed calls):    $${formatUnits(actualTotalCost, 6)}`);
  console.log(`     ─────────────────────────────────────────────────────────────────────`);
  console.log(`     Agent's LIE:             $${formatUnits(agentLie, 6)} (underclaim by $${formatUnits(actualTotalCost - agentLie, 6)})`);
  console.log(`     Facilitator's LIE:       $${formatUnits(facilitatorLie, 6)} (overclaim by $${formatUnits(facilitatorLie - actualTotalCost, 6)})`);
  console.log(`     ─────────────────────────────────────────────────────────────────────`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Agent Initiates Close with UNDERCLAIM
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 4: Agent Initiates Close with UNDERCLAIM (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log(`  🤥 Agent claims: $${formatUnits(agentLie, 6)} (should be $${formatUnits(actualTotalCost, 6)})`);
  console.log();

  const initiateCloseHash = await agentWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "initiateClose",
    args: [agentLie, merkleTree.getRoot()],
  });
  await publicClient.waitForTransactionReceipt({ hash: initiateCloseHash });

  console.log(`  ✅ Agent's underclaim submitted`);
  console.log(`     TX: ${initiateCloseHash.slice(0, 22)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Facilitator Disputes with OVERCLAIM
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 5: Facilitator Disputes with OVERCLAIM (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log(`  🤥 Facilitator counter-claims: $${formatUnits(facilitatorLie, 6)} (should be $${formatUnits(actualTotalCost, 6)})`);
  console.log(`  📋 Facilitator is ALSO lying - trying to get more than actual!`);
  console.log();

  const disputeHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "facilitatorDispute",
    args: [agentAccount.address, facilitatorLie, merkleTree.getRoot()],
  });
  await publicClient.waitForTransactionReceipt({ hash: disputeHash });

  console.log(`  ✅ Facilitator's overclaim dispute submitted`);
  console.log(`     TX: ${disputeHash.slice(0, 22)}...`);
  console.log();

  // Check channel status
  const channelAfterDispute = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log("  📋 Channel Status (Both Lying!):");
  console.log(`     status:          DISPUTED (${channelAfterDispute.status})`);
  console.log(`     claimedAmount:   $${formatUnits(channelAfterDispute.claimedAmount, 6)} (agent's lie)`);
  console.log(`     disputedAmount:  $${formatUnits(channelAfterDispute.disputedAmount, 6)} (facilitator's lie)`);
  console.log(`     ACTUAL:          $${formatUnits(actualTotalCost, 6)} (truth)`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Facilitator Submits Proofs (CAN ONLY PROVE TRUTH!)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 6: Facilitator Submits Proofs (TRUTH EMERGES!)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log(`  🔒 Facilitator CLAIMED: $${formatUnits(facilitatorLie, 6)}`);
  console.log(`  🔒 Facilitator can only PROVE: $${formatUnits(actualTotalCost, 6)}`);
  console.log(`  🔒 Because agent only SIGNED: $${formatUnits(actualTotalCost, 6)} worth of calls!`);
  console.log();

  // Build call data structs and proofs
  const callDataStructs: { callId: Hex; cost: bigint; timestamp: bigint; signature: Hex }[] = [];
  const proofs: Hex[][] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    callDataStructs.push({
      callId: call.callId as Hex,
      cost: call.cost,
      timestamp: BigInt(call.timestamp),
      signature: call.signature!,
    });
    proofs.push(merkleTree.getProof(i));
    console.log(`  Proof for call ${call.callId.slice(0, 10)}... → $${formatUnits(call.cost, 6)}`);
  }

  console.log();

  const submitProofsHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "submitProofs",
    args: [agentAccount.address, callDataStructs, proofs],
  });
  await publicClient.waitForTransactionReceipt({ hash: submitProofsHash });

  console.log(`  ✅ Proofs submitted - TRUTH revealed!`);
  console.log(`     TX: ${submitProofsHash.slice(0, 22)}...`);
  console.log();

  // Check proven amount
  const channelAfterProofs = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log("  📋 PROOF RESULTS (Truth vs Lies):");
  console.log(`     ─────────────────────────────────────────────────────────────────────`);
  console.log(`     Agent claimed:       $${formatUnits(channelAfterProofs.claimedAmount, 6)} ❌ LIE`);
  console.log(`     Facilitator claimed: $${formatUnits(channelAfterProofs.disputedAmount, 6)} ❌ LIE`);
  console.log(`     PROVEN (TRUTH):      $${formatUnits(channelAfterProofs.provenAmount, 6)} ✅`);
  console.log(`     ─────────────────────────────────────────────────────────────────────`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Finalize Dispute - BOTH LIARS EXPOSED!
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 7: Finalize Dispute - JUSTICE!");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Fast forward time past proof deadline
  console.log("  ⏰ Fast forwarding time past proof deadline...");
  await publicClient.request({
    method: "evm_increaseTime" as any,
    params: [86400 * 6], // 6 days
  });
  await publicClient.request({
    method: "evm_mine" as any,
    params: [],
  });

  // Get balances before finalization
  const agentBalanceBefore = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [agentAccount.address],
  });

  const finalizeHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "finalizeDispute",
    args: [agentAccount.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: finalizeHash });

  console.log(`  ✅ Dispute finalized - TRUTH WINS!`);
  console.log(`     TX: ${finalizeHash.slice(0, 22)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: Final Analysis - WHO GOT PUNISHED?
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 8: Final Analysis - WHO GOT PUNISHED?");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const channelFinal = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  const finalBond = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getFacilitatorBond",
    args: [FACILITATOR_ADDRESS],
  });

  const facilitatorBalanceAfter = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [FACILITATOR_ADDRESS],
  });

  const agentBalanceAfter = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [agentAccount.address],
  });

  // Calculate what happened
  const provenAmount = channelAfterProofs.provenAmount;
  const agentUnderclaim = provenAmount - agentLie;
  const agentPenalty = agentUnderclaim / 10n; // 10% penalty
  const facilitatorOverclaim = facilitatorLie - provenAmount;
  
  // In this case, facilitator disputed agent's underclaim
  // So agent pays proven amount + penalty
  const agentPaid = provenAmount + agentPenalty;

  console.log("  ═══════════════════════════════════════════════════════════════════════");
  console.log("  📊 THE LIES:");
  console.log("  ═══════════════════════════════════════════════════════════════════════");
  console.log(`     Agent lied by:       $${formatUnits(agentUnderclaim, 6)} (underclaim)`);
  console.log(`     Facilitator lied by: $${formatUnits(facilitatorOverclaim, 6)} (overclaim)`);
  console.log();
  console.log("  ═══════════════════════════════════════════════════════════════════════");
  console.log("  ⚖️  THE JUDGMENT:");
  console.log("  ═══════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  🔴 AGENT'S PUNISHMENT (for underclaiming):");
  console.log(`     Tried to pay:        $${formatUnits(agentLie, 6)}`);
  console.log(`     Actually owed:       $${formatUnits(provenAmount, 6)}`);
  console.log(`     Penalty (10%):       $${formatUnits(agentPenalty, 6)}`);
  console.log(`     TOTAL PAID:          $${formatUnits(agentPaid, 6)}`);
  console.log();
  console.log("  🟠 FACILITATOR'S SITUATION:");
  console.log(`     Tried to claim:      $${formatUnits(facilitatorLie, 6)}`);
  console.log(`     Could only prove:    $${formatUnits(provenAmount, 6)}`);
  console.log(`     Received:            $${formatUnits(agentPaid, 6)} (proven + agent penalty)`);
  console.log();
  console.log("  💰 FINAL BALANCES:");
  console.log(`     Facilitator:         $${formatUnits(facilitatorBalanceAfter, 6)} USDC`);
  console.log(`     Agent:               $${formatUnits(agentBalanceAfter, 6)} USDC`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                    🎭 BOTH LIARS EXPOSED! 🎭                               ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  WHAT HAPPENED:");
  console.log(`    1. Agent made ${calls.length} API calls worth $${formatUnits(actualTotalCost, 6)}`);
  console.log(`    2. Agent LIED: claimed only $${formatUnits(agentLie, 6)}`);
  console.log(`    3. Facilitator LIED: counter-claimed $${formatUnits(facilitatorLie, 6)}`);
  console.log(`    4. Proofs revealed TRUTH: $${formatUnits(provenAmount, 6)}`);
  console.log();
  console.log("  THE VERDICT:");
  console.log(`    ❌ Agent caught underclaiming → PENALIZED $${formatUnits(agentPenalty, 6)}`);
  console.log(`    ❌ Facilitator couldn't prove overclaim → Got only what was proven`);
  console.log(`    ✅ TRUTH determined settlement: $${formatUnits(provenAmount, 6)}`);
  console.log();
  console.log("  KEY INSIGHT:");
  console.log("    ┌─────────────────────────────────────────────────────────────────────┐");
  console.log("    │  No matter what either party CLAIMS, the cryptographic proofs      │");
  console.log("    │  determine the TRUTH. Lying is always a losing strategy!           │");
  console.log("    └─────────────────────────────────────────────────────────────────────┘");
  console.log();
  console.log("  GAME THEORY:");
  console.log("    → If you tell the truth, you pay/receive the correct amount");
  console.log("    → If you lie, you get PUNISHED");
  console.log("    → The Nash Equilibrium is HONESTY!");
  console.log();
}

runBothLieDemo().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
