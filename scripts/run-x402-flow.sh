#!/bin/bash

# x402 Channel Prototype - Full x402 Protocol Flow Demo
# This script starts Anvil, deploys contracts, starts the server, and runs the x402 flow demo

set -e

echo "═══════════════════════════════════════════════════════════════════════════"
echo "          x402 CHANNEL PROTOTYPE - FULL x402 PROTOCOL FLOW"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if forge is installed
if ! command -v forge &> /dev/null; then
    echo "❌ Forge not found. Please install Foundry first:"
    echo "   curl -L https://foundry.paradigm.xyz | bash"
    echo "   foundryup"
    exit 1
fi

echo -e "${YELLOW}Step 1: Starting Anvil (Local Blockchain)...${NC}"
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

echo -e "${YELLOW}Step 2: Building contracts...${NC}"
echo ""
cd contracts
forge build --quiet
cd ..

echo -e "${GREEN}✅ Contracts built${NC}"
echo ""

echo -e "${YELLOW}Step 3: Deploying contracts...${NC}"
echo ""
cd contracts
forge script script/Deploy.s.sol:DeployScript --rpc-url http://127.0.0.1:8545 --broadcast --quiet
cd ..

# Contract addresses (deterministic with Anvil)
export USDC_ADDRESS="0x5FbDB2315678afecb367f032d93F642f64180aa3"
export ESCROW_ADDRESS="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
export FACILITATOR_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

echo -e "${GREEN}✅ Contracts deployed${NC}"
echo "   USDC:        $USDC_ADDRESS"
echo "   Escrow:      $ESCROW_ADDRESS"
echo "   Facilitator: $FACILITATOR_ADDRESS"
echo ""

echo -e "${YELLOW}Step 4: Starting x402 Server...${NC}"
echo ""

# Server uses the first Anvil account as facilitator
export NETWORK="local"
export RPC_URL="http://127.0.0.1:8545"
export SERVER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
export PORT="3000"

# Start server in background
pnpm server:start &
SERVER_PID=$!

# Wait for server to start
sleep 3

# Check if server is running
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ Failed to start server"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ x402 Server started (PID: $SERVER_PID)${NC}"
echo "   URL: http://localhost:3000"
echo ""

echo -e "${YELLOW}Step 5: Running x402 Protocol Flow Demo...${NC}"
echo ""

# Give server a moment to fully initialize
sleep 2

# Run the x402 flow demo
export SERVER_URL="http://localhost:3000"
pnpm demo:e2e-x402

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}              x402 PROTOCOL FLOW DEMO COMPLETE!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}This demo showed the complete x402 protocol flow:${NC}"
echo ""
echo "  1. Client makes request → Gets HTTP 402 Payment Required"
echo "  2. Client opens channel on-chain"
echo "  3. Client retries with X-Payment header (EIP-712 signature)"
echo "  4. Server verifies on-chain channel"
echo "  5. Server returns resource + X-Payment-Receipt"
echo "  6. Multiple calls tracked with Merkle tree"
echo ""
