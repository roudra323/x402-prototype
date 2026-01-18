import { Address, Hex, Chain } from "viem";

/**
 * x402 Protocol Version
 */
export const X402_VERSION = 1;

/**
 * x402 Payment Schemes
 * - "exact": Original per-request EIP-3009 payment
 * - "channel": New channel-based batched payment with Merkle proofs
 */
export type PaymentScheme = "exact" | "channel";

/**
 * x402 Payment Requirement
 * Returned in HTTP 402 response to indicate payment is required
 */
export interface PaymentRequirement {
  /** x402 protocol version */
  x402Version: number;
  
  /** Payment scheme type */
  scheme: PaymentScheme;
  
  /** Blockchain network identifier */
  network: string;
  
  /** Chain ID */
  chainId: number;
  
  /** Address to receive payment */
  payTo: Address;
  
  /** Token contract address (e.g., USDC) */
  asset: Address;
  
  /** Maximum amount for this request (in atomic units) */
  maxAmount: string;
  
  /** Human-readable description */
  description?: string;
  
  /** Expiry timestamp (Unix seconds) */
  expiry?: number;
  
  /** Additional scheme-specific data */
  extra?: ChannelPaymentExtra;
}

/**
 * Channel-specific payment requirement data
 */
export interface ChannelPaymentExtra {
  /** Channel escrow contract address */
  escrowAddress: Address;
  
  /** Minimum deposit required to open channel */
  minDeposit: string;
  
  /** Facilitator address */
  facilitatorAddress: Address;
  
  /** Required facilitator bond */
  facilitatorBond: string;
}

/**
 * x402 Payment Authorization Header
 * Sent by client to prove payment authorization
 */
export interface PaymentAuthorization {
  /** x402 protocol version */
  x402Version: number;
  
  /** Payment scheme used */
  scheme: PaymentScheme;
  
  /** Agent's wallet address */
  agentAddress: Address;
  
  /** Signature authorizing the request */
  signature: Hex;
  
  /** Additional scheme-specific authorization data */
  authorization: ChannelAuthorization | ExactAuthorization;
}

/**
 * Channel scheme authorization data
 */
export interface ChannelAuthorization {
  scheme: "channel";
  
  /** Channel escrow contract address */
  escrowAddress: Address;
  
  /** Session ID for tracking calls */
  sessionId: string;
  
  /** Current call nonce (for replay protection) */
  nonce: number;
  
  /** Timestamp of request */
  timestamp: number;
}

/**
 * Exact scheme authorization data (for compatibility)
 */
export interface ExactAuthorization {
  scheme: "exact";
  
  /** EIP-3009 transferWithAuthorization signature */
  transferSignature: Hex;
  
  /** Authorization nonce */
  nonce: Hex;
  
  /** Valid after timestamp */
  validAfter: number;
  
  /** Valid before timestamp */
  validBefore: number;
}

/**
 * x402 Response headers
 */
export const X402_HEADERS = {
  /** Payment requirement header */
  PAYMENT_REQUIRED: "X-Payment-Required",
  
  /** Payment authorization header (client → server) */
  PAYMENT: "X-Payment",
  
  /** Payment receipt header (server → client) */
  PAYMENT_RECEIPT: "X-Payment-Receipt",
} as const;

/**
 * Channel status from on-chain contract
 */
export enum ChannelStatus {
  INACTIVE = 0,
  ACTIVE = 1,
  CLOSING = 2,
  DISPUTED = 3,
  SETTLED = 4,
}

/**
 * On-chain channel data
 */
export interface OnChainChannel {
  agent: Address;
  facilitator: Address;
  payTo: Address;
  balance: bigint;
  claimedAmount: bigint;
  disputedAmount: bigint;
  provenAmount: bigint;
  checkpointRoot: Hex;
  checkpointAmount: bigint;
  disputeDeadline: bigint;
  proofDeadline: bigint;
  status: ChannelStatus;
}

/**
 * Cronos EVM Chain Configuration
 */
export const cronosMainnet: Chain = {
  id: 25,
  name: "Cronos",
  nativeCurrency: {
    name: "Cronos",
    symbol: "CRO",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://evm.cronos.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Cronoscan",
      url: "https://cronoscan.com",
    },
  },
};

export const cronosTestnet: Chain = {
  id: 338,
  name: "Cronos Testnet",
  nativeCurrency: {
    name: "Test Cronos",
    symbol: "TCRO",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://evm-t3.cronos.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Cronos Testnet Explorer",
      url: "https://explorer.cronos.org/testnet",
    },
  },
  testnet: true,
};

/**
 * Known USDC addresses on different networks
 */
export const USDC_ADDRESSES: Record<number, Address> = {
  25: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59", // Cronos Mainnet
  338: "0x6a2d262D56735DbA19Dd70682B39F6bE9a931D98", // Cronos Testnet (mock)
};

/**
 * Create a payment requirement for the channel scheme
 */
export function createChannelPaymentRequirement(params: {
  chainId: number;
  network: string;
  payTo: Address;
  asset: Address;
  maxAmount: bigint;
  escrowAddress: Address;
  facilitatorAddress: Address;
  minDeposit?: bigint;
  facilitatorBond?: bigint;
  description?: string;
  expiry?: number;
}): PaymentRequirement {
  return {
    x402Version: X402_VERSION,
    scheme: "channel",
    network: params.network,
    chainId: params.chainId,
    payTo: params.payTo,
    asset: params.asset,
    maxAmount: params.maxAmount.toString(),
    description: params.description,
    expiry: params.expiry,
    extra: {
      escrowAddress: params.escrowAddress,
      minDeposit: (params.minDeposit ?? 10_000_000n).toString(),
      facilitatorAddress: params.facilitatorAddress,
      facilitatorBond: (params.facilitatorBond ?? 100_000_000n).toString(),
    },
  };
}

/**
 * Parse payment authorization from header
 */
export function parsePaymentAuthorization(header: string): PaymentAuthorization | null {
  try {
    return JSON.parse(header) as PaymentAuthorization;
  } catch {
    return null;
  }
}

/**
 * Serialize payment authorization for header
 */
export function serializePaymentAuthorization(auth: PaymentAuthorization): string {
  return JSON.stringify(auth);
}

/**
 * EIP-712 domain for channel authorization signatures
 */
export function getChannelAuthorizationDomain(chainId: number, escrowAddress: Address) {
  return {
    name: "x402 Channel",
    version: "1",
    chainId,
    verifyingContract: escrowAddress,
  };
}

/**
 * EIP-712 domain for call authorization signatures (on-chain verification)
 * This is used by the smart contract to verify agent signatures during disputes
 */
export function getCallAuthorizationDomain(chainId: number, escrowAddress: Address) {
  return {
    name: "ChannelEscrow",
    version: "1",
    chainId,
    verifyingContract: escrowAddress,
  };
}

/**
 * EIP-712 types for channel authorization
 */
export const CHANNEL_AUTHORIZATION_TYPES = {
  ChannelAuthorization: [
    { name: "agentAddress", type: "address" },
    { name: "sessionId", type: "string" },
    { name: "endpoint", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;

/**
 * EIP-712 types for call authorization (on-chain verification)
 * This matches the CALL_AUTHORIZATION_TYPEHASH in the smart contract
 */
export const CALL_AUTHORIZATION_TYPES = {
  CallAuthorization: [
    { name: "callId", type: "bytes32" },
    { name: "cost", type: "uint256" },
    { name: "timestamp", type: "uint256" },
    { name: "escrow", type: "address" },
  ],
} as const;
