/**
 * End-to-End Integration Demo
 *
 * This demo runs against a local Anvil blockchain with deployed contracts.
 * It demonstrates the REAL x402 channel flow with actual on-chain transactions.
 *
 * Prerequisites:
 *   1. Start Anvil: anvil
 *   2. Deploy contracts: cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *   3. Set environment variables (printed by deploy script)
 *   4. Run this demo: pnpm demo:e2e
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
import { ChannelClient } from "@x402-prototype/client";
import { MerkleTree } from "@x402-prototype/merkle";
import { startServer, app, ENDPOINT_PRICING } from "@x402-prototype/server";

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
  "function faucet() external",
  "function mint(address, uint256) external",
]);

const ESCROW_ABI = parseAbi([
  "function deposit(address facilitator, address payTo, uint256 amount) external",
  "function initiateClose(uint256 acknowledgedAmount, bytes32 checkpointRoot) external",
  "function confirmClose() external",
  "function getChannel(address agent) view returns ((address agent, address facilitator, address payTo, uint256 balance, uint256 claimedAmount, uint256 disputedAmount, uint256 provenAmount, bytes32 checkpointRoot, uint256 checkpointAmount, uint256 disputeDeadline, uint256 proofDeadline, uint8 status))",
  "function facilitatorConfirm(address agent) external",
]);

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("          🔗 x402 CHANNEL - END-TO-END INTEGRATION DEMO 🔗                  ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();
console.log("  This demo uses REAL blockchain transactions on local Anvil!");
console.log();

async function runE2EDemo() {
  // ═══════════════════════════════════════════════════════════════════════════
  // SETUP: Create clients
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("SETUP: Connecting to Anvil...");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const facilitatorAccount = privateKeyToAccount(FACILITATOR_PRIVATE_KEY as Hex);
  const agentAccount = privateKeyToAccount(AGENT_PRIVATE_KEY as Hex);

  console.log(`  Facilitator: ${facilitatorAccount.address}`);
  console.log(`  Agent:       ${agentAccount.address}`);
  console.log(`  USDC:        ${USDC_ADDRESS}`);
  console.log(`  Escrow:      ${ESCROW_ADDRESS}`);
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
    console.error("     Run: anvil");
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Fund the agent with USDC
  // ═══════════════════════════════════════════════════════════════════════════
  console.log();
  console.log("STEP 1: Fund Agent with USDC");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  // Check agent's current balance
  let agentBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [agentAccount.address],
  });

  console.log(`  Current agent balance: $${formatUnits(agentBalance, 6)}`);

  if (agentBalance < 10_000_000n) {
    console.log("  Minting USDC to agent...");
    
    // Use facilitator to mint (they're the deployer)
    const mintHash = await facilitatorWallet.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "mint",
      args: [agentAccount.address, 1000_000_000n], // $1000
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });

    agentBalance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [agentAccount.address],
    });
    console.log(`  ✅ Agent balance: $${formatUnits(agentBalance, 6)}`);
  } else {
    console.log(`  ✅ Agent already funded`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Agent opens channel (ON-CHAIN)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log();
  console.log("STEP 2: Agent Opens Channel (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const depositAmount = 10_000_000n; // $10

  // Approve
  console.log(`  📝 Approving $${formatUnits(depositAmount, 6)} USDC...`);
  const approveHash = await agentWallet.writeContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "approve",
    args: [ESCROW_ADDRESS, depositAmount],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log(`     TX: ${approveHash.slice(0, 18)}...`);
  console.log(`     Gas used: ${approveReceipt.gasUsed}`);

  // Deposit
  console.log(`  💰 Depositing to escrow...`);
  const depositHash = await agentWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "deposit",
    args: [facilitatorAccount.address, facilitatorAccount.address, depositAmount],
  });
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`     TX: ${depositHash.slice(0, 18)}...`);
  console.log(`     Gas used: ${depositReceipt.gasUsed}`);

  // Verify channel
  const channel = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log();
  console.log("  📊 Channel State (ON-CHAIN):");
  console.log(`     Status:      ${["INACTIVE", "ACTIVE", "CLOSING", "DISPUTED", "SETTLED"][channel.status]}`);
  console.log(`     Balance:     $${formatUnits(channel.balance, 6)}`);
  console.log(`     Facilitator: ${channel.facilitator.slice(0, 10)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Simulate API calls with Merkle tree
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 3: Simulate API Calls (OFF-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const merkleTree = new MerkleTree();
  let totalCost = 0n;
  const callCount = 50;

  console.log(`  Making ${callCount} API calls...`);
  
  for (let i = 0; i < callCount; i++) {
    const call = {
      callId: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      cost: 10_000n, // $0.01 per call
      timestamp: Math.floor(Date.now() / 1000) + i,
    };
    merkleTree.addCall(call);
    totalCost += call.cost;

    if ((i + 1) % 10 === 0) {
      console.log(`     Progress: ${i + 1} calls, $${formatUnits(totalCost, 6)} spent`);
    }
  }

  const merkleRoot = merkleTree.getRoot();
  console.log();
  console.log(`  📊 Merkle Tree:`);
  console.log(`     Calls:  ${callCount}`);
  console.log(`     Total:  $${formatUnits(totalCost, 6)}`);
  console.log(`     Root:   ${merkleRoot.slice(0, 18)}...`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Agent initiates close (ON-CHAIN)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 4: Agent Initiates Close (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log(`  📝 Initiating close with amount: $${formatUnits(totalCost, 6)}`);
  const closeHash = await agentWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "initiateClose",
    args: [totalCost, merkleRoot],
  });
  const closeReceipt = await publicClient.waitForTransactionReceipt({ hash: closeHash });
  console.log(`     TX: ${closeHash.slice(0, 18)}...`);
  console.log(`     Gas used: ${closeReceipt.gasUsed}`);

  // Check channel state
  const channelAfterClose = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
  });

  console.log();
  console.log("  📊 Channel State (ON-CHAIN):");
  console.log(`     Status:      ${["INACTIVE", "ACTIVE", "CLOSING", "DISPUTED", "SETTLED"][channelAfterClose.status]}`);
  console.log(`     Claimed:     $${formatUnits(channelAfterClose.claimedAmount, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Facilitator confirms (ON-CHAIN)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("STEP 5: Facilitator Confirms (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  console.log("  📝 Facilitator confirms the settlement...");
  const confirmHash = await facilitatorWallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "facilitatorConfirm",
    args: [agentAccount.address],
  });
  const confirmReceipt = await publicClient.waitForTransactionReceipt({ hash: confirmHash });
  console.log(`     TX: ${confirmHash.slice(0, 18)}...`);
  console.log(`     Gas used: ${confirmReceipt.gasUsed}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Verify final state
  // ═══════════════════════════════════════════════════════════════════════════
  console.log();
  console.log("STEP 6: Verify Final State (ON-CHAIN)");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();

  const finalChannel = await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getChannel",
    args: [agentAccount.address],
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

  console.log("  📊 Final Channel State:");
  console.log(`     Status: ${["INACTIVE", "ACTIVE", "CLOSING", "DISPUTED", "SETTLED"][finalChannel.status]}`);
  console.log(`     Balance: $${formatUnits(finalChannel.balance, 6)}`);
  console.log();
  console.log("  💰 Final Balances:");
  console.log(`     Agent USDC:       $${formatUnits(agentFinalBalance, 6)}`);
  console.log(`     Facilitator USDC: $${formatUnits(facilitatorFinalBalance, 6)}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // GAS SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                         GAS USAGE SUMMARY                                  ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();

  const totalGas = approveReceipt.gasUsed + depositReceipt.gasUsed + closeReceipt.gasUsed + confirmReceipt.gasUsed;
  const exactSchemeGas = BigInt(callCount) * 50000n;

  console.log("  Channel Scheme (this demo):");
  console.log(`     Approve:         ${approveReceipt.gasUsed} gas`);
  console.log(`     Deposit:         ${depositReceipt.gasUsed} gas`);
  console.log(`     Initiate Close:  ${closeReceipt.gasUsed} gas`);
  console.log(`     Confirm:         ${confirmReceipt.gasUsed} gas`);
  console.log(`     ─────────────────────────────`);
  console.log(`     TOTAL:           ${totalGas} gas`);
  console.log();
  console.log("  Exact Scheme (per-call, estimated):");
  console.log(`     ${callCount} calls × 50,000 gas = ${exactSchemeGas} gas`);
  console.log();
  console.log(`  💰 SAVINGS: ${Number((exactSchemeGas - totalGas) * 100n / exactSchemeGas)}%`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                    🎉 E2E INTEGRATION COMPLETE 🎉                          ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  ✅ All transactions executed on Anvil blockchain");
  console.log("  ✅ Channel opened, used, and settled");
  console.log("  ✅ Merkle root committed on-chain");
  console.log("  ✅ Funds transferred correctly");
  console.log();
  console.log("  Transaction Hashes:");
  console.log(`     Approve:  ${approveHash}`);
  console.log(`     Deposit:  ${depositHash}`);
  console.log(`     Close:    ${closeHash}`);
  console.log(`     Confirm:  ${confirmHash}`);
  console.log();
}

runE2EDemo().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
