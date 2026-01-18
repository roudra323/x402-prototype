/**
 * Dispute Flow Demo
 *
 * Demonstrates dispute resolution in the channel scheme:
 * 1. Agent deposits funds
 * 2. Makes API calls
 * 3. Facilitator claims more than owed
 * 4. Agent disputes
 * 5. Facilitator must prove with Merkle proofs
 * 6. Resolution based on proofs
 */

import { MerkleTree, Call, createCheckpoint } from "@x402-prototype/merkle";

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("                   X402 CHANNEL PROTOTYPE - DISPUTE FLOW                   ");
console.log("═══════════════════════════════════════════════════════════════════════════");
console.log();

async function runDisputeFlow() {
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: DEPOSIT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 1: DEPOSIT");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  const depositAmount = 10_000_000n; // $10 USDC
  const facilitatorBond = 100_000_000n; // $100 USDC bond
  console.log(`Agent deposits: $${Number(depositAmount) / 1_000_000} USDC`);
  console.log(`Facilitator bond: $${Number(facilitatorBond) / 1_000_000} USDC`);
  console.log(`Channel opened ✓`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: API USAGE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 2: API USAGE");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  // Both parties maintain the same Merkle tree
  const merkleTree = new MerkleTree();
  const calls: Call[] = [];
  let actualTotalCost = 0n;

  // Make 100 calls at $0.01 each = $1.00 total
  const callCount = 100;
  const costPerCall = 10_000n;

  for (let i = 0; i < callCount; i++) {
    const call: Call = {
      callId: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      cost: costPerCall,
      timestamp: Math.floor(Date.now() / 1000) + i,
    };

    calls.push(call);
    merkleTree.addCall(call);
    actualTotalCost += call.cost;
  }

  // Checkpoint at call 50 - both parties agree on root at this point
  const checkpointAt = 50;
  let checkpointCost = 0n;
  for (let i = 0; i < checkpointAt; i++) {
    checkpointCost += calls[i].cost;
  }
  
  // The checkpoint captures the state at call 50
  // In the real flow, this is a mutually signed checkpoint
  const checkpoint = createCheckpoint(merkleTree, checkpointCost, checkpointAt);

  console.log(`Total API calls made: ${callCount}`);
  console.log(`Actual total cost: $${Number(actualTotalCost) / 1_000_000}`);
  console.log();
  console.log(`  📍 CHECKPOINT (at call ${checkpointAt}):`);
  console.log(`     Root: ${checkpoint.root.slice(0, 18)}...`);
  console.log(`     Total cost: $${Number(checkpoint.totalCost) / 1_000_000}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: FACILITATOR OVERCLAIMS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 3: FACILITATOR CLAIMS SETTLEMENT");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  const facilitatorClaim = 1_500_000n; // Claims $1.50 (but actual is $1.00!)
  
  // Facilitator submits the FULL merkle root (all 100 calls) when claiming
  const fullMerkleRoot = merkleTree.getRoot();
  
  console.log(`Facilitator claims: $${Number(facilitatorClaim) / 1_000_000}`);
  console.log(`Merkle root submitted: ${fullMerkleRoot.slice(0, 18)}...`);
  console.log(`⚠️  This is MORE than the actual cost of $${Number(actualTotalCost) / 1_000_000}!`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: AGENT DISPUTES
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 4: AGENT DISPUTES");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  const agentCounter = actualTotalCost; // Agent says $1.00 is correct
  const disputeFee = 500_000n; // $0.50 dispute fee

  console.log(`Agent disputes and claims: $${Number(agentCounter) / 1_000_000}`);
  console.log(`Dispute fee paid: $${Number(disputeFee) / 1_000_000}`);
  console.log();
  console.log(`Disputed amount: $${Number(facilitatorClaim - agentCounter) / 1_000_000}`);
  console.log(`Facilitator must prove all calls to justify: $${Number(facilitatorClaim) / 1_000_000}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: FACILITATOR SUBMITS PROOFS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 5: FACILITATOR SUBMITS PROOFS");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  console.log(`Full Merkle root: ${fullMerkleRoot.slice(0, 18)}...`);
  console.log();

  // Facilitator proves ALL calls against the full merkle root
  // This simulates the on-chain submitProofs function
  console.log("Proving all 100 calls:");
  let provenAmount = 0n;
  let proofCount = 0;
  const provenCallIds = new Set<string>(); // Track proven calls (prevents duplicates)

  for (let i = 0; i < callCount; i++) {
    const call = calls[i];
    const leaf = MerkleTree.computeCallHash(call);
    const proof = merkleTree.getProof(i);
    const isValid = MerkleTree.verify(leaf, proof, fullMerkleRoot);

    if (isValid && !provenCallIds.has(call.callId)) {
      provenCallIds.add(call.callId);
      provenAmount += call.cost;
      proofCount++;
    }

    if ((i + 1) % 25 === 0) {
      console.log(`  Verified ${i + 1} calls, proven amount: $${Number(provenAmount) / 1_000_000}`);
    }
  }

  console.log();
  console.log(`Total proofs submitted: ${proofCount}`);
  console.log(`Total proven amount: $${Number(provenAmount) / 1_000_000}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6: RESOLUTION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("PHASE 6: RESOLUTION");
  console.log("─────────────────────────────────────────────────────────────────────────────");

  const canProveFullClaim = provenAmount >= facilitatorClaim;

  console.log(`Facilitator claimed: $${Number(facilitatorClaim) / 1_000_000}`);
  console.log(`Facilitator proved:  $${Number(provenAmount) / 1_000_000}`);
  console.log();

  if (canProveFullClaim) {
    console.log("❌ Facilitator proved the full claim - agent loses dispute");
    console.log("   Agent loses dispute fee");
  } else {
    console.log("✅ Facilitator could NOT prove the full claim!");
    console.log();

    const overclaimAmount = facilitatorClaim - provenAmount;
    const actualSettlement = provenAmount > facilitatorClaim ? facilitatorClaim : provenAmount;

    console.log(`   Overclaim detected: $${Number(overclaimAmount) / 1_000_000}`);
    console.log();
    console.log("   PENALTIES:");
    console.log(`   → Facilitator bond slashed: $${Number(overclaimAmount) / 1_000_000}`);
    console.log(`   → Agent dispute fee refunded: $${Number(disputeFee) / 1_000_000}`);
    console.log();
    console.log("   SETTLEMENT:");
    console.log(`   → Server receives: $${Number(actualSettlement) / 1_000_000}`);
    console.log(`   → Agent refunded:  $${Number(depositAmount - actualSettlement + disputeFee) / 1_000_000}`);
  }

  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // PROOF VERIFICATION DEMO
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("MERKLE PROOF VERIFICATION");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  
  // Show that duplicate proofs are rejected
  console.log("Demonstrating duplicate proof protection:");
  const duplicateCall = calls[0];
  const duplicateLeaf = MerkleTree.computeCallHash(duplicateCall);
  const duplicateProof = merkleTree.getProof(0);
  const duplicateValid = MerkleTree.verify(duplicateLeaf, duplicateProof, fullMerkleRoot);
  const alreadyProven = provenCallIds.has(duplicateCall.callId);
  
  console.log(`  Attempting to re-submit proof for call #1:`);
  console.log(`    Proof valid: ${duplicateValid ? "✓" : "✗"}`);
  console.log(`    Already proven: ${alreadyProven ? "YES - REJECTED" : "NO"}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("                              SUMMARY                                       ");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log();
  console.log(`  Initial deposit:       $${Number(depositAmount) / 1_000_000}`);
  console.log(`  Actual usage:          $${Number(actualTotalCost) / 1_000_000}`);
  console.log(`  Facilitator claimed:   $${Number(facilitatorClaim) / 1_000_000}`);
  console.log(`  Facilitator proved:    $${Number(provenAmount) / 1_000_000}`);
  console.log(`  Agent counter-claim:   $${Number(agentCounter) / 1_000_000}`);
  console.log(`  Merkle proofs used:    ${proofCount}`);
  console.log(`  Duplicate protection:  ✓ Active`);
  console.log();
  console.log("  ✅ Dispute resolved via cryptographic proofs!");
  console.log("  ✅ Agent protected from overclaim!");
  console.log("  ✅ Facilitator bond slashed for fraud attempt!");
  console.log();
}

runDisputeFlow().catch(console.error);
