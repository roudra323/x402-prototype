# Deploy to Cronos Testnet

## Prerequisites

1. **Foundry installed**
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **Cronos Testnet CRO**
   - Go to: https://cronos.org/faucet
   - Enter your wallet address
   - Get testnet CRO tokens

3. **Private Key**
   - Export your wallet's private key (MetaMask: Account Details → Export Private Key)
   - Keep this secure!

---

## Step 1: Set Environment Variables

```bash
# Your wallet private key (WITH 0x prefix)
export PRIVATE_KEY=0x...your_private_key_here...
```

---

## Step 2: Deploy Contracts

```bash
# From project root
pnpm contracts:deploy:cronos
```

Expected output:
```
═══════════════════════════════════════════════════════════════
  x402 Channel Prototype - Cronos Testnet Deployment
═══════════════════════════════════════════════════════════════

Deployer: 0x...
Network: Cronos Testnet (Chain ID: 338)

MockUSDC deployed at: 0x...
ChannelEscrow deployed at: 0x...
Minted 10,000 USDC to deployer
Deposited $100 facilitator bond

═══════════════════════════════════════════════════════════════
  Deployment Complete!
═══════════════════════════════════════════════════════════════

Contract Addresses:
  MockUSDC:       0x...
  ChannelEscrow:  0x...

Explorer Links:
  MockUSDC:       https://explorer.cronos.org/testnet/address/0x...
  ChannelEscrow:  https://explorer.cronos.org/testnet/address/0x...
```

---

## Step 3: Verify Contracts (Optional)

```bash
# Verify MockUSDC
forge verify-contract \
  --chain-id 338 \
  --compiler-version v0.8.20 \
  <MOCK_USDC_ADDRESS> \
  src/MockUSDC.sol:MockUSDC \
  --etherscan-api-key <CRONOSCAN_API_KEY>

# Verify ChannelEscrow
forge verify-contract \
  --chain-id 338 \
  --compiler-version v0.8.20 \
  <ESCROW_ADDRESS> \
  src/ChannelEscrow.sol:ChannelEscrow \
  --constructor-args $(cast abi-encode "constructor(address)" <MOCK_USDC_ADDRESS>) \
  --etherscan-api-key <CRONOSCAN_API_KEY>
```

---

## Step 4: Update Submission

After deployment, update `HACKATHON_SUBMISSION.md` with the deployed addresses.

---

## Cronos Testnet Details

| Property | Value |
|----------|-------|
| Network Name | Cronos Testnet |
| Chain ID | 338 |
| RPC URL | https://evm-t3.cronos.org |
| Block Explorer | https://explorer.cronos.org/testnet |
| Faucet | https://cronos.org/faucet |

---

## Add Cronos Testnet to MetaMask

1. Open MetaMask → Settings → Networks → Add Network
2. Enter:
   - Network Name: `Cronos Testnet`
   - RPC URL: `https://evm-t3.cronos.org`
   - Chain ID: `338`
   - Symbol: `TCRO`
   - Explorer: `https://explorer.cronos.org/testnet`

---

## Troubleshooting

### "Insufficient funds"
- Get testnet CRO from https://cronos.org/faucet

### "Transaction underpriced"
- The `--legacy` flag should handle this

### "Nonce too low"
- Reset MetaMask account (Settings → Advanced → Clear Activity Tab Data)
- Or wait for pending transactions to complete
