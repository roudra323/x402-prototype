/**
 * AI Agent Demo
 *
 * Simulates an AI agent using the x402 channel payment scheme
 * to make multiple API calls for data gathering and analysis.
 *
 * This demonstrates the "Agentic Finance" use case for the hackathon.
 */

import { MerkleTree, Call, createCheckpoint } from "@x402-prototype/merkle";
import {
  X402_HEADERS,
  createChannelPaymentRequirement,
  cronosTestnet,
} from "@x402-prototype/x402";

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("              🤖 AI AGENT x402 CHANNEL PAYMENT DEMO 🤖                      ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();
console.log("  Scenario: AI Research Agent gathering data from multiple paid APIs");
console.log("  Network:  Cronos EVM (Chain ID: 338)");
console.log("  Scheme:   x402 'channel' (batched payments with Merkle proofs)");
console.log();

// Simulated AI Agent configuration
interface AIAgentConfig {
  name: string;
  walletAddress: string;
  task: string;
  budget: bigint;
}

interface APIEndpoint {
  url: string;
  name: string;
  cost: bigint;
}

// Simulate the AI agent's workflow
async function runAIAgentDemo() {
  const agent: AIAgentConfig = {
    name: "ResearchBot-3000",
    walletAddress: "0xAI_AGENT_WALLET_ADDRESS_1234567890123456",
    task: "Gather weather and market data for climate impact analysis",
    budget: 10_000_000n, // $10 budget
  };

  const endpoints: APIEndpoint[] = [
    { url: "/api/weather", name: "Weather API", cost: 10_000n },
    { url: "/api/data", name: "Data API", cost: 20_000n },
    { url: "/api/premium", name: "Premium Analysis", cost: 100_000n },
  ];

  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log("  AGENT PROFILE");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log();
  console.log(`  Name:    ${agent.name}`);
  console.log(`  Wallet:  ${agent.walletAddress.slice(0, 20)}...`);
  console.log(`  Task:    ${agent.task}`);
  console.log(`  Budget:  $${Number(agent.budget) / 1_000_000}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Agent Initialization
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  PHASE 1: AGENT INITIALIZATION");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();

  console.log("  🤖 Agent: Starting research task...");
  console.log("  🤖 Agent: Checking available APIs...");
  console.log();

  // Agent probes endpoints and gets 402 responses
  console.log("  📡 Probing APIs for payment requirements:");
  console.log();

  for (const endpoint of endpoints) {
    console.log(`    GET ${endpoint.url}`);
    console.log(`    ← 402 Payment Required: $${Number(endpoint.cost) / 1_000_000}`);
  }
  console.log();

  console.log("  🤖 Agent: Payment required. Opening channel...");
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Channel Opening
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  PHASE 2: CHANNEL OPENING");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();

  console.log("  🔗 On-Chain Transactions (Cronos EVM):");
  console.log();
  console.log("    1. approve(ChannelEscrow, $10)");
  console.log("       → Transaction confirmed ✓");
  console.log();
  console.log("    2. deposit(facilitator, payTo, $10)");
  console.log("       → Channel opened ✓");
  console.log();
  console.log("  📊 Channel State:");
  console.log("    Status:  ACTIVE");
  console.log("    Balance: $10.00");
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Data Gathering (Multiple API Calls)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  PHASE 3: DATA GATHERING");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();

  const merkleTree = new MerkleTree();
  const calls: Call[] = [];
  let totalSpent = 0n;
  let callCount = 0;

  // Simulate the agent's data gathering workflow
  const workflow = [
    { endpoint: endpoints[0], count: 30, reason: "Historical weather data" },
    { endpoint: endpoints[1], count: 20, reason: "Market indicators" },
    { endpoint: endpoints[2], count: 5, reason: "Premium analysis reports" },
  ];

  for (const step of workflow) {
    console.log(`  🤖 Agent: Fetching ${step.reason}...`);
    console.log();

    for (let i = 0; i < step.count; i++) {
      const timestamp = Math.floor(Date.now() / 1000) + callCount;
      const call: Call = {
        callId: `0x${(callCount + 1).toString(16).padStart(64, "0")}`,
        cost: step.endpoint.cost,
        timestamp,
      };

      calls.push(call);
      merkleTree.addCall(call);
      totalSpent += step.endpoint.cost;
      callCount++;

      // Show progress every 10 calls
      if ((callCount) % 10 === 0) {
        console.log(`    📊 Progress: ${callCount} calls, $${Number(totalSpent) / 1_000_000} spent`);
      }
    }

    // Create checkpoint after each workflow step
    const checkpoint = createCheckpoint(merkleTree, totalSpent, callCount);
    console.log();
    console.log(`    📍 Checkpoint after ${step.reason}:`);
    console.log(`       Root: ${checkpoint.root.slice(0, 18)}...`);
    console.log(`       Total: $${Number(totalSpent) / 1_000_000}`);
    console.log();
  }

  console.log("  ✅ Data gathering complete!");
  console.log();
  console.log(`  📊 Session Summary:`);
  console.log(`     Total API calls: ${callCount}`);
  console.log(`     Total cost:      $${Number(totalSpent) / 1_000_000}`);
  console.log(`     Remaining:       $${Number(agent.budget - totalSpent) / 1_000_000}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: Settlement
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  PHASE 4: SETTLEMENT");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();

  console.log("  🤖 Agent: Task complete. Initiating channel close...");
  console.log();
  console.log("  🔗 On-Chain Transaction:");
  console.log(`    initiateClose($${Number(totalSpent) / 1_000_000}, merkleRoot)`);
  console.log("    → Close initiated ✓");
  console.log();

  console.log("  ⏰ Dispute window: 7 days");
  console.log("  ⏰ (Simulating passage of time...)");
  console.log();

  console.log("  ✅ No dispute raised. Confirming close...");
  console.log();

  console.log("  💰 Settlement Executed:");
  console.log(`     → Server receives: $${Number(totalSpent) / 1_000_000}`);
  console.log(`     → Agent refunded:  $${Number(agent.budget - totalSpent) / 1_000_000}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPARISON: Channel vs Exact
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  GAS SAVINGS COMPARISON");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();

  const gasPerExactCall = 50_000n;
  const gasForChannel = 200_000n; // deposit + close

  const exactGas = gasPerExactCall * BigInt(callCount);
  const channelGas = gasForChannel;
  const savings = Number((exactGas - channelGas) * 100n / exactGas);

  console.log("  With x402 'exact' scheme (per-call):");
  console.log(`    On-chain transactions: ${callCount}`);
  console.log(`    Total gas:             ~${exactGas.toLocaleString()} gas`);
  console.log();
  console.log("  With x402 'channel' scheme (this demo):");
  console.log(`    On-chain transactions: 2`);
  console.log(`    Total gas:             ~${channelGas.toLocaleString()} gas`);
  console.log();
  console.log(`  💰 Gas savings: ${savings}%`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  🏆 AI AGENT MISSION COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log("  Agent:           ResearchBot-3000");
  console.log("  Task:            Climate impact analysis");
  console.log("  APIs accessed:   3 different services");
  console.log(`  Total calls:     ${callCount}`);
  console.log(`  Total spent:     $${Number(totalSpent) / 1_000_000}`);
  console.log(`  Budget used:     ${Number(totalSpent * 100n / agent.budget)}%`);
  console.log(`  Gas saved:       ${savings}%`);
  console.log();
  console.log("  x402 Compliance:");
  console.log("    ✅ HTTP 402 Payment Required flow");
  console.log("    ✅ X-Payment authorization header");
  console.log("    ✅ On-chain channel verification");
  console.log("    ✅ Merkle proof audit trail");
  console.log("    ✅ Optimistic settlement");
  console.log();
  console.log("  Cronos EVM Integration:");
  console.log("    ✅ Smart contracts deployable on Cronos");
  console.log("    ✅ USDC support");
  console.log("    ✅ Low gas fees");
  console.log("    ✅ Fast finality");
  console.log();
  console.log("  🤖 AI agents can now make micropayments efficiently!");
  console.log();
}

runAIAgentDemo().catch(console.error);
