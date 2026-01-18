#!/bin/bash

# x402 Channel Prototype - Full x402 Dispute Flow Demo
# Shows: HTTP 402 → payment → API calls → underclaim → dispute → Merkle proofs → resolution

set -e

echo "═══════════════════════════════════════════════════════════════════════════"
echo "        x402 CHANNEL PROTOTYPE - DISPUTE FLOW DEMO"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# PIDs to cleanup
ANVIL_PID=""
SERVER_PID=""

# Cleanup function
cleanup() {
    echo ""
    echo "Cleaning up..."
    if [ -n "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
        echo "  Stopped server (PID: $SERVER_PID)"
    fi
    if [ -n "$ANVIL_PID" ]; then
        kill $ANVIL_PID 2>/dev/null || true
        echo "  Stopped Anvil (PID: $ANVIL_PID)"
    fi
}
trap cleanup EXIT

# Check if anvil is installed
if ! command -v anvil &> /dev/null; then
    echo "❌ Anvil not found. Please install Foundry first:"
    echo "   curl -L https://foundry.paradigm.xyz | bash"
    echo "   foundryup"
    exit 1
fi

echo -e "${YELLOW}Step 1: Starting Anvil (Local Blockchain)...${NC}"
echo ""

# Start Anvil in background
anvil --silent &
ANVIL_PID=$!
sleep 2

if ! kill -0 $ANVIL_PID 2>/dev/null; then
    echo "❌ Failed to start Anvil"
    exit 1
fi

echo -e "${GREEN}✅ Anvil started (PID: $ANVIL_PID)${NC}"
echo ""

echo -e "${YELLOW}Step 2: Building and deploying contracts...${NC}"
echo ""
cd contracts
forge build --quiet
forge script script/Deploy.s.sol:DeployScript --rpc-url http://127.0.0.1:8545 --broadcast --quiet
cd ..

# Contract addresses (deterministic with Anvil)
export USDC_ADDRESS="0x5FbDB2315678afecb367f032d93F642f64180aa3"
export ESCROW_ADDRESS="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
export FACILITATOR_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

echo -e "${GREEN}✅ Contracts deployed${NC}"
echo ""

echo -e "${YELLOW}Step 3: Starting x402 Server...${NC}"
echo ""

export NETWORK="local"
export RPC_URL="http://127.0.0.1:8545"
export SERVER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
export PORT="3000"

pnpm server:start &
SERVER_PID=$!
sleep 4

if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ Failed to start server"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ x402 Server started (PID: $SERVER_PID)${NC}"
echo ""

echo -e "${YELLOW}Step 4: Running x402 Dispute Flow Demo...${NC}"
echo ""

sleep 2

export SERVER_URL="http://localhost:3000"
pnpm --filter demo run e2e-x402-dispute

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}              x402 DISPUTE FLOW DEMO COMPLETE!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}This demo showed:${NC}"
echo ""
echo "  1. Agent makes API calls with x402 payment headers"
echo "  2. Agent tries to underpay during settlement"
echo "  3. Facilitator detects and disputes"
echo "  4. Facilitator submits Merkle proofs"
echo "  5. Dispute resolved cryptographically"
echo ""
echo -e "${RED}Key Insight: Neither party can cheat!${NC}"
echo ""
