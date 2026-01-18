import { MerkleTree, Call, Checkpoint, createCheckpoint } from "@x402-prototype/merkle";
import {
  PaymentRequirement,
  PaymentAuthorization,
  ChannelAuthorization,
  X402_HEADERS,
  ChannelStatus,
  parsePaymentAuthorization,
  serializePaymentAuthorization,
  getChannelAuthorizationDomain,
  CHANNEL_AUTHORIZATION_TYPES,
} from "@x402-prototype/x402";
import { 
  Hex, 
  PublicClient, 
  WalletClient, 
  parseAbi, 
  Address, 
  keccak256, 
  encodePacked,
  recoverMessageAddress,
  Chain,
  createPublicClient,
  http
} from "viem";

/**
 * Configuration for Channel client
 */
export interface ChannelConfig {
  escrowAddress: Address;
  tokenAddress: Address;
  facilitatorAddress: Address;
  payToAddress: Address;
  serverUrl: string;
  serverAddress: Address;
  chain: Chain;
  checkpointThreshold: {
    value: bigint;
    callCount: number;
  };
}

/**
 * Call receipt from the server
 */
export interface CallReceipt {
  callId: string;
  endpoint: string;
  cost: bigint;
  timestamp: number;
  serverSignature: Hex;
}

/**
 * Channel state
 */
export interface ChannelState {
  isOpen: boolean;
  balance: bigint;
  totalSpent: bigint;
  callCount: number;
  checkpoints: Checkpoint[];
  currentCheckpointCalls: Call[];
  nonce: number;
}

/**
 * Verify a server receipt signature
 */
async function verifyReceiptSignature(
  receipt: CallReceipt,
  expectedServerAddress: Address
): Promise<boolean> {
  const message = keccak256(
    encodePacked(
      ["bytes32", "string", "uint256", "uint256"],
      [receipt.callId as Hex, receipt.endpoint, receipt.cost, BigInt(receipt.timestamp)]
    )
  );

  try {
    const recoveredAddress = await recoverMessageAddress({
      message: { raw: message },
      signature: receipt.serverSignature,
    });

    return recoveredAddress.toLowerCase() === expectedServerAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * x402 Channel Client for AI Agents
 * Implements the x402 channel payment scheme
 */
export class ChannelClient {
  private config: ChannelConfig;
  private merkleTree: MerkleTree;
  private state: ChannelState;
  private sessionId: string;
  private agentAddress: Address;
  private walletClient: WalletClient | null = null;
  private publicClient: PublicClient | null = null;

  constructor(config: ChannelConfig, agentAddress: Address) {
    this.config = config;
    this.agentAddress = agentAddress;
    this.merkleTree = new MerkleTree();
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.state = {
      isOpen: false,
      balance: 0n,
      totalSpent: 0n,
      callCount: 0,
      checkpoints: [],
      currentCheckpointCalls: [],
      nonce: 0,
    };
  }

  /**
   * Initialize wallet and public clients
   */
  setClients(walletClient: WalletClient, publicClient: PublicClient) {
    this.walletClient = walletClient;
    this.publicClient = publicClient;
  }

  /**
   * Open a channel by depositing funds
   */
  async openChannel(
    walletClient: WalletClient,
    publicClient: PublicClient,
    amount: bigint
  ): Promise<Hex> {
    this.setClients(walletClient, publicClient);
    const account = walletClient.account!;

    console.log(`Opening channel with deposit: $${Number(amount) / 1_000_000}`);

    // Approve token transfer
    const approveHash = await walletClient.writeContract({
      address: this.config.tokenAddress,
      abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
      functionName: "approve",
      args: [this.config.escrowAddress, amount],
      account,
      chain: this.config.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("  Token approval confirmed");

    // Deposit to escrow
    const depositHash = await walletClient.writeContract({
      address: this.config.escrowAddress,
      abi: parseAbi([
        "function deposit(address facilitator, address payTo, uint256 amount) external",
      ]),
      functionName: "deposit",
      args: [this.config.facilitatorAddress, this.config.payToAddress, amount],
      account,
      chain: this.config.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log("  Channel opened on-chain");

    this.state.isOpen = true;
    this.state.balance = amount;

    return depositHash;
  }

  /**
   * Create EIP-712 signature for channel authorization
   */
  private async signChannelAuthorization(
    endpoint: string,
    nonce: number,
    timestamp: number
  ): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error("Wallet client not initialized");
    }

    const domain = getChannelAuthorizationDomain(
      this.config.chain.id,
      this.config.escrowAddress
    );

    const signature = await this.walletClient.signTypedData({
      account: this.walletClient.account!,
      domain,
      types: CHANNEL_AUTHORIZATION_TYPES,
      primaryType: "ChannelAuthorization",
      message: {
        agentAddress: this.agentAddress,
        sessionId: this.sessionId,
        endpoint,
        nonce: BigInt(nonce),
        timestamp: BigInt(timestamp),
      },
    });

    return signature;
  }

  /**
   * Create payment authorization header
   */
  private async createPaymentAuthorization(endpoint: string): Promise<string> {
    const nonce = ++this.state.nonce;
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = await this.signChannelAuthorization(endpoint, nonce, timestamp);

    const authorization: PaymentAuthorization = {
      x402Version: 1,
      scheme: "channel",
      agentAddress: this.agentAddress,
      signature,
      authorization: {
        scheme: "channel",
        escrowAddress: this.config.escrowAddress,
        sessionId: this.sessionId,
        nonce,
        timestamp,
      } as ChannelAuthorization,
    };

    return serializePaymentAuthorization(authorization);
  }

  /**
   * Make an API call through the channel with x402 flow
   */
  async makeCall(endpoint: string): Promise<{ data: unknown; receipt: CallReceipt }> {
    if (!this.state.isOpen) {
      throw new Error("Channel not open. Call openChannel() first.");
    }

    // First, try without payment header to get 402 response
    const initialResponse = await fetch(`${this.config.serverUrl}${endpoint}`, {
      method: "GET",
    });

    if (initialResponse.status === 402) {
      // Parse payment requirement
      const requirementHeader = initialResponse.headers.get(X402_HEADERS.PAYMENT_REQUIRED);
      if (requirementHeader) {
        const requirement: PaymentRequirement = JSON.parse(requirementHeader);
        console.log(`  402 Payment Required: $${Number(BigInt(requirement.maxAmount)) / 1_000_000} for ${endpoint}`);
      }
    }

    // Create payment authorization
    const paymentAuth = await this.createPaymentAuthorization(endpoint);

    // Retry with payment header
    const response = await fetch(`${this.config.serverUrl}${endpoint}`, {
      method: "GET",
      headers: {
        [X402_HEADERS.PAYMENT]: paymentAuth,
      },
    });

    if (response.status === 402) {
      const body = await response.json();
      throw new Error(`Payment failed: ${body.message}`);
    }

    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    const result = await response.json();
    const receipt: CallReceipt = {
      callId: result.receipt.callId,
      endpoint: result.receipt.endpoint,
      cost: BigInt(result.receipt.cost),
      timestamp: result.receipt.timestamp,
      serverSignature: result.receipt.serverSignature,
    };

    // Verify the server's signature on the receipt
    const isValidSignature = await verifyReceiptSignature(
      receipt, 
      this.config.serverAddress
    );

    if (!isValidSignature) {
      throw new Error("Invalid server signature on receipt");
    }

    // Track in Merkle tree
    const call: Call = {
      callId: receipt.callId,
      cost: receipt.cost,
      timestamp: receipt.timestamp,
    };

    this.merkleTree.addCall(call);
    this.state.currentCheckpointCalls.push(call);
    this.state.callCount++;
    this.state.totalSpent += receipt.cost;

    // Check if checkpoint needed
    await this.maybeCreateCheckpoint();

    return { data: result.data, receipt };
  }

  /**
   * Make a call with automatic channel opening if 402 received
   */
  async makeCallWithAutoOpen(
    endpoint: string,
    walletClient: WalletClient,
    publicClient: PublicClient,
    depositAmount: bigint = 10_000_000n // $10 default
  ): Promise<{ data: unknown; receipt: CallReceipt }> {
    // Try to make call
    if (!this.state.isOpen) {
      // First, probe the endpoint to get requirements
      const probeResponse = await fetch(`${this.config.serverUrl}${endpoint}`, {
        method: "GET",
      });

      if (probeResponse.status === 402) {
        console.log("Received 402 - Opening channel...");
        await this.openChannel(walletClient, publicClient, depositAmount);
      }
    }

    return this.makeCall(endpoint);
  }

  /**
   * Check if a checkpoint should be created
   */
  private async maybeCreateCheckpoint(): Promise<void> {
    const callsSinceCheckpoint = this.state.currentCheckpointCalls.length;
    const valueSinceCheckpoint = this.state.currentCheckpointCalls.reduce(
      (sum, c) => sum + c.cost,
      0n
    );

    const shouldCheckpoint =
      callsSinceCheckpoint >= this.config.checkpointThreshold.callCount ||
      valueSinceCheckpoint >= this.config.checkpointThreshold.value;

    if (shouldCheckpoint) {
      await this.createCheckpoint();
    }
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(): Promise<Checkpoint> {
    const checkpoint = createCheckpoint(
      this.merkleTree,
      this.state.totalSpent,
      this.state.callCount
    );

    this.state.checkpoints.push(checkpoint);
    this.state.currentCheckpointCalls = [];

    console.log(`📍 Checkpoint #${this.state.checkpoints.length}`);
    console.log(`   Root: ${checkpoint.root.slice(0, 18)}...`);
    console.log(`   Total: $${Number(checkpoint.totalCost) / 1_000_000}`);

    return checkpoint;
  }

  /**
   * Initiate channel close
   */
  async closeChannel(
    walletClient: WalletClient,
    publicClient: PublicClient
  ): Promise<Hex> {
    const account = walletClient.account!;

    // Create final checkpoint if needed
    if (this.state.currentCheckpointCalls.length > 0) {
      await this.createCheckpoint();
    }

    const latestCheckpoint = this.state.checkpoints[this.state.checkpoints.length - 1];
    const root = latestCheckpoint?.root || ("0x" + "0".repeat(64)) as Hex;

    console.log(`Closing channel with amount: $${Number(this.state.totalSpent) / 1_000_000}`);

    const closeHash = await walletClient.writeContract({
      address: this.config.escrowAddress,
      abi: parseAbi([
        "function initiateClose(uint256 acknowledgedAmount, bytes32 checkpointRoot) external",
      ]),
      functionName: "initiateClose",
      args: [this.state.totalSpent, root],
      account,
      chain: this.config.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: closeHash });

    console.log("  Channel close initiated");

    return closeHash;
  }

  /**
   * Get the current Merkle root
   */
  getMerkleRoot(): Hex {
    return this.merkleTree.getRoot();
  }

  /**
   * Get proof for a specific call
   */
  getCallProof(callIndex: number): Hex[] {
    return this.merkleTree.getProof(callIndex);
  }

  /**
   * Get channel state
   */
  getState(): ChannelState {
    return { ...this.state };
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get agent address
   */
  getAgentAddress(): Address {
    return this.agentAddress;
  }
}

// Export utilities
export { verifyReceiptSignature };
