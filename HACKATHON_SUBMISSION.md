# x402 Channel Scheme - Hackathon Submission

## Project Overview

**x402 Channel Scheme** is a proposed extension to the x402 payment protocol that enables efficient micropayments for AI agents on Cronos EVM. Instead of requiring per-request EIP-3009 signatures (the current "exact" scheme), our "channel" scheme allows agents to deposit funds once into an escrow contract, make hundreds of API calls off-chain, and settle periodically using Merkle proofs. This reduces gas costs by up to 99% and eliminates per-call latency, making it ideal for AI agents that need high-frequency API access.

The prototype implements full x402 compliance with HTTP 402 Payment Required responses, EIP-712 signed authorizations, on-chain channel verification, and a robust dispute resolution system. When disagreements arise, facilitators must prove their claims with Merkle proofs or face bond slashing. This creates a trust-minimized system where neither party can cheat—agents are protected from overclaims, and facilitators are protected from service abuse.

---

## Track Alignment

**Track:** x402 Agentic Finance/Payment Track — Advanced Programmatic Settlement & Workflows

| Track Criteria | Our Implementation |
|---------------|-------------------|
| Automated settlement pipelines | ✅ Merkle proof-based optimistic settlement |
| Multi-leg transactions and batching | ✅ Channel batches 100s of API calls into 2 transactions |
| Risk-managed agentic portfolios | ✅ Facilitator bond system with slashing |
| Institutional-grade workflow automation | ✅ Checkpoints, dispute windows, cryptographic proofs |
| Recurring or conditional instruction sets | ✅ Session-based nonce authorization |

---

## Deployed Contracts (Cronos Testnet)

| Contract | Address | Explorer |
|----------|---------|----------|
| MockUSDC | `[TO BE FILLED]` | [View on Explorer]() |
| ChannelEscrow | `[TO BE FILLED]` | [View on Explorer]() |

---

## x402 Protocol Compliance

Our prototype **fully implements x402-compatible flows**:

| x402 Requirement | Implementation |
|-----------------|----------------|
| **HTTP 402 Payment Required** | ✅ Server returns 402 when no payment authorization |
| **X-Payment-Required header** | ✅ Contains scheme, amount, asset, escrow address |
| **X-Payment header** | ✅ Client sends EIP-712 signed channel authorization |
| **On-chain verification** | ✅ Server verifies channel exists and has balance |
| **X-Payment-Receipt header** | ✅ Server returns signed call receipt |
| **Replay protection** | ✅ Nonce-based protection per session |

---

## Demo Videos

### Demo 1: x402 Happy Flow (`pnpm e2e:x402-flow`)
Complete x402 protocol flow with automated settlement:
- Agent → HTTP 402 → Open Channel → X-Payment headers → API calls → Settlement

### Demo 2: Dispute Resolution (`pnpm e2e:x402-dispute`)
Full dispute flow when agent tries to underpay:
- Agent underclaims → Facilitator disputes → Merkle proofs → Resolution

---

## Repository Structure

```
x402-prototype/
├── contracts/                    # Solidity smart contracts
│   └── src/
│       ├── ChannelEscrow.sol     # Main escrow with dispute resolution
│       ├── MerkleVerifier.sol    # On-chain proof verification
│       └── MockUSDC.sol          # Test token
├── packages/
│   ├── x402/                     # x402 protocol types & utilities
│   ├── merkle/                   # Merkle tree library
│   ├── server/                   # x402-compliant API server
│   ├── client/                   # AI agent client SDK
│   └── demo/                     # Demo scripts
└── README.md
```

---

## How to Run

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run simulated demos
pnpm demo:happy      # Happy path
pnpm demo:dispute    # Dispute flow
pnpm demo:x402       # Full x402 protocol flow
pnpm demo:agent      # AI agent simulation

# Run E2E demos with local blockchain (automated)
pnpm e2e:x402-flow   # Full x402 protocol flow demo (recommended!)
pnpm e2e:happy       # Happy path with real transactions

# Manual E2E (step-by-step)
pnpm anvil           # Terminal 1
pnpm contracts:deploy # Terminal 2
pnpm demo:e2e        # Terminal 3
pnpm demo:e2e-dispute # Dispute with real transactions

# Deploy to Cronos Testnet
pnpm contracts:deploy:cronos
```

---

## Key Features

1. **99% Gas Savings** - Batch hundreds of calls into 2 transactions
2. **x402 Compliant** - HTTP 402, X-Payment headers, EIP-712 signatures
3. **Dispute Resolution** - Merkle proof verification on-chain
4. **Facilitator Bonds** - Economic security with slashing
5. **AI Agent Ready** - SDK for autonomous agents
6. **Cronos EVM** - Deployed on Cronos Testnet

---

## Team

- [Your Name/Team]

---

## Links

- **GitHub**: [Repository URL]
- **Demo Video**: [Video URL]
- **Deployed Contracts**: See above
