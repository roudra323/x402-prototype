# x402 Channel Scheme Prototype

A **trust-minimized** payment channel for the [x402 protocol](https://github.com/coinbase/x402), enabling efficient micropayments for AI agents with cryptographic dispute resolution.

**Hackathon Track:** x402 Agentic Finance/Payment Track — Advanced Programmatic Settlement & Workflows

**Target Network:** Cronos EVM

---

## 🎯 The Problem

The current x402 `exact` scheme uses EIP-3009 for per-request payments. For AI agents making hundreds or thousands of API calls per session, this creates:

| Issue | Impact |
|-------|--------|
| **Signature overhead** | Every request needs a fresh EIP-3009 signature |
| **Facilitator burden** | Balance checks and verification required per call |
| **Latency** | Signing adds ~50-100ms delay to each request |
| **Gas inefficiency** | Settlement transaction required per call |

---

## 💡 The Solution: Channel Scheme

The **"channel"** scheme allows clients (particularly AI agents) to:

1. **Lock funds upfront** in an escrow contract
2. **Make multiple API requests** off-chain with session-based authorization
3. **Settle periodically** using Merkle proofs
4. **Dispute if needed** with cryptographic evidence

### Quantified Comparison

| Metric | `exact` scheme | `channel` scheme |
|--------|---------------|------------------|
| Signatures (1000 calls) | 1000 | 1 (session auth) |
| On-chain transactions | 1000 | 2 (deposit + settle) |
| Gas cost estimate | ~50M gas | ~200K gas |
| Savings | - | **~99.6%** |

---

## 🔐 Trust-Minimized Security

This implementation is **fully trustless** - neither party can cheat:

### Signature Verification

Every API call requires the agent's **EIP-712 signature**. During disputes, the contract verifies:

```solidity
// On-chain verification - facilitator CANNOT fabricate calls
bytes32 digest = ECDSA.toTypedDataHash(DOMAIN_SEPARATOR, structHash);
address signer = ECDSA.recover(digest, calls[i].signature);
if (signer != agent) revert InvalidSignature(); // ❌ Rejected!
```

### Symmetrical Punishment

| Party | If They Lie | Punishment |
|-------|-------------|------------|
| **Agent** (underclaims) | Claims $0.08, actual $0.16 | Pays proven amount + **10% penalty** |
| **Facilitator** (overclaims) | Claims $0.48, actual $0.16 | Bond **slashed** for overclaim amount |
| **Both lie** | Both caught | **BOTH get punished** |

### Game Theory: Nash Equilibrium = Honesty

```
┌─────────────────────────────────────────────────────────────────────────┐
│  No matter what either party CLAIMS, the cryptographic proofs          │
│  determine the TRUTH. Lying is always a losing strategy!               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ✅ x402 Protocol Compliance

| x402 Requirement | Implementation | Status |
|------------------|----------------|--------|
| HTTP 402 Response | Server returns 402 when payment required | ✅ |
| `X-Payment-Required` Header | Pricing info with channel scheme | ✅ |
| `X-Payment` Header | EIP-712 signed authorization | ✅ |
| `X-Payment-Receipt` Header | Server-signed receipt | ✅ |
| Scheme Identifier | `"channel"` (new scheme type) | ✅ |
| On-chain Verification | Channel existence and balance checks | ✅ |
| Replay Protection | Nonce-based authorization | ✅ |

---

## 🔄 Protocol Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      x402 CHANNEL SCHEME FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

STEP 1: Agent requests resource (no payment)
═══════════════════════════════════════════
Agent  →  GET /api/weather
Server ←  HTTP 402 Payment Required
          X-Payment-Required: { scheme: "channel", escrow: "0x...", ... }

STEP 2: Agent opens channel on-chain (if needed)
════════════════════════════════════════════════
Agent  →  approve(escrow, amount)
Agent  →  escrow.deposit(facilitator, payTo, amount)

STEP 3: Agent retries with payment authorization
════════════════════════════════════════════════
Agent  →  GET /api/weather
          X-Payment: { scheme: "channel", signature: "0x...", nonce: 1, ... }
Server →  Verify signature + on-chain channel
Server ←  HTTP 200 OK + data
          X-Payment-Receipt: { callId, cost, serverSignature }

STEP 4: Agent signs each call for on-chain proof
════════════════════════════════════════════════
Agent signs: CallAuthorization(callId, cost, timestamp, escrow)
Both parties maintain identical Merkle trees
Periodic checkpoints with mutual signatures

STEP 5: Settlement
══════════════════
Agent  →  escrow.initiateClose(amount, merkleRoot)
          [7-day dispute window]
Agent  →  escrow.confirmClose()
          → Server receives payment
          → Agent receives refund
```

---

## 🛡️ Dispute Resolution

### Scenario 1: Agent Lies (Underclaims)

```
Agent made 5 calls worth $0.16
Agent claims: $0.08 (trying to underpay!)

↓ FACILITATOR DISPUTES ↓

Facilitator submits Merkle proofs + agent signatures
Contract verifies each signature: ✅ Agent signed these calls

↓ RESOLUTION ↓

Proven amount: $0.16
Agent pays: $0.16 + 10% penalty = $0.176
Agent PUNISHED for lying!
```

### Scenario 2: Facilitator Lies (Overclaims)

```
Agent made 5 calls worth $0.16
Facilitator claims: $0.48 (trying to steal!)

↓ AGENT DISPUTES ↓

Facilitator tries to prove $0.48
But only has signatures for $0.16!

↓ RESOLUTION ↓

Proven amount: $0.16
Facilitator bond SLASHED by $0.32
Agent receives slashed bond as compensation!
```

### Scenario 3: Both Lie

```
Actual usage: $0.16
Agent claims: $0.08 (underclaim)
Facilitator claims: $0.48 (overclaim)

↓ PROOFS REVEAL TRUTH ↓

Proven: $0.16

↓ BOTH PUNISHED ↓

Agent: Penalized $0.008 (10% of underclaim)
Facilitator: Bond slashed $0.32 (full overclaim)
TRUTH WINS!
```

---

## 🏗️ Project Structure

```
x402-prototype/
├── contracts/                          # Foundry smart contracts (Cronos EVM)
│   └── src/
│       ├── ChannelEscrow.sol           # Main escrow contract with dispute resolution
│       ├── MerkleVerifier.sol          # On-chain Merkle proof verification
│       ├── MockUSDC.sol                # Test ERC20 token
│       ├── interfaces/
│       │   ├── IChannelEscrow.sol      # Contract interface
│       │   └── IERC20.sol              # Token interface
│       └── libraries/
│           ├── ECDSA.sol               # EIP-712 signature recovery
│           └── SafeERC20.sol           # Safe token operations
├── packages/
│   ├── x402/                           # x402 protocol types and utilities
│   │   └── src/index.ts                # Types, headers, EIP-712 domains
│   ├── merkle/                         # Merkle tree library
│   │   └── src/index.ts                # Tree building and proof generation
│   ├── server/                         # x402-compliant API server
│   │   └── src/index.ts                # Express server with payment middleware
│   ├── client/                         # AI agent client SDK
│   │   └── src/index.ts                # Channel client with auto-signing
│   └── demo/                           # Demo scripts
│       ├── e2e-x402-flow.ts            # Full x402 happy path
│       ├── e2e-x402-dispute.ts         # Agent underclaim scenario
│       ├── e2e-x402-facilitator-dispute.ts  # Facilitator overclaim scenario
│       └── e2e-x402-both-lie.ts        # Both parties lie scenario
├── scripts/                            # Automation scripts
│   ├── run-x402-flow.sh                # Run happy path demo
│   ├── run-x402-dispute.sh             # Run agent underclaim demo
│   ├── run-x402-facilitator-dispute.sh # Run facilitator overclaim demo
│   └── run-x402-both-lie.sh            # Run both lie demo
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)

### Install & Build

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build contracts
pnpm contracts:build
```

### Run Tests

```bash
# Smart contract tests (14 tests)
pnpm contracts:test

# All tests pass:
# ✅ test_Bond_Deposit
# ✅ test_Bond_Withdraw
# ✅ test_Deposit_Success
# ✅ test_Deposit_CanReopenAfterSettlement
# ✅ test_Close_HappyPath
# ✅ test_Close_FacilitatorCanConfirmImmediately
# ✅ test_Dispute_AgentCanDispute
# ✅ test_FinalizeDispute_SlashesBondOnOverclaim
# ... and more
```

---

## 🎮 Demo Scripts

### End-to-End Demos (Fully Automated)

These scripts automatically start Anvil, deploy contracts, start the server, and run the demo:

| Command | Description | Who Lies? |
|---------|-------------|-----------|
| `pnpm e2e:x402-flow` | Happy path - honest settlement | Nobody |
| `pnpm e2e:x402-dispute` | Agent underclaims | **Agent** |
| `pnpm e2e:x402-facilitator-dispute` | Facilitator overclaims | **Facilitator** |
| `pnpm e2e:x402-both-lie` | Both parties try to cheat | **Both** |

### Example: Both Parties Lie Demo

```bash
pnpm e2e:x402-both-lie
```

Output:
```
═══════════════════════════════════════════════════════════════════════════
       🎭 BOTH PARTIES LIE - WHO WINS? 🎭                                   
═══════════════════════════════════════════════════════════════════════════

  Actual usage:          $0.16 (CRYPTOGRAPHIC TRUTH)

  🎭 THE LIES:
     Agent's LIE:             $0.08 (underclaim by $0.08)
     Facilitator's LIE:       $0.48 (overclaim by $0.32)

  📋 PROOF RESULTS (Truth vs Lies):
     Agent claimed:       $0.08 ❌ LIE
     Facilitator claimed: $0.48 ❌ LIE
     PROVEN (TRUTH):      $0.16 ✅

  ⚖️  THE JUDGMENT - BOTH PUNISHED:

  🔴 AGENT'S PUNISHMENT (for underclaiming):
     Penalty (10%):       $0.008

  🔥 FACILITATOR'S PUNISHMENT (for overclaiming):
     BOND SLASHED:        $0.32 🔥

  ✅ TRUTH determined settlement: $0.16
```

### Simple Demos (Without Blockchain)

```bash
pnpm demo:happy     # Happy path simulation
pnpm demo:dispute   # Dispute simulation
pnpm demo:x402      # x402 flow simulation
pnpm demo:agent     # AI agent simulation
```

---

## 🔐 Security Features

| Feature | Description |
|---------|-------------|
| **EIP-712 Call Signatures** | Each call requires agent's typed signature |
| **On-chain Signature Verification** | Contract verifies signatures during dispute |
| **ECDSA Library** | Custom signature recovery for proof validation |
| **SafeERC20** | Handles tokens that return false |
| **Facilitator Bond** | $100 stake, slashed for fraud |
| **Dispute Window** | 7-day period to contest claims |
| **Proof Window** | 5-day period for evidence submission |
| **Replay Protection** | Nonce-based authorization |
| **Duplicate Proof Prevention** | CallID tracking in contract |
| **Symmetrical Punishment** | Both parties penalized for lying |

### Trust Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TRUST-MINIMIZED ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  AGENT PROTECTION:                                                       │
│    ✅ Facilitator cannot fabricate proofs (no agent signatures)         │
│    ✅ Overclaim → Bond slashed                                          │
│    ✅ Agent receives slashed bond as compensation                       │
│                                                                          │
│  FACILITATOR PROTECTION:                                                 │
│    ✅ Agent cannot deny signed calls (on-chain verification)            │
│    ✅ Underclaim → 10% penalty                                          │
│    ✅ All calls cryptographically provable                              │
│                                                                          │
│  RESULT: Neither party can profitably cheat!                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Smart Contract Details

### ChannelEscrow.sol

| Function | Description |
|----------|-------------|
| `deposit()` | Open channel with facilitator |
| `topUp()` | Add more funds to channel |
| `initiateClose()` | Start settlement with claimed amount |
| `confirmClose()` | Complete settlement after dispute window |
| `dispute()` | Agent disputes facilitator's claim |
| `facilitatorDispute()` | Facilitator disputes agent's underclaim |
| `submitProofs()` | Submit Merkle proofs with signatures |
| `finalizeDispute()` | Resolve dispute based on proven amount |
| `depositBond()` | Facilitator stakes bond |
| `withdrawBond()` | Facilitator withdraws bond |

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MIN_DEPOSIT` | $10 | Minimum channel deposit |
| `DISPUTE_WINDOW` | 7 days | Time to raise dispute |
| `PROOF_WINDOW` | 5 days | Time to submit proofs |
| `DISPUTE_FEE` | $0.50 | Fee to raise dispute (refundable) |
| `FACILITATOR_BOND` | $100 | Required facilitator stake |
| `PENALTY_RATE` | 10% | Agent penalty for underclaim |

---

## 📈 Gas Efficiency

For an AI agent making 1000 API calls:

| Scheme | Transactions | Estimated Gas | Cost (@ 50 gwei) |
|--------|-------------|---------------|------------------|
| `exact` | 1000 | ~50,000,000 | ~2.5 CRO |
| `channel` | 2 | ~200,000 | ~0.01 CRO |
| **Savings** | - | **99.6%** | **~2.49 CRO** |

---

## 🔗 Cronos EVM Integration

| Configuration | Value |
|--------------|-------|
| **Mainnet Chain ID** | 25 |
| **Testnet Chain ID** | 338 |
| **Mainnet RPC** | https://evm.cronos.org |
| **Testnet RPC** | https://evm-t3.cronos.org |
| **Token** | USDC |
| **Explorer** | https://cronoscan.com |

### Deploy to Cronos Testnet

```bash
# Set your private key
export PRIVATE_KEY=0x...

# Deploy
pnpm contracts:deploy:cronos
```

---

## 🤖 AI Agent Use Case

```typescript
import { ChannelClient } from "@x402-prototype/client";

// Create client
const agent = new ChannelClient(config, agentAddress);

// Open channel with budget
await agent.openChannel(walletClient, publicClient, 10_000_000n); // $10

// Make API calls (each call is automatically signed!)
const weather = await agent.makeCall("/api/weather");  // Signs EIP-712
const data = await agent.makeCall("/api/data");        // Signs EIP-712
const premium = await agent.makeCall("/api/premium");  // Signs EIP-712
// ... 100s more calls

// Close and settle
await agent.closeChannel(walletClient, publicClient);
// Automatic: merkle root, claimed amount, dispute window
```

---

## 📊 Hackathon Track Alignment

**Track:** x402 Agentic Finance/Payment Track — Advanced Programmatic Settlement & Workflows

| Track Criteria | Our Implementation |
|---------------|-------------------|
| **Automated settlement pipelines** | ✅ Merkle proof-based settlement |
| **Multi-leg transactions and batching** | ✅ Channel batches 100s of calls |
| **Risk-managed agentic portfolios** | ✅ Facilitator bond system |
| **Institutional-grade workflow automation** | ✅ Checkpoint-based reconciliation |
| **Recurring or conditional instruction sets** | ✅ Session-based authorization |
| **Trust-minimized architecture** | ✅ Signature verification, symmetrical punishment |

---

## 🧪 Testing Scenarios

| Scenario | Command | Expected Result |
|----------|---------|-----------------|
| Happy path | `pnpm e2e:x402-flow` | Settlement at agreed amount |
| Agent lies | `pnpm e2e:x402-dispute` | Agent penalized 10% |
| Facilitator lies | `pnpm e2e:x402-facilitator-dispute` | Bond slashed |
| Both lie | `pnpm e2e:x402-both-lie` | Both punished |

---

## 📚 References

- [x402 Protocol](https://github.com/coinbase/x402)
- [x402 Specification](https://github.com/coinbase/x402/tree/main/specs)
- [EIP-3009: Transfer With Authorization](https://eips.ethereum.org/EIPS/eip-3009)
- [EIP-712: Typed Structured Data Hashing](https://eips.ethereum.org/EIPS/eip-712)
- [Cronos EVM Documentation](https://docs.cronos.org/)

---

## 📄 License

Apache-2.0

---

## 👥 Team

Built for the x402 Hackathon on Cronos EVM.

---

## 🔮 Future Improvements

- [ ] Multi-facilitator support
- [ ] Watchtower service for automated disputes
- [ ] L2 deployment for lower gas costs
- [ ] Channel network for cross-service payments
- [ ] Mobile SDK
