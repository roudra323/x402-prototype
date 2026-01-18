/**
 * End-to-End x402 Facilitator Dispute Flow Demo
 *
 * This demo shows what happens when the FACILITATOR LIES (overclaims):
 * 1. Client requests resource → Server returns HTTP 402
 * 2. Client opens channel on-chain
 * 3. Client makes API calls with X-Payment headers
 * 4. Facilitator claims MORE than actual usage (overclaim)
 * 5. Agent disputes with counter-claim
 * 6. Facilitator submits proofs but can only prove actual usage
 * 7. Facilitator bond gets SLASHED
 *
 * Prerequisites:
 *   pnpm e2e:x402-facilitator-dispute (runs everything automatically)
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
  "function claimSettlement(address agent, uint256 amount, bytes32 merkleRoot) external",
  "function dispute(uint256 counterAmount) external",
  "function submitProofs(address agent, (bytes32 callId, uint256 cost, uint256 timestamp, bytes signature)[] calldata calls, bytes32[][] calldata proofs) external",
  "function finalizeDispute(address agent) external",
  "function getChannel(address agent) view returns ((address agent, address facilitator, address payTo, uint256 balance, uint256 claimedAmount, uint256 disputedAmount, uint256 provenAmount, bytes32 checkpointRoot, uint256 checkpointAmount, uint256 disputeDeadline, uint256 proofDeadline, uint8 status))",
  "function getFacilitatorBond(address facilitator) view returns (uint256)",
]);

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("       🔥 FACILITATOR LIES - x402 OVERCLAIM DEMO 🔥                         ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();
console.log("  This demo shows what happens when the FACILITATOR tries to STEAL!");
console.log("  Facilitator overclaims → Agent disputes → Bond gets SLASHED");
console.log();

async function runFacilitatorDisputeDemo() {
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

  // Get initial facilitator bond
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
  console.log(`  📊 Actual Total: ${calls.length} calls, $${formatUnits(actualTotalCost, 6)}`);
  console.log(`  📋 Merkle root: ${merkleTree.getRoot().slice(0, 22)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Facilitator OVERCLAIMS (Tries to steal!)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 3: Facilitator OVERCLAIMS! (Trying to STEAL)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Facilitator claims 3x the actual amount!
  const overclaimAmount = actualTotalCost * 3n;
  const overclaim = overclaimAmount - actualTotalCost;

  console.log(`  ⚠️  ACTUAL usage:         $${formatUnits(actualTotalCost, 6)}`);
  console.log(`  ❌ Facilitator claims:   $${formatUnits(overclaimAmount, 6)}`);
  console.log(`  🔥 OVERCLAIM (stealing): $${formatUnits(overclaim, 6)}`);
  console.log();

  const claimHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "claimSettlement",
    args: [agentAccount.address, overclaimAmount, merkleTree.getRoot()],
  });
  await publicClient.waitForTransactionReceipt({ hash: claimHash });

  console.log(`  📝 Fraudulent claim submitted`);
  console.log(`     TX: ${claimHash.slice(0, 22)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Agent Detects Fraud and Disputes
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 4: Agent Detects Fraud and Disputes! (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log(`  🔍 Agent knows their actual usage: $${formatUnits(actualTotalCost, 6)}`);
  console.log(`  🛡️  Agent disputes with correct amount`);
  console.log(`  💰 Agent pays $0.50 dispute fee (refundable if right)`);
  console.log();

  const disputeHash = await agentWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "dispute",
    args: [actualTotalCost], // Agent knows actual cost from their receipts
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
  console.log(`     claimedAmount:   $${formatUnits(channelAfterDispute.claimedAmount, 6)} (facilitator's lie)`);
  console.log(`     disputedAmount:  $${formatUnits(channelAfterDispute.disputedAmount, 6)} (agent's truth)`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Facilitator Submits Merkle Proofs (Can only prove actual usage!)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 5: Facilitator Submits Proofs (CAN ONLY PROVE ACTUAL USAGE!)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log("  🔒 Facilitator tries to prove their claim of $" + formatUnits(overclaimAmount, 6));
  console.log("  🔒 But they only have signatures for $" + formatUnits(actualTotalCost, 6) + "!");
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

  console.log("  📋 Proof Results:");
  console.log(`     Facilitator claimed: $${formatUnits(channelAfterProofs.claimedAmount, 6)}`);
  console.log(`     Facilitator proved:  $${formatUnits(channelAfterProofs.provenAmount, 6)}`);
  console.log(`     SHORTFALL:           $${formatUnits(channelAfterProofs.claimedAmount - channelAfterProofs.provenAmount, 6)} ❌`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Finalize Dispute (Bond Slashing!)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 6: Finalize Dispute - BOND SLASHING! (ON-CHAIN)");
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
  // STEP 7: Check Final State - Facilitator PUNISHED!
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 7: Final State - FACILITATOR PUNISHED!");
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

  const slashedAmount = initialBond - finalBond;

  console.log("  📋 Resolution:");
  console.log(`     Channel status:     SETTLED (${channelFinal.status})`);
  console.log(`     Proven amount:      $${formatUnits(channelFinal.provenAmount, 6)}`);
  console.log();
  console.log("  🔥 FACILITATOR BOND SLASHING:");
  console.log(`     Initial bond:       $${formatUnits(initialBond, 6)}`);
  console.log(`     Final bond:         $${formatUnits(finalBond, 6)}`);
  console.log(`     SLASHED:            $${formatUnits(slashedAmount, 6)} 🔥`);
  console.log();
  console.log("  💰 Final Balances:");
  console.log(`     Facilitator:        $${formatUnits(facilitatorBalanceAfter, 6)} USDC`);
  console.log(`     Agent:              $${formatUnits(agentBalanceAfter, 6)} USDC (includes compensation!)`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("               🔥 FACILITATOR CAUGHT AND PUNISHED! 🔥                      ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  What Happened:");
  console.log(`    1. Agent made ${calls.length} API calls totaling $${formatUnits(actualTotalCost, 6)}`);
  console.log(`    2. Facilitator tried to STEAL $${formatUnits(overclaim, 6)} via overclaim`);
  console.log("    3. Agent disputed with correct amount");
  console.log(`    4. Facilitator could only prove $${formatUnits(channelFinal.provenAmount, 6)}`);
  console.log(`    5. Facilitator bond SLASHED by $${formatUnits(slashedAmount, 6)}`);
  console.log();
  console.log("  Why Facilitator Couldn't Fake More Proofs:");
  console.log("    ❌ Each proof requires agent's EIP-712 signature");
  console.log("    ❌ Facilitator doesn't have agent's private key");
  console.log("    ❌ Contract rejects unsigned/invalid proofs");
  console.log();
  console.log("  Security Guarantees:");
  console.log("    ✅ Agent is protected from facilitator fraud");
  console.log("    ✅ Slashed bond compensates the agent");
  console.log("    ✅ Dispute fee refunded to agent (was right)");
  console.log();
}

runFacilitatorDisputeDemo().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
