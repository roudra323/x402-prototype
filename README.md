# x402 Channel Scheme Prototype

A proposal for a new **"channel"** payment scheme for the [x402 protocol](https://github.com/coinbase/x402), enabling efficient micropayments for AI agents.

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

## ✅ x402 Protocol Compliance

This implementation follows the x402 standard:

| x402 Requirement | Implementation | Status |
|------------------|----------------|--------|
| HTTP 402 Response | Server returns 402 when payment required | ✅ |
| Payment Requirement Header | `X-Payment-Required` with pricing info | ✅ |
| Payment Authorization Header | `X-Payment` with signed authorization | ✅ |
| Payment Receipt Header | `X-Payment-Receipt` confirming call | ✅ |
| Scheme Identifier | `"channel"` (new scheme type) | ✅ |
| EIP-712 Signatures | Typed data signing for authorization | ✅ |
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

STEP 4: Multiple calls tracked in Merkle tree
═════════════════════════════════════════════
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

If there's a disagreement:

```
Facilitator claims $1.50
Agent disputes: "I only owe $1.00"

↓ PROOF PHASE ↓

Facilitator submits Merkle proofs for each call
Contract verifies: proven amount = $1.00

↓ RESOLUTION ↓

✅ Facilitator proved: $1.00 (not $1.50!)
✅ Facilitator bond slashed for overclaim
✅ Agent dispute fee refunded
✅ Settlement: $1.00 to server, $9.00 to agent
```

---

## 🏗️ Project Structure

```
x402-prototype/
├── contracts/                    # Foundry smart contracts (Cronos EVM)
│   └── src/
│       ├── ChannelEscrow.sol     # Main escrow contract
│       ├── MerkleVerifier.sol    # On-chain proof verification
│       └── libraries/
│           └── SafeERC20.sol     # Safe token operations
├── packages/
│   ├── x402/                     # x402 types and utilities
│   ├── merkle/                   # Merkle tree library
│   ├── server/                   # x402-compliant API server
│   ├── client/                   # AI agent client SDK
│   └── demo/                     # Demo scripts
│       ├── happy-path.ts         # Normal settlement flow
│       ├── dispute-flow.ts       # Dispute resolution demo
│       ├── x402-flow-demo.ts     # Full x402 protocol flow
│       └── ai-agent-demo.ts      # AI agent simulation
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
# Smart contract tests
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

### Run Demos

```bash
# Happy path (no dispute)
pnpm demo:happy

# Dispute resolution flow
pnpm demo:dispute

# Full x402 protocol flow
pnpm demo:x402

# AI agent simulation
pnpm demo:agent
```

### Run End-to-End Demos (Real Blockchain)

```bash
# RECOMMENDED: Automated x402 protocol flow demo (starts Anvil, deploys, runs server)
pnpm e2e:x402-flow

# This shows the COMPLETE x402-compatible flow:
#   1. Agent requests resource → Gets HTTP 402
#   2. Agent opens channel on-chain
#   3. Agent retries with X-Payment header
#   4. Server verifies on-chain + returns resource
#   5. Multiple API calls with receipts
```

**Manual step-by-step:**

```bash
# Terminal 1: Start local Anvil blockchain
pnpm anvil

# Terminal 2: Deploy contracts
pnpm contracts:deploy

# Terminal 2: Run E2E happy path demo
pnpm demo:e2e

# Terminal 2: Run E2E dispute demo (with bond slashing!)
pnpm demo:e2e-dispute
```

The E2E demo executes **real on-chain transactions**:

```
STEP 2: Agent Opens Channel (ON-CHAIN)
  📝 Approving $10 USDC...
     TX: 0xdc180c94c50b0683...
     Gas used: 46116
  💰 Depositing to escrow...
     TX: 0xa879a3205bebc18f...
     Gas used: 171070

  📊 Channel State (ON-CHAIN):
     Status:      ACTIVE
     Balance:     $10

...

STEP 6: Verify Final State (ON-CHAIN)
  📊 Final Channel State:
     Status: SETTLED
  💰 Final Balances:
     Agent USDC:       $999.5
     Facilitator USDC: $9900.5

  💰 GAS SAVINGS: 84%
```

### Start Server

```bash
# Start the x402-compliant server
pnpm server:start
```

---

## 🔗 Cronos EVM Integration

This prototype is designed for deployment on Cronos EVM:

| Configuration | Value |
|--------------|-------|
| **Mainnet Chain ID** | 25 |
| **Testnet Chain ID** | 338 |
| **Mainnet RPC** | https://evm.cronos.org |
| **Testnet RPC** | https://evm-t3.cronos.org |
| **Token** | USDC |
| **Explorer** | https://cronoscan.com |

### Environment Variables

```bash
# Network (testnet/mainnet)
NETWORK=testnet

# Contract addresses (after deployment)
ESCROW_ADDRESS=0x...
USDC_ADDRESS=0x...

# Server configuration
PORT=3000
SERVER_PRIVATE_KEY=0x...
PAY_TO_ADDRESS=0x...
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

---

## 🔐 Security Features

| Feature | Description |
|---------|-------------|
| **SafeERC20** | Handles tokens that return false |
| **Facilitator Bond** | $100 stake, slashed for fraud |
| **Dispute Window** | 7-day period to contest claims |
| **Proof Window** | 5-day period for evidence submission |
| **Replay Protection** | Nonce-based authorization |
| **Duplicate Proof Prevention** | CallID tracking in contract |
| **EIP-712 Signatures** | Typed data for authorization |

---

## 📈 Gas Efficiency

For an AI agent making 1000 API calls:

| Scheme | Transactions | Estimated Gas | Cost (@ 50 gwei) |
|--------|-------------|---------------|------------------|
| `exact` | 1000 | ~50,000,000 | ~2.5 CRO |
| `channel` | 2 | ~200,000 | ~0.01 CRO |
| **Savings** | - | **99.6%** | **~2.49 CRO** |

---

## 🤖 AI Agent Use Case

```typescript
// AI Agent using x402 channel
const agent = new ChannelClient(config, agentAddress);

// Open channel with budget
await agent.openChannel(walletClient, publicClient, 10_000_000n); // $10

// Make API calls (no per-call signatures needed!)
const weather = await agent.makeCall("/api/weather");
const data = await agent.makeCall("/api/data");
const premium = await agent.makeCall("/api/premium");
// ... 100s more calls

// Close and settle
await agent.closeChannel(walletClient, publicClient);
```

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
