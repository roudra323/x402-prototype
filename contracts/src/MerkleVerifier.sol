// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title MerkleVerifier
 * @notice Library for verifying Merkle proofs
 */
library MerkleVerifier {
    /**
     * @notice Verify a Merkle proof
     * @param leaf The leaf node to verify
     * @param proof The proof path (sibling hashes)
     * @param root The expected root
     * @return True if the proof is valid
     */
    function verify(
        bytes32 leaf,
        bytes32[] calldata proof,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (computedHash <= proofElement) {
                // Hash(current, sibling)
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                // Hash(sibling, current)
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == root;
    }

    /**
     * @notice Compute the hash of a call for Merkle tree inclusion
     * @param callId Unique identifier for the call
     * @param cost Cost of the call in atomic units
     * @param timestamp When the call occurred
     * @return The computed leaf hash
     */
    function computeCallHash(
        bytes32 callId,
        uint256 cost,
        uint256 timestamp
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(callId, cost, timestamp));
    }
}
