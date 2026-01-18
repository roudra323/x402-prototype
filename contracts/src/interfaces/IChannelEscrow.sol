// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title IChannelEscrow
 * @notice Interface for the Channel Escrow contract
 */
interface IChannelEscrow {
    // ═══════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum ChannelStatus {
        INACTIVE, // No channel exists
        ACTIVE, // Channel is open and operational
        CLOSING, // Close initiated, in dispute window
        DISPUTED, // Dispute raised, in proof phase
        SETTLED // Channel closed and settled
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct Channel {
        address agent;
        address facilitator;
        address payTo;
        uint256 balance;
        uint256 claimedAmount;
        uint256 disputedAmount;
        uint256 provenAmount;
        bytes32 checkpointRoot;
        uint256 checkpointAmount;
        uint256 disputeDeadline;
        uint256 proofDeadline;
        ChannelStatus status;
    }

    struct CallData {
        bytes32 callId;
        uint256 cost;
        uint256 timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event ChannelOpened(
        address indexed agent,
        address indexed facilitator,
        uint256 amount
    );
    event ChannelToppedUp(
        address indexed agent,
        uint256 amount,
        uint256 newBalance
    );
    event CloseInitiated(
        address indexed agent,
        address indexed initiator,
        uint256 claimedAmount
    );
    event CloseConfirmed(address indexed agent, uint256 amount);
    event DisputeRaised(address indexed agent, uint256 counterAmount);
    event ProofSubmitted(
        address indexed agent,
        uint256 callCount,
        uint256 provenAmount
    );
    event ChannelSettled(
        address indexed agent,
        uint256 toPayTo,
        uint256 toAgent
    );

    // Bond events
    event BondDeposited(
        address indexed facilitator,
        uint256 amount,
        uint256 totalBond
    );
    event BondWithdrawn(
        address indexed facilitator,
        uint256 amount,
        uint256 remainingBond
    );
    event BondSlashed(
        address indexed facilitator,
        uint256 slashedAmount,
        uint256 overclaim
    );
    event AgentPenalized(
        address indexed agent,
        uint256 penaltyAmount,
        uint256 underclaim
    );

    // ═══════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error ChannelNotActive();
    error ChannelNotInactive();
    error ChannelNotClosing();
    error ChannelNotDisputed();
    error InsufficientDeposit();
    error InsufficientBalance();
    error InsufficientBond();
    error InsufficientFacilitatorBond();
    error InvalidProof();
    error DisputeWindowExpired();
    error DisputeWindowNotExpired();
    error ProofWindowExpired();
    error ProofWindowNotExpired();
    error Unauthorized();
    error InvalidAmount();

    // ═══════════════════════════════════════════════════════════════════════
    // FACILITATOR BOND FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function depositBond(uint256 amount) external;

    function withdrawBond(uint256 amount) external;

    // ═══════════════════════════════════════════════════════════════════════
    // AGENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function deposit(
        address facilitator,
        address payTo,
        uint256 amount
    ) external;

    function topUp(uint256 amount) external;

    function initiateClose(
        uint256 acknowledgedAmount,
        bytes32 checkpointRoot
    ) external;

    function confirmClose() external;

    function dispute(uint256 counterAmount) external;

    // ═══════════════════════════════════════════════════════════════════════
    // FACILITATOR FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function claimSettlement(
        address agent,
        uint256 amount,
        bytes32 merkleRoot
    ) external;

    function submitProofs(
        address agent,
        CallData[] calldata calls,
        bytes32[][] calldata proofs
    ) external;

    function finalizeDispute(address agent) external;

    function facilitatorConfirm(address agent) external;

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getChannel(address agent) external view returns (Channel memory);

    function getChannelStatus(
        address agent
    ) external view returns (ChannelStatus);

    function getFacilitatorBond(
        address facilitator
    ) external view returns (uint256);

    function isCallProven(
        address agent,
        bytes32 callId
    ) external view returns (bool);
}
