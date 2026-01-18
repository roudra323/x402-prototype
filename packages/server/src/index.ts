import express, { Request, Response, NextFunction } from "express";
import type { Express } from "express";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { 
  keccak256, 
  encodePacked, 
  Hex, 
  Address, 
  createPublicClient, 
  http,
  parseAbi,
  verifyTypedData
} from "viem";
import {
  PaymentRequirement,
  PaymentAuthorization,
  ChannelAuthorization,
  X402_HEADERS,
  ChannelStatus,
  createChannelPaymentRequirement,
  parsePaymentAuthorization,
  getChannelAuthorizationDomain,
  CHANNEL_AUTHORIZATION_TYPES,
  cronosTestnet,
  cronosMainnet,
} from "@x402-prototype/x402";
import { foundry } from "viem/chains";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
const SERVER_PRIVATE_KEY = (process.env.SERVER_PRIVATE_KEY || generatePrivateKey()) as Hex;
const serverAccount = privateKeyToAccount(SERVER_PRIVATE_KEY);

// Network configuration - supports local Anvil, Cronos Testnet, or Mainnet
function getChainConfig() {
  const network = process.env.NETWORK?.toLowerCase();
  if (network === "mainnet") {
    return { chain: cronosMainnet, rpc: cronosMainnet.rpcUrls.default.http[0] };
  } else if (network === "local" || network === "anvil") {
    return { 
      chain: { ...foundry, id: 31337, name: "Anvil Local" },
      rpc: "http://127.0.0.1:8545" 
    };
  } else {
    // Default to Cronos Testnet
    return { chain: cronosTestnet, rpc: cronosTestnet.rpcUrls.default.http[0] };
  }
}

const { chain: CHAIN, rpc: DEFAULT_RPC } = getChainConfig();
const RPC_URL = process.env.RPC_URL || DEFAULT_RPC;

// Contract addresses (to be deployed on Cronos)
const ESCROW_ADDRESS = (process.env.ESCROW_ADDRESS || "0x0000000000000000000000000000000000000000") as Address;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "0x0000000000000000000000000000000000000000") as Address;
const FACILITATOR_ADDRESS = serverAccount.address;
const PAY_TO_ADDRESS = (process.env.PAY_TO_ADDRESS || serverAccount.address) as Address;

// Create public client for on-chain verification
const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

// Channel Escrow ABI (minimal for verification)
const ESCROW_ABI = parseAbi([
  "function getChannel(address agent) view returns ((address agent, address facilitator, address payTo, uint256 balance, uint256 claimedAmount, uint256 disputedAmount, uint256 provenAmount, bytes32 checkpointRoot, uint256 checkpointAmount, uint256 disputeDeadline, uint256 proofDeadline, uint8 status))",
  "function getChannelStatus(address agent) view returns (uint8)",
]);

/**
 * Endpoint pricing configuration (in atomic units, e.g., 6 decimals for USDC)
 */
const ENDPOINT_PRICING: Record<string, bigint> = {
  "/api/weather": 10_000n,      // $0.01
  "/api/data": 20_000n,         // $0.02
  "/api/premium": 100_000n,     // $0.10
};

/**
 * Session state tracking
 */
interface Session {
  agentAddress: Address;
  sessionId: string;
  callCount: number;
  totalCost: bigint;
  calls: CallReceipt[];
  lastNonce: number;
}

interface CallReceipt {
  callId: string;
  endpoint: string;
  cost: bigint;
  timestamp: number;
  serverSignature: Hex;
}

const sessions: Map<string, Session> = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique call ID
 */
function generateCallId(): Hex {
  return keccak256(encodePacked(
    ["uint256", "uint256"],
    [BigInt(Date.now()), BigInt(Math.floor(Math.random() * 1_000_000))]
  ));
}

/**
 * Sign a call receipt
 */
async function signReceipt(
  callId: Hex, 
  endpoint: string, 
  cost: bigint, 
  timestamp: number
): Promise<Hex> {
  const message = keccak256(
    encodePacked(
      ["bytes32", "string", "uint256", "uint256"],
      [callId, endpoint, cost, BigInt(timestamp)]
    )
  );
  return await serverAccount.signMessage({ message: { raw: message } });
}

/**
 * Verify channel exists on-chain and has sufficient balance
 */
async function verifyOnChainChannel(
  agentAddress: Address,
  requiredAmount: bigint
): Promise<{ valid: boolean; reason?: string }> {
  // Skip verification if escrow not deployed (for demo mode)
  if (ESCROW_ADDRESS === "0x0000000000000000000000000000000000000000") {
    console.log("⚠️  Demo mode: Skipping on-chain verification");
    return { valid: true };
  }

  try {
    const channel = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: "getChannel",
      args: [agentAddress],
    });

    if (channel.status !== ChannelStatus.ACTIVE) {
      return { valid: false, reason: "Channel not active" };
    }

    if (channel.facilitator.toLowerCase() !== FACILITATOR_ADDRESS.toLowerCase()) {
      return { valid: false, reason: "Invalid facilitator" };
    }

    if (channel.balance < requiredAmount) {
      return { valid: false, reason: "Insufficient channel balance" };
    }

    return { valid: true };
  } catch (error) {
    console.error("On-chain verification error:", error);
    return { valid: false, reason: "Failed to verify channel on-chain" };
  }
}

/**
 * Verify EIP-712 signature for channel authorization
 */
async function verifyChannelSignature(
  auth: PaymentAuthorization,
  channelAuth: ChannelAuthorization,
  endpoint: string
): Promise<boolean> {
  try {
    const valid = await verifyTypedData({
      address: auth.agentAddress,
      domain: getChannelAuthorizationDomain(CHAIN.id, channelAuth.escrowAddress),
      types: CHANNEL_AUTHORIZATION_TYPES,
      primaryType: "ChannelAuthorization",
      message: {
        agentAddress: auth.agentAddress,
        sessionId: channelAuth.sessionId,
        endpoint,
        nonce: BigInt(channelAuth.nonce),
        timestamp: BigInt(channelAuth.timestamp),
      },
      signature: auth.signature,
    });
    return valid;
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS APP SETUP
// ═══════════════════════════════════════════════════════════════════════════

const app: Express = express();
app.use(express.json());

/**
 * x402 Payment Middleware
 * Implements the HTTP 402 flow with channel scheme
 */
function x402PaymentMiddleware(req: Request, res: Response, next: NextFunction) {
  const endpoint = req.path;
  const cost = ENDPOINT_PRICING[endpoint] || 10_000n;

  // Check for payment authorization header
  const paymentHeader = req.headers[X402_HEADERS.PAYMENT.toLowerCase()] as string;

  if (!paymentHeader) {
    // No payment header - return 402 Payment Required
    const paymentRequirement = createChannelPaymentRequirement({
      chainId: CHAIN.id,
      network: CHAIN.name.toLowerCase(),
      payTo: PAY_TO_ADDRESS,
      asset: USDC_ADDRESS,
      maxAmount: cost,
      escrowAddress: ESCROW_ADDRESS,
      facilitatorAddress: FACILITATOR_ADDRESS,
      description: `Payment required for ${endpoint}`,
      expiry: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    });

    res.setHeader(X402_HEADERS.PAYMENT_REQUIRED, JSON.stringify(paymentRequirement));
    return res.status(402).json({
      error: "Payment Required",
      message: "x402 payment authorization required",
      paymentRequirement,
    });
  }

  // Parse payment authorization
  const auth = parsePaymentAuthorization(paymentHeader);
  if (!auth) {
    return res.status(400).json({
      error: "Invalid Payment Header",
      message: "Could not parse X-Payment header",
    });
  }

  // Verify scheme
  if (auth.scheme !== "channel") {
    return res.status(400).json({
      error: "Unsupported Scheme",
      message: "Only 'channel' scheme is supported by this server",
    });
  }

  const channelAuth = auth.authorization as ChannelAuthorization;

  // Store auth info for handler
  req.x402 = {
    auth,
    channelAuth,
    cost,
    endpoint,
  };

  next();
}

/**
 * Channel verification middleware (async)
 */
async function channelVerificationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { auth, channelAuth, cost, endpoint } = req.x402!;

  // Verify signature (skip in demo mode for simplicity)
  if (ESCROW_ADDRESS !== "0x0000000000000000000000000000000000000000") {
    const signatureValid = await verifyChannelSignature(auth, channelAuth, endpoint);
    if (!signatureValid) {
      return res.status(401).json({
        error: "Invalid Signature",
        message: "Channel authorization signature verification failed",
      });
    }
  }

  // Verify on-chain channel
  const channelVerification = await verifyOnChainChannel(auth.agentAddress, cost);
  if (!channelVerification.valid) {
    // Return 402 with channel requirement
    const paymentRequirement = createChannelPaymentRequirement({
      chainId: CHAIN.id,
      network: CHAIN.name.toLowerCase(),
      payTo: PAY_TO_ADDRESS,
      asset: USDC_ADDRESS,
      maxAmount: cost,
      escrowAddress: ESCROW_ADDRESS,
      facilitatorAddress: FACILITATOR_ADDRESS,
      description: channelVerification.reason || "Channel verification failed",
    });

    res.setHeader(X402_HEADERS.PAYMENT_REQUIRED, JSON.stringify(paymentRequirement));
    return res.status(402).json({
      error: "Channel Verification Failed",
      message: channelVerification.reason,
      paymentRequirement,
    });
  }

  // Get or create session
  const sessionId = channelAuth.sessionId;
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      agentAddress: auth.agentAddress,
      sessionId,
      callCount: 0,
      totalCost: 0n,
      calls: [],
      lastNonce: -1,
    });
  }

  const session = sessions.get(sessionId)!;

  // Verify nonce for replay protection
  if (channelAuth.nonce <= session.lastNonce) {
    return res.status(400).json({
      error: "Invalid Nonce",
      message: "Nonce must be greater than previous nonce (replay protection)",
    });
  }

  req.session = session;
  next();
}

/**
 * Create a paid endpoint handler
 */
function createPaidEndpoint(handler: (req: Request, res: Response) => object) {
  return async (req: Request, res: Response) => {
    const { cost, channelAuth } = req.x402!;
    const session = req.session!;
    const endpoint = req.path;
    const timestamp = Math.floor(Date.now() / 1000);
    const callId = generateCallId();

    // Sign the receipt
    const serverSignature = await signReceipt(callId, endpoint, cost, timestamp);

    // Track the call
    const receipt: CallReceipt = {
      callId,
      endpoint,
      cost,
      timestamp,
      serverSignature,
    };

    session.calls.push(receipt);
    session.callCount++;
    session.totalCost += cost;
    session.lastNonce = channelAuth.nonce;

    // Get the actual response data
    const responseData = handler(req, res);

    // Set payment receipt header
    res.setHeader(X402_HEADERS.PAYMENT_RECEIPT, JSON.stringify({
      callId,
      endpoint,
      cost: cost.toString(),
      timestamp,
      serverSignature,
      sessionTotal: session.totalCost.toString(),
      callCount: session.callCount,
    }));

    // Return response with receipt
    res.json({
      data: responseData,
      receipt: {
        callId,
        endpoint,
        cost: cost.toString(),
        timestamp,
        serverSignature,
      },
    });
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// API ENDPOINTS (Protected by x402)
// ═══════════════════════════════════════════════════════════════════════════

app.get(
  "/api/weather",
  x402PaymentMiddleware,
  channelVerificationMiddleware,
  createPaidEndpoint((req) => ({
    temperature: Math.round(Math.random() * 30 + 10),
    humidity: Math.round(Math.random() * 100),
    condition: ["sunny", "cloudy", "rainy"][Math.floor(Math.random() * 3)],
  }))
);

app.get(
  "/api/data",
  x402PaymentMiddleware,
  channelVerificationMiddleware,
  createPaidEndpoint((req) => ({
    id: Math.floor(Math.random() * 10000),
    value: Math.random().toFixed(4),
    timestamp: Date.now(),
  }))
);

app.get(
  "/api/premium",
  x402PaymentMiddleware,
  channelVerificationMiddleware,
  createPaidEndpoint((req) => ({
    analysis: "Premium data analysis result",
    confidence: Math.random().toFixed(2),
    recommendations: ["action1", "action2", "action3"],
  }))
);

// ═══════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT ENDPOINTS (Not paywalled)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get session summary
 */
app.get("/session/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({
    sessionId: session.sessionId,
    agentAddress: session.agentAddress,
    callCount: session.callCount,
    totalCost: session.totalCost.toString(),
    lastNonce: session.lastNonce,
  });
});

/**
 * Get all calls for a session (for building Merkle tree)
 */
app.get("/session/:sessionId/calls", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({
    calls: session.calls.map((c) => ({
      ...c,
      cost: c.cost.toString(),
    })),
  });
});

/**
 * Server info endpoint
 */
app.get("/info", (req, res) => {
  res.json({
    x402Version: 1,
    scheme: "channel",
    network: CHAIN.name,
    chainId: CHAIN.id,
    facilitatorAddress: FACILITATOR_ADDRESS,
    payToAddress: PAY_TO_ADDRESS,
    escrowAddress: ESCROW_ADDRESS,
    usdcAddress: USDC_ADDRESS,
    serverAddress: serverAccount.address,
    endpoints: Object.entries(ENDPOINT_PRICING).map(([endpoint, cost]) => ({
      endpoint,
      cost: cost.toString(),
    })),
  });
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    serverAddress: serverAccount.address,
    network: CHAIN.name,
    chainId: CHAIN.id,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SERVER START
// ═══════════════════════════════════════════════════════════════════════════

export function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log("═══════════════════════════════════════════════════════════════════════════");
    console.log("                    x402 CHANNEL SERVER                                     ");
    console.log("═══════════════════════════════════════════════════════════════════════════");
    console.log();
    console.log(`  URL:              http://localhost:${port}`);
    console.log(`  Network:          ${CHAIN.name} (Chain ID: ${CHAIN.id})`);
    console.log(`  Server Address:   ${serverAccount.address}`);
    console.log(`  Facilitator:      ${FACILITATOR_ADDRESS}`);
    console.log(`  Escrow Contract:  ${ESCROW_ADDRESS}`);
    console.log();
    console.log("  Endpoints:");
    Object.entries(ENDPOINT_PRICING).forEach(([endpoint, cost]) => {
      console.log(`    ${endpoint}: $${Number(cost) / 1_000_000}`);
    });
    console.log();
    console.log("═══════════════════════════════════════════════════════════════════════════");
  });
}

// Start if run directly
if (require.main === module) {
  startServer();
}

// Type augmentation for Express
declare global {
  namespace Express {
    interface Request {
      x402?: {
        auth: PaymentAuthorization;
        channelAuth: ChannelAuthorization;
        cost: bigint;
        endpoint: string;
      };
      session?: Session;
    }
  }
}

export { app, sessions, ENDPOINT_PRICING, CHAIN, ESCROW_ADDRESS };
