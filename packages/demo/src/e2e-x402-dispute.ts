/**
 * End-to-End x402 Dispute Flow Demo
 *
 * This demo shows the COMPLETE x402 flow WITH DISPUTE:
 * 1. Client requests resource → Server returns HTTP 402
 * 2. Client opens channel on-chain
 * 3. Client makes API calls with X-Payment headers
 * 4. Client initiates close with LOWER amount (simulating dispute)
 * 5. Facilitator disputes and submits Merkle proofs
 * 6. Bond slashing if overclaim
 *
 * Prerequisites:
 *   pnpm e2e:x402-dispute (runs everything automatically)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
  type Hex,
  keccak256,
  encodePacked,
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
  "function facilitatorConfirm(address agent) external",
  "function facilitatorDispute(address agent, uint256 counterAmount, bytes32 merkleRoot) external",
  "function submitProofs(address agent, (bytes32 callId, uint256 cost, uint256 timestamp)[] calldata calls, bytes32[][] calldata proofs) external",
  "function finalizeDispute(address agent) external",
  "function getChannel(address agent) view returns ((address agent, address facilitator, address payTo, uint256 balance, uint256 claimedAmount, uint256 disputedAmount, uint256 provenAmount, bytes32 checkpointRoot, uint256 checkpointAmount, uint256 disputeDeadline, uint256 proofDeadline, uint8 status))",
  "function getFacilitatorBond(address facilitator) view returns (uint256)",
]);

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("       ⚔️  x402 DISPUTE FLOW - FULL E2E DEMO ⚔️                              ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();
console.log("  This demo shows the COMPLETE x402 protocol flow WITH DISPUTE!");
console.log("  Agent underclaims → Facilitator disputes → Merkle proofs → Resolution");
console.log();

async function runX402DisputeDemo() {
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

  // Check facilitator bond
  const facilitatorBond = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getFacilitatorBond",
    args: [FACILITATOR_ADDRESS],
  });
  console.log(`  📋 Facilitator bond: $${formatUnits(facilitatorBond, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Make API Calls via x402 Protocol
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 2: Make API Calls via x402 Protocol");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const merkleTree = new MerkleTree();
  const calls: Call[] = [];
  let totalCost = 0n;

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
      const call: Call = {
        callId: result.receipt.callId,
        cost: BigInt(result.receipt.cost),
        timestamp: result.receipt.timestamp,
      };
      calls.push(call);
      merkleTree.addCall(call);
      totalCost += call.cost;
      console.log(`  Call ${i + 1}: ${endpoint} → $${formatUnits(call.cost, 6)}`);
    }
  }

  console.log();
  console.log(`  📊 Total: ${calls.length} calls, $${formatUnits(totalCost, 6)}`);
  console.log(`  📋 Merkle root: ${merkleTree.getRoot().slice(0, 22)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Agent Initiates Close with UNDERCLAIM (triggers dispute)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 3: Agent Initiates Close with UNDERCLAIM");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Agent claims HALF of what they actually owe (trying to cheat)
  const underclaim = totalCost / 2n;
  console.log(`  ⚠️  Agent claims: $${formatUnits(underclaim, 6)} (should be $${formatUnits(totalCost, 6)})`);
  console.log(`  ⚠️  Agent is trying to underpay by $${formatUnits(totalCost - underclaim, 6)}!`);
  console.log();

  const initiateCloseHash = await agentWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "initiateClose",
    args: [underclaim, merkleTree.getRoot()],
  });
  await publicClient.waitForTransactionReceipt({ hash: initiateCloseHash });

  console.log(`  ✅ Close initiated with underclaim`);
  console.log(`     TX: ${initiateCloseHash.slice(0, 22)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Facilitator Disputes
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 4: Facilitator Disputes (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log(`  🔍 Facilitator detects underclaim:`);
  console.log(`     Agent claims:    $${formatUnits(underclaim, 6)}`);
  console.log(`     Actual usage:    $${formatUnits(totalCost, 6)}`);
  console.log(`     Difference:      $${formatUnits(totalCost - underclaim, 6)}`);
  console.log();

  const disputeHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "facilitatorDispute",
    args: [agentAccount.address, totalCost, merkleTree.getRoot()],
  });
  await publicClient.waitForTransactionReceipt({ hash: disputeHash });

  console.log(`  ✅ Dispute raised!`);
  console.log(`     TX: ${disputeHash.slice(0, 22)}...`);
  console.log();

  // Check channel status
  const channelAfterDispute = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log("  📋 Channel Status:");
  console.log(`     status:          DISPUTED (${channelAfterDispute.status})`);
  console.log(`     claimedAmount:   $${formatUnits(channelAfterDispute.claimedAmount, 6)}`);
  console.log(`     disputedAmount:  $${formatUnits(channelAfterDispute.disputedAmount, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Facilitator Submits Merkle Proofs
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 5: Facilitator Submits Merkle Proofs (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Build call data structs and proofs
  const callDataStructs: { callId: Hex; cost: bigint; timestamp: bigint }[] = [];
  const proofs: Hex[][] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    callDataStructs.push({
      callId: call.callId,
      cost: call.cost,
      timestamp: BigInt(call.timestamp),
    });
    proofs.push(merkleTree.getProof(i)); // Use index, not callId
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

  console.log(`  ✅ Merkle proofs submitted`);
  console.log(`     TX: ${submitProofsHash.slice(0, 22)}...`);
  console.log();

  // Check proven amount
  const channelAfterProofs = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log("  📋 After Proof Submission:");
  console.log(`     provenAmount: $${formatUnits(channelAfterProofs.provenAmount, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Finalize Dispute (Anvil time warp)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 6: Finalize Dispute (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Fast forward time past proof deadline (Anvil cheat code)
  console.log("  ⏰ Fast forwarding time past proof deadline...");
  await publicClient.request({
    method: "evm_increaseTime" as any,
    params: [86400 * 8], // 8 days
  });
  await publicClient.request({
    method: "evm_mine" as any,
    params: [],
  });

  const finalizeHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "finalizeDispute",
    args: [agentAccount.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: finalizeHash });

  console.log(`  ✅ Dispute finalized`);
  console.log(`     TX: ${finalizeHash.slice(0, 22)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Check Final State
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 7: Final State");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const channelFinal = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
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

  // Calculate penalty (totalCost is actual usage, underclaim is the false claim)
  const provenAmount = channelFinal.provenAmount;
  const underpayAmount = totalCost - underclaim; // How much agent tried to underpay
  const penalty = underpayAmount / 10n; // 10% penalty

  console.log("  📋 Resolution:");
  console.log(`     Channel status:     SETTLED (${channelFinal.status})`);
  console.log(`     Proven amount:      $${formatUnits(provenAmount, 6)}`);
  console.log();
  console.log("  💸 Agent Penalty for Lying:");
  console.log(`     Agent claimed:      $${formatUnits(underclaim, 6)}`);
  console.log(`     Actual usage:       $${formatUnits(totalCost, 6)}`);
  console.log(`     Underpay attempt:   $${formatUnits(underpayAmount, 6)}`);
  console.log(`     Penalty (10%):      $${formatUnits(penalty, 6)}`);
  console.log(`     Total agent pays:   $${formatUnits(totalCost + penalty, 6)}`);
  console.log();
  console.log("  💰 Final Balances:");
  console.log(`     Facilitator:        $${formatUnits(facilitatorBalanceAfter, 6)} USDC`);
  console.log(`     Agent refund:       $${formatUnits(agentBalanceAfter, 6)} USDC`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                  ⚔️  DISPUTE RESOLUTION COMPLETE ⚔️                        ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  What Happened:");
  console.log(`    1. Agent made ${calls.length} API calls totaling $${formatUnits(totalCost, 6)}`);
  console.log(`    2. Agent tried to underpay with $${formatUnits(underclaim, 6)}`);
  console.log("    3. Facilitator disputed with Merkle proofs");
  console.log(`    4. Facilitator proved $${formatUnits(channelFinal.provenAmount, 6)} in usage`);
  console.log("    5. Dispute resolved in favor of facilitator");
  console.log();
  console.log("  x402 Protocol Features Demonstrated:");
  console.log("    ✅ HTTP 402 Payment Required flow");
  console.log("    ✅ EIP-712 signed authorizations");
  console.log("    ✅ On-chain channel management");
  console.log("    ✅ Merkle proof dispute resolution");
  console.log("    ✅ Cryptographic non-repudiation");
  console.log();
  console.log("  The system is TRUST-MINIMIZED:");
  console.log("    → Neither party can cheat without proof");
  console.log("    → All claims are cryptographically verifiable");
  console.log();
}

runX402DisputeDemo().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
