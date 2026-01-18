// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";
import {IChannelEscrow} from "./interfaces/IChannelEscrow.sol";
import {MerkleVerifier} from "./MerkleVerifier.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";

/**
 * @title ChannelEscrow
 * @notice Escrow contract for x402 channel payment scheme
 * @dev Supports deposit, checkpoint-based settlement, and Merkle proof disputes
 */
contract ChannelEscrow is IChannelEscrow {
    using MerkleVerifier for bytes32;
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant MIN_DEPOSIT = 10e6; // $10 in USDC (6 decimals)
    uint256 public constant DISPUTE_WINDOW = 7 days; // Time for agent to dispute
    uint256 public constant PROOF_WINDOW = 5 days; // Time for facilitator to prove
    uint256 public constant DISPUTE_FEE = 500_000; // $0.50 dispute fee
    uint256 public constant FACILITATOR_BOND = 100_000_000; // $100 facilitator bond

    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════

    IERC20 public immutable token; // USDC token

    mapping(address => Channel) public channels;

    // Track which calls have been proven to prevent duplicate proof submissions
    mapping(address => mapping(bytes32 => bool)) public provenCalls;

    // Track facilitator bonds
    mapping(address => uint256) public facilitatorBonds;

    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _token) {
        token = IERC20(_token);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FACILITATOR BOND FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit bond as a facilitator
     * @param amount Amount to deposit as bond
     */
    function depositBond(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        facilitatorBonds[msg.sender] += amount;

        emit BondDeposited(msg.sender, amount, facilitatorBonds[msg.sender]);
    }

    /**
     * @notice Withdraw bond (only if not actively facilitating disputed channels)
     * @param amount Amount to withdraw
     */
    function withdrawBond(uint256 amount) external {
        if (facilitatorBonds[msg.sender] < amount) revert InsufficientBond();

        facilitatorBonds[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);

        emit BondWithdrawn(msg.sender, amount, facilitatorBonds[msg.sender]);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AGENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Open a new channel by depositing funds
     * @param facilitator Address of the facilitator
     * @param payTo Address to receive payments (server)
     * @param amount Amount to deposit
     */
    function deposit(
        address facilitator,
        address payTo,
        uint256 amount
    ) external {
        if (amount < MIN_DEPOSIT) revert InsufficientDeposit();

        ChannelStatus currentStatus = channels[msg.sender].status;
        // Allow opening if INACTIVE or SETTLED (enables channel reuse)
        if (
            currentStatus != ChannelStatus.INACTIVE &&
            currentStatus != ChannelStatus.SETTLED
        ) {
            revert ChannelNotInactive();
        }

        // Verify facilitator has sufficient bond
        if (facilitatorBonds[facilitator] < FACILITATOR_BOND) {
            revert InsufficientFacilitatorBond();
        }

        token.safeTransferFrom(msg.sender, address(this), amount);

        // Clear any previous proven calls for this agent
        // Note: In production, you'd want a more gas-efficient approach

        channels[msg.sender] = Channel({
            agent: msg.sender,
            facilitator: facilitator,
            payTo: payTo,
            balance: amount,
            claimedAmount: 0,
            disputedAmount: 0,
            provenAmount: 0,
            checkpointRoot: bytes32(0),
            checkpointAmount: 0,
            disputeDeadline: 0,
            proofDeadline: 0,
            status: ChannelStatus.ACTIVE
        });

        emit ChannelOpened(msg.sender, facilitator, amount);
    }

    /**
     * @notice Add more funds to an existing channel
     * @param amount Amount to add
     */
    function topUp(uint256 amount) external {
        Channel storage channel = channels[msg.sender];
        if (channel.status != ChannelStatus.ACTIVE) revert ChannelNotActive();

        token.safeTransferFrom(msg.sender, address(this), amount);
        channel.balance += amount;

        emit ChannelToppedUp(msg.sender, amount, channel.balance);
    }

    /**
     * @notice Initiate channel close with acknowledged amount
     * @param acknowledgedAmount Amount agent agrees to pay
     * @param checkpointRoot Last checkpoint Merkle root
     */
    function initiateClose(
        uint256 acknowledgedAmount,
        bytes32 checkpointRoot
    ) external {
        Channel storage channel = channels[msg.sender];
        if (channel.status != ChannelStatus.ACTIVE) revert ChannelNotActive();
        if (acknowledgedAmount > channel.balance) revert InsufficientBalance();

        channel.claimedAmount = acknowledgedAmount;
        channel.checkpointRoot = checkpointRoot;
        channel.checkpointAmount = acknowledgedAmount;
        channel.disputeDeadline = block.timestamp + DISPUTE_WINDOW;
        channel.status = ChannelStatus.CLOSING;

        emit CloseInitiated(msg.sender, msg.sender, acknowledgedAmount);
    }

    /**
     * @notice Confirm the claimed settlement
     * @dev Can only be called after dispute window expires OR by facilitator agreeing
     */
    function confirmClose() external {
        Channel memory channel = channels[msg.sender];
        if (channel.status != ChannelStatus.CLOSING) revert ChannelNotClosing();

        // Agent can only confirm after dispute window expires
        // This prevents bypassing the facilitator's right to contest
        if (block.timestamp <= channel.disputeDeadline) {
            revert DisputeWindowNotExpired();
        }

        _settle(msg.sender, channel.claimedAmount);
    }

    /**
     * @notice Facilitator confirms the agent's claimed amount (mutual agreement)
     * @param agent Address of the agent
     */
    function facilitatorConfirm(address agent) external {
        Channel memory channel = channels[agent];
        if (channel.status != ChannelStatus.CLOSING) revert ChannelNotClosing();
        if (msg.sender != channel.facilitator) revert Unauthorized();

        // Facilitator agrees - settle immediately without waiting for dispute window
        _settle(agent, channel.claimedAmount);
    }

    /**
     * @notice Agent disputes the facilitator's claim
     * @param counterAmount Amount agent believes is correct
     */
    function dispute(uint256 counterAmount) external {
        Channel storage channel = channels[msg.sender];
        if (channel.status != ChannelStatus.CLOSING) revert ChannelNotClosing();
        if (block.timestamp > channel.disputeDeadline)
            revert DisputeWindowExpired();

        // Charge dispute fee
        if (channel.balance < DISPUTE_FEE) revert InsufficientBalance();
        channel.balance -= DISPUTE_FEE;

        channel.disputedAmount = counterAmount;
        channel.provenAmount = channel.checkpointAmount; // Checkpoint is baseline
        channel.proofDeadline = block.timestamp + PROOF_WINDOW;
        channel.status = ChannelStatus.DISPUTED;

        emit DisputeRaised(msg.sender, counterAmount);
    }

    /**
     * @notice Facilitator disputes the agent's claim (when agent underclaims)
     * @param agent Address of the agent
     * @param counterAmount Amount facilitator believes is correct
     * @param merkleRoot Root of usage Merkle tree to prove claims
     */
    function facilitatorDispute(
        address agent,
        uint256 counterAmount,
        bytes32 merkleRoot
    ) external {
        Channel storage channel = channels[agent];
        if (channel.status != ChannelStatus.CLOSING) revert ChannelNotClosing();
        if (msg.sender != channel.facilitator) revert Unauthorized();
        if (block.timestamp > channel.disputeDeadline)
            revert DisputeWindowExpired();

        // Facilitator claims more than agent acknowledged
        if (counterAmount <= channel.claimedAmount) revert InvalidAmount();

        channel.disputedAmount = counterAmount;
        channel.checkpointRoot = merkleRoot; // Update to facilitator's root
        channel.provenAmount = channel.checkpointAmount;
        channel.proofDeadline = block.timestamp + PROOF_WINDOW;
        channel.status = ChannelStatus.DISPUTED;

        emit DisputeRaised(agent, counterAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FACILITATOR FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Claim settlement for an agent's channel
     * @param agent Address of the agent
     * @param amount Total amount claimed
     * @param merkleRoot Root of usage Merkle tree
     */
    function claimSettlement(
        address agent,
        uint256 amount,
        bytes32 merkleRoot
    ) external {
        Channel storage channel = channels[agent];
        if (channel.status != ChannelStatus.ACTIVE) revert ChannelNotActive();
        if (msg.sender != channel.facilitator) revert Unauthorized();
        if (amount > channel.balance) revert InsufficientBalance();

        channel.claimedAmount = amount;
        channel.checkpointRoot = merkleRoot;
        channel.disputeDeadline = block.timestamp + DISPUTE_WINDOW;
        channel.status = ChannelStatus.CLOSING;

        emit CloseInitiated(agent, msg.sender, amount);
    }

    /**
     * @notice Submit Merkle proofs during dispute
     * @param agent Address of the agent
     * @param calls Array of call data to prove
     * @param proofs Array of Merkle proofs
     */
    function submitProofs(
        address agent,
        CallData[] calldata calls,
        bytes32[][] calldata proofs
    ) external {
        Channel storage channel = channels[agent];
        if (channel.status != ChannelStatus.DISPUTED)
            revert ChannelNotDisputed();
        if (msg.sender != channel.facilitator) revert Unauthorized();
        if (block.timestamp > channel.proofDeadline)
            revert ProofWindowExpired();

        uint256 totalProven = 0;

        for (uint256 i = 0; i < calls.length; i++) {
            bytes32 leaf = MerkleVerifier.computeCallHash(
                calls[i].callId,
                calls[i].cost,
                calls[i].timestamp
            );

            // Skip if this call has already been proven (prevent duplicate submissions)
            if (provenCalls[agent][calls[i].callId]) {
                continue;
            }

            if (
                !MerkleVerifier.verify(leaf, proofs[i], channel.checkpointRoot)
            ) {
                revert InvalidProof();
            }

            // Mark this call as proven
            provenCalls[agent][calls[i].callId] = true;
            totalProven += calls[i].cost;
        }

        channel.provenAmount += totalProven;

        emit ProofSubmitted(agent, calls.length, channel.provenAmount);
    }

    /**
     * @notice Finalize dispute after proof window
     * @param agent Address of the agent
     */
    function finalizeDispute(address agent) external {
        Channel storage channel = channels[agent];
        if (channel.status != ChannelStatus.DISPUTED)
            revert ChannelNotDisputed();
        if (block.timestamp <= channel.proofDeadline)
            revert ProofWindowNotExpired();

        uint256 settlementAmount;

        // Two scenarios:
        // 1. Facilitator disputed agent's underclaim: disputedAmount > claimedAmount
        // 2. Agent disputed facilitator's overclaim: disputedAmount < claimedAmount

        bool facilitatorDisputed = channel.disputedAmount >
            channel.claimedAmount;

        if (facilitatorDisputed) {
            // Facilitator disputed because agent underclaimed
            // Settlement = provenAmount (what facilitator can prove)
            // Capped at disputedAmount (facilitator's claim) and balance
            settlementAmount = channel.provenAmount;
            if (settlementAmount > channel.disputedAmount) {
                settlementAmount = channel.disputedAmount;
            }
            if (settlementAmount > channel.balance) {
                settlementAmount = channel.balance;
            }

            // Agent underclaimed: penalize with additional fee
            // Penalty = 10% of the underclaim amount (how much they tried to cheat)
            if (settlementAmount > channel.claimedAmount) {
                uint256 underclaim = settlementAmount - channel.claimedAmount;
                uint256 penalty = underclaim / 10; // 10% penalty

                // Add penalty to facilitator's payment (deduct from agent refund)
                if (
                    penalty > 0 && channel.balance >= settlementAmount + penalty
                ) {
                    settlementAmount += penalty;
                    emit AgentPenalized(agent, penalty, underclaim);
                }
            }
        } else {
            // Agent disputed because facilitator overclaimed
            // Settlement = provenAmount, capped at agent's counter (disputedAmount)
            settlementAmount = channel.provenAmount;
            if (settlementAmount > channel.disputedAmount) {
                settlementAmount = channel.disputedAmount;
            }

            // Determine if facilitator overclaimed
            bool facilitatorOverclaimed = channel.provenAmount <
                channel.claimedAmount;

            if (facilitatorOverclaimed) {
                // Slash facilitator bond proportionally to overclaim
                uint256 overclaim = channel.claimedAmount -
                    channel.provenAmount;
                uint256 slashAmount = overclaim >
                    facilitatorBonds[channel.facilitator]
                    ? facilitatorBonds[channel.facilitator]
                    : overclaim;

                facilitatorBonds[channel.facilitator] -= slashAmount;

                // Send slashed amount to agent as compensation
                if (slashAmount > 0) {
                    token.safeTransfer(agent, slashAmount);
                }

                emit BondSlashed(channel.facilitator, slashAmount, overclaim);
            }

            // Agent was right (or partially right) - refund dispute fee
            if (settlementAmount <= channel.disputedAmount) {
                channel.balance += DISPUTE_FEE;
            }
        }

        _settle(agent, settlementAmount);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getChannel(address agent) external view returns (Channel memory) {
        return channels[agent];
    }

    function getChannelStatus(
        address agent
    ) external view returns (ChannelStatus) {
        return channels[agent].status;
    }

    function getFacilitatorBond(
        address facilitator
    ) external view returns (uint256) {
        return facilitatorBonds[facilitator];
    }

    function isCallProven(
        address agent,
        bytes32 callId
    ) external view returns (bool) {
        return provenCalls[agent][callId];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function _settle(address agent, uint256 amount) internal {
        Channel storage channel = channels[agent];

        uint256 toPayTo = amount;
        uint256 toAgent = channel.balance - amount;

        // Transfer to server
        if (toPayTo > 0) {
            token.safeTransfer(channel.payTo, toPayTo);
        }

        // Refund to agent
        if (toAgent > 0) {
            token.safeTransfer(agent, toAgent);
        }

        // Clear channel - set to SETTLED (agent can open new channel)
        channel.balance = 0;
        channel.status = ChannelStatus.SETTLED;

        emit ChannelSettled(agent, toPayTo, toAgent);
    }
}
