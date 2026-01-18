import { keccak256, encodePacked, Hex } from "viem";

/**
 * Represents a single API call in the Merkle tree
 */
export interface Call {
  callId: string;
  cost: bigint;
  timestamp: number;
  signature?: Hex; // Agent's EIP-712 signature authorizing this call
}

/**
 * Represents a checkpoint with mutual signatures
 */
export interface Checkpoint {
  root: Hex;
  totalCost: bigint;
  callCount: number;
  timestamp: number;
  agentSignature?: Hex;
  facilitatorSignature?: Hex;
}

/**
 * MerkleTree class for building trees and generating proofs
 * Uses lazy construction - tree is built only when getRoot() is called
 */
export class MerkleTree {
  private leaves: Hex[] = [];
  private tree: Hex[][] = [];
  private isDirty: boolean = true;

  /**
   * Compute the hash of a call for Merkle tree inclusion
   */
  static computeCallHash(call: Call): Hex {
    return keccak256(
      encodePacked(
        ["bytes32", "uint256", "uint256"],
        [call.callId as Hex, call.cost, BigInt(call.timestamp)]
      )
    );
  }

  /**
   * Add a call to the tree
   */
  addCall(call: Call): void {
    const hash = MerkleTree.computeCallHash(call);
    this.leaves.push(hash);
    this.isDirty = true;
  }

  /**
   * Add a pre-computed hash to the tree
   */
  addLeaf(hash: Hex): void {
    this.leaves.push(hash);
    this.isDirty = true;
  }

  /**
   * Build the Merkle tree from leaves
   */
  private buildTree(): void {
    if (!this.isDirty) return;

    if (this.leaves.length === 0) {
      this.tree = [];
      this.isDirty = false;
      return;
    }

    // Start with leaves as first level
    let currentLevel = [...this.leaves];

    // Pad to power of 2 if necessary
    while (currentLevel.length > 1 && (currentLevel.length & (currentLevel.length - 1)) !== 0) {
      currentLevel.push(currentLevel[currentLevel.length - 1]);
    }

    this.tree = [currentLevel];

    // Build tree bottom-up
    while (currentLevel.length > 1) {
      const nextLevel: Hex[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || left;

        // Sort to ensure consistent ordering
        const [first, second] = left <= right ? [left, right] : [right, left];
        const parent = keccak256(encodePacked(["bytes32", "bytes32"], [first, second]));
        nextLevel.push(parent);
      }

      this.tree.push(nextLevel);
      currentLevel = nextLevel;
    }

    this.isDirty = false;
  }

  /**
   * Get the Merkle root
   */
  getRoot(): Hex {
    this.buildTree();

    if (this.tree.length === 0) {
      return "0x0000000000000000000000000000000000000000000000000000000000000000";
    }

    return this.tree[this.tree.length - 1][0];
  }

  /**
   * Get proof for a leaf at the given index
   */
  getProof(leafIndex: number): Hex[] {
    this.buildTree();

    if (leafIndex >= this.leaves.length) {
      throw new Error("Leaf index out of bounds");
    }

    const proof: Hex[] = [];
    let index = leafIndex;

    for (let level = 0; level < this.tree.length - 1; level++) {
      const currentLevel = this.tree[level];
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;

      if (siblingIndex < currentLevel.length) {
        proof.push(currentLevel[siblingIndex]);
      }

      index = Math.floor(index / 2);
    }

    return proof;
  }

  /**
   * Verify a proof locally
   */
  static verify(leaf: Hex, proof: Hex[], root: Hex): boolean {
    let computedHash = leaf;

    for (const proofElement of proof) {
      const [first, second] =
        computedHash <= proofElement
          ? [computedHash, proofElement]
          : [proofElement, computedHash];

      computedHash = keccak256(encodePacked(["bytes32", "bytes32"], [first, second]));
    }

    return computedHash === root;
  }

  /**
   * Get the number of leaves
   */
  getLeafCount(): number {
    return this.leaves.length;
  }

  /**
   * Get all leaves
   */
  getLeaves(): Hex[] {
    return [...this.leaves];
  }

  /**
   * Clear all leaves and reset the tree
   */
  clear(): void {
    this.leaves = [];
    this.tree = [];
    this.isDirty = true;
  }
}

/**
 * Create a checkpoint from current tree state
 */
export function createCheckpoint(
  tree: MerkleTree,
  totalCost: bigint,
  callCount: number
): Checkpoint {
  return {
    root: tree.getRoot(),
    totalCost,
    callCount,
    timestamp: Math.floor(Date.now() / 1000),
  };
}
