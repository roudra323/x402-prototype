// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import { ChannelEscrow } from "../src/ChannelEscrow.sol";
import { MockUSDC } from "../src/MockUSDC.sol";

/**
 * @title DeployCronosScript
 * @notice Deploys all contracts to Cronos Testnet
 * 
 * Prerequisites:
 *   1. Get Cronos Testnet CRO from faucet: https://cronos.org/faucet
 *   2. Set PRIVATE_KEY environment variable
 *   
 * Usage:
 *   export PRIVATE_KEY=0x...
 *   forge script script/DeployCronos.s.sol:DeployCronosScript \
 *     --rpc-url https://evm-t3.cronos.org \
 *     --broadcast \
 *     --verify
 */
contract DeployCronosScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("===================================================================");
        console.log("  x402 Channel Prototype - Cronos Testnet Deployment");
        console.log("===================================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("Network: Cronos Testnet (Chain ID: 338)");
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockUSDC (for testnet only)
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        // 2. Deploy ChannelEscrow
        ChannelEscrow escrow = new ChannelEscrow(address(usdc));
        console.log("ChannelEscrow deployed at:", address(escrow));

        // 3. Mint USDC to deployer
        usdc.mint(deployer, 10_000 * 10**6); // 10,000 USDC
        console.log("Minted 10,000 USDC to deployer");

        // 4. Deposit facilitator bond
        usdc.approve(address(escrow), 100 * 10**6);
        escrow.depositBond(100 * 10**6);
        console.log("Deposited $100 facilitator bond");

        vm.stopBroadcast();

        console.log("");
        console.log("===================================================================");
        console.log("  Deployment Complete!");
        console.log("===================================================================");
        console.log("");
        console.log("Contract Addresses:");
        console.log("  MockUSDC:       ", address(usdc));
        console.log("  ChannelEscrow:  ", address(escrow));
        console.log("");
        console.log("View on Cronos Testnet Explorer:");
        console.log("  https://explorer.cronos.org/testnet/address/<ADDRESS>");
        console.log("");
        console.log("Update HACKATHON_SUBMISSION.md with these addresses!");
        console.log("");
    }
}
