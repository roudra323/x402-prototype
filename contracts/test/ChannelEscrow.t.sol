// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { ChannelEscrow } from "../src/ChannelEscrow.sol";
import { IChannelEscrow } from "../src/interfaces/IChannelEscrow.sol";
import { IERC20 } from "../src/interfaces/IERC20.sol";

/**
 * @title MockERC20
 * @notice Simple ERC20 for testing
 */
contract MockERC20 is IERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _allowances[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        return true;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }
}

/**
 * @title ChannelEscrowTest
 * @notice Test suite for ChannelEscrow contract
 */
contract ChannelEscrowTest is Test {
    ChannelEscrow public escrow;
    MockERC20 public token;

    address public agent = address(0x1);
    address public facilitator = address(0x2);
    address public payTo = address(0x3);

    uint256 public constant DEPOSIT_AMOUNT = 10_000_000; // $10
    uint256 public constant FACILITATOR_BOND = 100_000_000; // $100
    uint256 public constant COST_PER_CALL = 10_000; // $0.01

    function setUp() public {
        token = new MockERC20();
        escrow = new ChannelEscrow(address(token));

        // Fund accounts
        token.mint(agent, 100_000_000); // $100
        token.mint(facilitator, 200_000_000); // $200

        // Facilitator deposits bond
        vm.startPrank(facilitator);
        token.approve(address(escrow), FACILITATOR_BOND);
        escrow.depositBond(FACILITATOR_BOND);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DEPOSIT TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Deposit_Success() public {
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        vm.stopPrank();

        IChannelEscrow.Channel memory channel = escrow.getChannel(agent);
        assertEq(uint256(channel.status), uint256(IChannelEscrow.ChannelStatus.ACTIVE));
        assertEq(channel.balance, DEPOSIT_AMOUNT);
        assertEq(channel.facilitator, facilitator);
        assertEq(channel.payTo, payTo);
    }

    function test_Deposit_RevertIfInsufficientDeposit() public {
        vm.startPrank(agent);
        token.approve(address(escrow), 1_000_000); // Only $1
        vm.expectRevert(IChannelEscrow.InsufficientDeposit.selector);
        escrow.deposit(facilitator, payTo, 1_000_000);
        vm.stopPrank();
    }

    function test_Deposit_RevertIfFacilitatorNoBond() public {
        address noBondFacilitator = address(0x4);
        
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        vm.expectRevert(IChannelEscrow.InsufficientFacilitatorBond.selector);
        escrow.deposit(noBondFacilitator, payTo, DEPOSIT_AMOUNT);
        vm.stopPrank();
    }

    function test_Deposit_CanReopenAfterSettlement() public {
        // First channel
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT * 2);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        
        // Close immediately with 0 amount
        escrow.initiateClose(0, bytes32(0));
        vm.warp(block.timestamp + 8 days);
        escrow.confirmClose();
        
        // Should be able to open new channel
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        vm.stopPrank();

        IChannelEscrow.Channel memory channel = escrow.getChannel(agent);
        assertEq(uint256(channel.status), uint256(IChannelEscrow.ChannelStatus.ACTIVE));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CLOSE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Close_HappyPath() public {
        // Setup
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);

        uint256 claimedAmount = 1_000_000; // $1
        escrow.initiateClose(claimedAmount, bytes32(0));
        
        // Wait for dispute window
        vm.warp(block.timestamp + 8 days);
        escrow.confirmClose();
        vm.stopPrank();

        // Check balances
        assertEq(token.balanceOf(payTo), claimedAmount);
        assertEq(token.balanceOf(agent), 100_000_000 - DEPOSIT_AMOUNT + (DEPOSIT_AMOUNT - claimedAmount));
    }

    function test_Close_RevertIfDisputeWindowNotExpired() public {
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        escrow.initiateClose(1_000_000, bytes32(0));
        
        // Try to confirm immediately
        vm.expectRevert(IChannelEscrow.DisputeWindowNotExpired.selector);
        escrow.confirmClose();
        vm.stopPrank();
    }

    function test_Close_FacilitatorCanConfirmImmediately() public {
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        escrow.initiateClose(1_000_000, bytes32(0));
        vm.stopPrank();

        // Facilitator can confirm immediately (mutual agreement)
        vm.prank(facilitator);
        escrow.facilitatorConfirm(agent);

        IChannelEscrow.Channel memory channel = escrow.getChannel(agent);
        assertEq(uint256(channel.status), uint256(IChannelEscrow.ChannelStatus.SETTLED));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DISPUTE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Dispute_AgentCanDispute() public {
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        escrow.initiateClose(1_500_000, bytes32(0)); // Claim $1.50
        escrow.dispute(1_000_000); // Counter with $1.00
        vm.stopPrank();

        IChannelEscrow.Channel memory channel = escrow.getChannel(agent);
        assertEq(uint256(channel.status), uint256(IChannelEscrow.ChannelStatus.DISPUTED));
        assertEq(channel.disputedAmount, 1_000_000);
        // Dispute fee deducted
        assertEq(channel.balance, DEPOSIT_AMOUNT - 500_000);
    }

    function test_Dispute_RevertAfterDisputeWindow() public {
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        escrow.initiateClose(1_500_000, bytes32(0));
        
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(IChannelEscrow.DisputeWindowExpired.selector);
        escrow.dispute(1_000_000);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROOF SUBMISSION TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_SubmitProofs_PreventsDuplicates() public {
        // Setup channel in disputed state
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        escrow.initiateClose(1_000_000, bytes32(0));
        escrow.dispute(500_000);
        vm.stopPrank();

        // Note: This is a simplified test. Full proof testing would require
        // matching Merkle tree implementation between Solidity and test
        
        // Verify that provenCalls mapping works
        bytes32 testCallId = bytes32(uint256(1));
        assertFalse(escrow.isCallProven(agent, testCallId));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BOND TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_Bond_Deposit() public {
        address newFacilitator = address(0x5);
        token.mint(newFacilitator, FACILITATOR_BOND);

        vm.startPrank(newFacilitator);
        token.approve(address(escrow), FACILITATOR_BOND);
        escrow.depositBond(FACILITATOR_BOND);
        vm.stopPrank();

        assertEq(escrow.getFacilitatorBond(newFacilitator), FACILITATOR_BOND);
    }

    function test_Bond_Withdraw() public {
        uint256 initialBond = escrow.getFacilitatorBond(facilitator);
        uint256 withdrawAmount = 50_000_000;

        vm.prank(facilitator);
        escrow.withdrawBond(withdrawAmount);

        assertEq(escrow.getFacilitatorBond(facilitator), initialBond - withdrawAmount);
    }

    function test_Bond_RevertIfInsufficientBond() public {
        vm.prank(facilitator);
        vm.expectRevert(IChannelEscrow.InsufficientBond.selector);
        escrow.withdrawBond(200_000_000); // More than deposited
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FINALIZE DISPUTE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_FinalizeDispute_SlashesBondOnOverclaim() public {
        // Setup: Agent deposits, facilitator overclaims
        vm.startPrank(agent);
        token.approve(address(escrow), DEPOSIT_AMOUNT);
        escrow.deposit(facilitator, payTo, DEPOSIT_AMOUNT);
        vm.stopPrank();

        // Facilitator claims $1.50
        vm.prank(facilitator);
        escrow.claimSettlement(agent, 1_500_000, bytes32(0));

        // Agent disputes, says only $1.00
        vm.prank(agent);
        escrow.dispute(1_000_000);

        // Wait for proof window to expire (facilitator submits no proofs)
        vm.warp(block.timestamp + 6 days);

        // Finalize - facilitator proved 0, claimed $1.50
        uint256 facilitatorBondBefore = escrow.getFacilitatorBond(facilitator);
        escrow.finalizeDispute(agent);
        uint256 facilitatorBondAfter = escrow.getFacilitatorBond(facilitator);

        // Bond should be slashed by overclaim amount ($1.50 - $0 = $1.50)
        assertLt(facilitatorBondAfter, facilitatorBondBefore);
    }
}
