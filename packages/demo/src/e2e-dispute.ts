/**
 * End-to-End Dispute Demo on Anvil
 *
 * This demo runs against a local Anvil blockchain and shows:
 * 1. Agent opens channel
 * 2. Makes API calls
 * 3. Facilitator overclaims
 * 4. Agent disputes
 * 5. Facilitator submits Merkle proofs
 * 6. Resolution with bond slashing
 *
 * Prerequisites:
 *   1. Start Anvil: pnpm anvil
 *   2. Deploy contracts: pnpm contracts:deploy
 *   3. Run this demo: pnpm demo:e2e-dispute
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
import { MerkleTree, Call } from "@x402-prototype/merkle";
import {
  getCallAuthorizationDomain,
  CALL_AUTHORIZATION_TYPES,
} from "@x402-prototype/x402";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

// Anvil's pre-funded accounts
const FACILITATOR_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const AGENT_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// Contract addresses (from deployment)
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address;
const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as Address;

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
  "function submitProofs(address agent, (bytes32 callId, uint256 cost, uint256 timestamp, bytes signature)[] calls, bytes32[][] proofs) external",
  "function finalizeDispute(address agent) external",
  "function getChannel(address agent) view returns ((address agent, address facilitator, address payTo, uint256 balance, uint256 claimedAmount, uint256 disputedAmount, uint256 provenAmount, bytes32 checkpointRoot, uint256 checkpointAmount, uint256 disputeDeadline, uint256 proofDeadline, uint8 status))",
  "function getFacilitatorBond(address) view returns (uint256)",
  "function isCallProven(address agent, bytes32 callId) view returns (bool)",
]);

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("       🔥 x402 CHANNEL - E2E DISPUTE DEMO ON ANVIL 🔥                       ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();
console.log("  This demo shows REAL dispute resolution with on-chain transactions!");
console.log();

async function runDisputeDemo() {
  // ═══════════════════════════════════════════════════════════════════════════
  // SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("SETUP: Connecting to Anvil...");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY as Hex);
  const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY as Hex);

  console.log(`  Facilitator: ${facilitatorAccount.address}`);
  console.log(`  Agent:       ${agentAccount.address}`);
  console.log();

  const publicClient = createPublicClient({
    chain: ANVIL_CHAIN,
    transport: http("http://127.0.0.1:8545"),
  });

  const facilitatorWallet = createWalletClient({
    account: facilitatorAccount,
    chain: ANVIL_CHAIN,
    transport: http("http://127.0.0.1:8545"),
  });

  const agentWallet = createWalletClient({
    account: agentAccount,
    chain: ANVIL_CHAIN,
    transport: http("http://127.0.0.1:8545"),
  });

  // Check connection
  try {
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`  ✅ Connected to Anvil (block #${blockNumber})`);
  } catch (error) {
    console.error("  ❌ Failed to connect to Anvil. Make sure it's running!");
    process.exit(1);
  }

  // Check facilitator bond
  const initialBond = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getFacilitatorBond",
    args: [facilitatorAccount.address],
  });
  console.log(`  Facilitator bond: $${formatUnits(initialBond, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Fund agent and open channel
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 1: Agent Opens Channel (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Mint USDC to agent
  await facilitatorWallet.writeContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "mint",
    args: [agentAccount.address, 100_000_000n], // $100
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
    args: [facilitatorAccount.address, facilitatorAccount.address, depositAmount],
  });
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });

  console.log(`  💰 Agent deposited: $${formatUnits(depositAmount, 6)}`);
  console.log(`     TX: ${depositHash.slice(0, 22)}...`);
  console.log(`     Gas: ${depositReceipt.gasUsed}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Simulate API calls with Merkle tree
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 2: Make API Calls (OFF-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const merkleTree = new MerkleTree();
  const calls: Call[] = [];
  let actualTotalCost = 0n;
  const callCount = 100;
  const costPerCall = 10_000n; // $0.01

  console.log("  Generating calls with agent signatures...");

  for (let i = 0; i < callCount; i++) {
    const callId = keccak256(encodePacked(["uint256"], [BigInt(i + 1)])) as Hex;
    const timestamp = Math.floor(Date.now() / 1000) + i;

    // Sign the call authorization for on-chain proof verification
    const signature = await agentWallet.signTypedData({
      domain: getCallAuthorizationDomain(ANVIL_CHAIN.id, ESCROW_ADDRESS),
      types: CALL_AUTHORIZATION_TYPES,
      primaryType: "CallAuthorization",
      message: {
        callId,
        cost: costPerCall,
        timestamp: BigInt(timestamp),
        escrow: ESCROW_ADDRESS,
      },
    });

    const call: Call = {
      callId,
      cost: costPerCall,
      timestamp,
      signature,
    };
    calls.push(call);
    merkleTree.addCall(call);
    actualTotalCost += costPerCall;
  }

  const merkleRoot = merkleTree.getRoot();

  console.log(`  Made ${callCount} API calls`);
  console.log(`  Actual total cost: $${formatUnits(actualTotalCost, 6)}`);
  console.log(`  Merkle root: ${merkleRoot.slice(0, 22)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Facilitator OVERCLAIMS (ON-CHAIN)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 3: Facilitator Overclaims! (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const overclaimAmount = 1_500_000n; // Claims $1.50 (actual is $1.00!)

  console.log(`  ⚠️  Facilitator claims: $${formatUnits(overclaimAmount, 6)}`);
  console.log(`  ⚠️  But actual cost is: $${formatUnits(actualTotalCost, 6)}`);
  console.log(`  ⚠️  Overclaim: $${formatUnits(overclaimAmount - actualTotalCost, 6)}`);
  console.log();

  const claimHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "claimSettlement",
    args: [agentAccount.address, overclaimAmount, merkleRoot],
  });
  const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });

  console.log(`  📝 Claim submitted`);
  console.log(`     TX: ${claimHash.slice(0, 22)}...`);
  console.log(`     Gas: ${claimReceipt.gasUsed}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Agent disputes (ON-CHAIN)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 4: Agent Disputes! (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log(`  🛡️  Agent counter-claims: $${formatUnits(actualTotalCost, 6)}`);
  console.log(`  🛡️  Dispute fee: $0.50`);
  console.log();

  const disputeHash = await agentWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "dispute",
    args: [actualTotalCost],
  });
  const disputeReceipt = await publicClient.waitForTransactionReceipt({ hash: disputeHash });

  console.log(`  📝 Dispute raised`);
  console.log(`     TX: ${disputeHash.slice(0, 22)}...`);
  console.log(`     Gas: ${disputeReceipt.gasUsed}`);

  // Check channel state
  const channelAfterDispute = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log();
  console.log(`  📊 Channel State: ${["INACTIVE", "ACTIVE", "CLOSING", "DISPUTED", "SETTLED"][channelAfterDispute.status]}`);
  console.log(`     Claimed:   $${formatUnits(channelAfterDispute.claimedAmount, 6)}`);
  console.log(`     Disputed:  $${formatUnits(channelAfterDispute.disputedAmount, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Facilitator submits Merkle proofs (ON-CHAIN)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 5: Facilitator Submits Merkle Proofs (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log("  📤 Submitting proofs for all 100 calls...");
  console.log();

  // Submit proofs in batches of 25
  const batchSize = 25;
  let totalProofGas = 0n;

  for (let batch = 0; batch < Math.ceil(callCount / batchSize); batch++) {
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, callCount);
    
    const batchCalls = calls.slice(start, end).map(c => ({
      callId: c.callId as Hex,
      cost: c.cost,
      timestamp: BigInt(c.timestamp),
      signature: c.signature!, // Agent's EIP-712 signature for on-chain verification
    }));

    const batchProofs = [];
    for (let i = start; i < end; i++) {
      batchProofs.push(merkleTree.getProof(i));
    }

    const proofHash = await facilitatorWallet.writeContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "submitProofs",
      args: [agentAccount.address, batchCalls, batchProofs],
    });
    const proofReceipt = await publicClient.waitForTransactionReceipt({ hash: proofHash });
    totalProofGas += proofReceipt.gasUsed;

    // Check proven amount
    const channel = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "getChannel",
      args: [agentAccount.address],
    });

    console.log(`     Batch ${batch + 1}: calls ${start + 1}-${end}, proven: $${formatUnits(channel.provenAmount, 6)}`);
  }

  console.log();
  console.log(`  ✅ All proofs submitted (total gas: ${totalProofGas})`);

  // Check final proven amount
  const channelAfterProofs = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log();
  console.log(`  📊 Proven amount: $${formatUnits(channelAfterProofs.provenAmount, 6)}`);
  console.log(`     Claimed:       $${formatUnits(channelAfterProofs.claimedAmount, 6)}`);
  console.log(`     Shortfall:     $${formatUnits(channelAfterProofs.claimedAmount - channelAfterProofs.provenAmount, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Fast-forward time and finalize (ON-CHAIN)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 6: Finalize Dispute (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log("  ⏰ Fast-forwarding 6 days (proof window)...");
  
  // Use Anvil's evm_increaseTime
  await publicClient.request({
    method: "evm_increaseTime" as any,
    params: [6 * 24 * 60 * 60], // 6 days in seconds
  });
  await publicClient.request({
    method: "evm_mine" as any,
    params: [],
  });

  console.log("  ✅ Time advanced");
  console.log();

  // Finalize dispute
  const finalizeHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "finalizeDispute",
    args: [agentAccount.address],
  });
  const finalizeReceipt = await publicClient.waitForTransactionReceipt({ hash: finalizeHash });

  console.log(`  📝 Dispute finalized`);
  console.log(`     TX: ${finalizeHash.slice(0, 22)}...`);
  console.log(`     Gas: ${finalizeReceipt.gasUsed}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Verify final state
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 7: Verify Final State (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const finalChannel = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  const finalBond = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getFacilitatorBond",
    args: [facilitatorAccount.address],
  });

  const agentFinalBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [agentAccount.address],
  });

  const facilitatorFinalBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [facilitatorAccount.address],
  });

  console.log("  📊 Channel State:");
  console.log(`     Status: ${["INACTIVE", "ACTIVE", "CLOSING", "DISPUTED", "SETTLED"][finalChannel.status]}`);
  console.log();
  console.log("  🔥 Bond Slashing:");
  console.log(`     Initial bond:  $${formatUnits(initialBond, 6)}`);
  console.log(`     Final bond:    $${formatUnits(finalBond, 6)}`);
  console.log(`     Slashed:       $${formatUnits(initialBond - finalBond, 6)}`);
  console.log();
  console.log("  💰 Final Balances:");
  console.log(`     Agent USDC:       $${formatUnits(agentFinalBalance, 6)}`);
  console.log(`     Facilitator USDC: $${formatUnits(facilitatorFinalBalance, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                    🎉 DISPUTE RESOLUTION COMPLETE 🎉                       ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  What happened:");
  console.log(`    1. Facilitator claimed: $${formatUnits(overclaimAmount, 6)}`);
  console.log(`    2. Agent disputed with: $${formatUnits(actualTotalCost, 6)}`);
  console.log(`    3. Facilitator proved:  $${formatUnits(channelAfterProofs.provenAmount, 6)}`);
  console.log(`    4. Overclaim detected:  $${formatUnits(overclaimAmount - channelAfterProofs.provenAmount, 6)}`);
  console.log();
  console.log("  Resolution:");
  console.log(`    ✅ Facilitator bond slashed: $${formatUnits(initialBond - finalBond, 6)}`);
  console.log(`    ✅ Agent dispute fee refunded`);
  console.log(`    ✅ Settlement based on proven amount`);
  console.log();
  console.log("  Transaction Hashes:");
  console.log(`     Deposit:   ${depositHash}`);
  console.log(`     Claim:     ${claimHash}`);
  console.log(`     Dispute:   ${disputeHash}`);
  console.log(`     Finalize:  ${finalizeHash}`);
  console.log();
}

runDisputeDemo().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
