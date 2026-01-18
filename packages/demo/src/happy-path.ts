/**
 * Happy Path Demo
 *
 * Demonstrates the normal flow of the channel scheme:
 * 1. Agent deposits funds
 * 2. Makes multiple API calls
 * 3. Checkpoint is created
 * 4. Channel closes with mutual agreement
 */

import { MerkleTree, Call, createCheckpoint } from "@x402-prototype/merkle";

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("                    X402 CHANNEL PROTOTYPE - HAPPY PATH                    ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();

// Simulate the happy path without actual blockchain/server
async function runHappyPath() {
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: DEPOSIT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 1: DEPOSIT");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  const depositAmount = 10_000_000n; // $10 USDC
  console.log(`Agent deposits: $${Number(depositAmount) / 1_000_000} USDC`);
  console.log(`Channel opened ✓`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: API USAGE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 2: API USAGE (Off-chain)");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  const merkleTree = new MerkleTree();
  const calls: Call[] = [];
  let totalCost = 0n;

  // Simulate 100 API calls
  const callCount = 100;
  const costPerCall = 10_000n; // $0.01 per call

  for (let i = 0; i < callCount; i++) {
    const call: Call = {
      callId: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      cost: costPerCall,
      timestamp: Math.floor(Date.now() / 1000) + i,
    };

    calls.push(call);
    merkleTree.addCall(call);
    totalCost += call.cost;

    // Progress indicator
    if ((i + 1) % 25 === 0) {
      console.log(`  Made ${i + 1} API calls...`);
    }

    // Checkpoint at 50 calls
    if (i === 49) {
      const checkpoint = createCheckpoint(merkleTree, totalCost, i + 1);
      console.log();
      console.log(`  📍 CHECKPOINT #1 (at 50 calls):`);
      console.log(`     Root: ${checkpoint.root.slice(0, 18)}...`);
      console.log(`     Total cost: $${Number(checkpoint.totalCost) / 1_000_000}`);
      console.log(`     Call count: ${checkpoint.callCount}`);
      console.log();
    }
  }

  console.log();
  console.log(`Total API calls made: ${callCount}`);
  console.log(`Total cost: $${Number(totalCost) / 1_000_000}`);
  console.log();

  // Final checkpoint
  const finalCheckpoint = createCheckpoint(merkleTree, totalCost, callCount);
  console.log(`  📍 FINAL CHECKPOINT (at 100 calls):`);
  console.log(`     Root: ${finalCheckpoint.root.slice(0, 18)}...`);
  console.log(`     Total cost: $${Number(finalCheckpoint.totalCost) / 1_000_000}`);
  console.log(`     Call count: ${finalCheckpoint.callCount}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: SETTLEMENT (Happy Path)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 3: SETTLEMENT (Happy Path)");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  console.log(`Agent initiates close with amount: $${Number(totalCost) / 1_000_000}`);
  console.log(`Facilitator confirms the amount`);
  console.log();
  console.log(`Settlement executed:`);
  console.log(`  → Server receives: $${Number(totalCost) / 1_000_000}`);
  console.log(`  → Agent refunded:  $${Number(depositAmount - totalCost) / 1_000_000}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                              SUMMARY                                       ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log(`  Initial deposit:     $${Number(depositAmount) / 1_000_000}`);
  console.log(`  Total API calls:     ${callCount}`);
  console.log(`  Total cost:          $${Number(totalCost) / 1_000_000}`);
  console.log(`  Server received:     $${Number(totalCost) / 1_000_000}`);
  console.log(`  Agent refunded:      $${Number(depositAmount - totalCost) / 1_000_000}`);
  console.log(`  Checkpoints created: 2`);
  console.log(`  Disputes:            0`);
  console.log();
  console.log("  ✅ Happy path completed successfully!");
  console.log();

  // Verify Merkle tree integrity
  console.log("MERKLE TREE VERIFICATION");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  const root = merkleTree.getRoot();
  const randomIndex = Math.floor(Math.random() * callCount);
  const proof = merkleTree.getProof(randomIndex);
  const leaf = MerkleTree.computeCallHash(calls[randomIndex]);
  const isValid = MerkleTree.verify(leaf, proof, root);

  console.log(`  Random call #${randomIndex + 1} verification:`);
  console.log(`    Leaf: ${leaf.slice(0, 18)}...`);
  console.log(`    Proof length: ${proof.length} hashes`);
  console.log(`    Verified: ${isValid ? "✅ VALID" : "❌ INVALID"}`);
  console.log();

  // Show gas savings
  console.log("GAS SAVINGS COMPARISON");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  console.log(`  With 'exact' scheme (per-call):`);
  console.log(`    On-chain transactions: ${callCount}`);
  console.log(`    Estimated gas: ~${(callCount * 50_000).toLocaleString()} gas`);
  console.log();
  console.log(`  With 'channel' scheme:`);
  console.log(`    On-chain transactions: 2 (deposit + settle)`);
  console.log(`    Estimated gas: ~100,000 gas`);
  console.log(`    Savings: ~${(((callCount * 50_000 - 100_000) / (callCount * 50_000)) * 100).toFixed(1)}%`);
  console.log();
}

runHappyPath().catch(console.error);
