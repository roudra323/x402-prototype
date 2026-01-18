// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title ECDSA
 * @notice Library for ECDSA signature recovery
 * @dev Adapted from OpenZeppelin's ECDSA library
 */
library ECDSA {
    error InvalidSignatureLength();
    error InvalidSignatureS();

    /**
     * @notice Recover signer address from a message digest and signature
     * @param hash The message digest (should be EIP-712 typed data hash)
     * @param signature The signature bytes (65 bytes: r, s, v)
     * @return The recovered signer address
     */
    function recover(
        bytes32 hash,
        bytes memory signature
    ) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        uint8 v;

        // Extract r, s, v from signature
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        // EIP-2: Ensure s is in the lower half of the curve order
        if (
            uint256(s) >
            0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
        ) {
            revert InvalidSignatureS();
        }

        // Support both pre-EIP-155 (v = 27/28) and post-EIP-155 (v = 0/1)
        if (v < 27) {
            v += 27;
        }

        // Recover the signer
        address signer = ecrecover(hash, v, r, s);
        return signer;
    }

    /**
     * @notice Convert an Ethereum signed message hash
     * @param hash The original hash
     * @return The Ethereum signed message hash
     */
    function toEthSignedMessageHash(
        bytes32 hash
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
            );
    }

    /**
     * @notice Create EIP-712 typed data hash
     * @param domainSeparator The EIP-712 domain separator
     * @param structHash The hash of the typed data struct
     * @return The final typed data hash
     */
    function toTypedDataHash(
        bytes32 domainSeparator,
        bytes32 structHash
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19\x01", domainSeparator, structHash)
            );
    }
}
