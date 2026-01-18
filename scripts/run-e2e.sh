#!/bin/bash

# x402 Channel Prototype - End-to-End Demo Runner
# This script starts Anvil, deploys contracts, and runs the E2E demo

set -e

echo "═══════════════════════════════════════════════════════════════════════════"
echo "          x402 CHANNEL PROTOTYPE - E2E DEMO RUNNER"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if anvil is installed
if ! command -v anvil &> /dev/null; then
    echo "❌ Anvil not found. Please install Foundry first:"
    echo "   curl -L https://foundry.paradigm.xyz | bash"
    echo "   foundryup"
    exit 1
fi

# Check if forge is installed
if ! command -v forge &> /dev/null; then
    echo "❌ Forge not found. Please install Foundry first:"
    echo "   curl -L https://foundry.paradigm.xyz | bash"
    echo "   foundryup"
    exit 1
fi

echo -e "${YELLOW}Step 1: Starting Anvil...${NC}"
echo ""

# Start Anvil in background
anvil --silent &
ANVIL_PID=$!

# Wait for Anvil to start
sleep 2

# Check if Anvil is running
if ! kill -0 $ANVIL_PID 2>/dev/null; then
    echo "❌ Failed to start Anvil"
    exit 1
fi

echo -e "${GREEN}✅ Anvil started (PID: $ANVIL_PID)${NC}"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "Shutting down Anvil..."
    kill $ANVIL_PID 2>/dev/null || true
}
trap cleanup EXIT

echo -e "${YELLOW}Step 2: Building contracts...${NC}"
echo ""
cd contracts
forge build
cd ..

echo ""
echo -e "${YELLOW}Step 3: Deploying contracts...${NC}"
echo ""
cd contracts
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cd ..

# Extract addresses from deployment (they're deterministic with Anvil)
export USDC_ADDRESS="0x5FbDB2315678afecb367f032d93F642f64180aa3"
export ESCROW_ADDRESS="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"

echo ""
echo -e "${GREEN}✅ Contracts deployed${NC}"
echo "   USDC:   $USDC_ADDRESS"
echo "   Escrow: $ESCROW_ADDRESS"
echo ""

echo -e "${YELLOW}Step 4: Running E2E demo...${NC}"
echo ""
pnpm demo:e2e

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                           DEMO COMPLETE!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
