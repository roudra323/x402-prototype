// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {ChannelEscrow} from "../src/ChannelEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/**
 * @title DeployScript
 * @notice Deploys all contracts for x402 Channel prototype
 *
 * Usage:
 *   # Start Anvil in another terminal:
 *   anvil
 *
 *   # Deploy:
 *   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 */
contract DeployScript is Script {
    function run() external {
        // Get deployer private key from environment or use Anvil's first account
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(
                0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
            )
        );

        address deployer = vm.addr(deployerPrivateKey);

        console.log("===============================================");
        console.log("  x402 Channel Prototype - Deployment Script");
        console.log("===============================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockUSDC
        MockUSDC usdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(usdc));

        // 2. Deploy ChannelEscrow
        ChannelEscrow escrow = new ChannelEscrow(address(usdc));
        console.log("ChannelEscrow deployed at:", address(escrow));

        // 3. Mint USDC to deployer for testing
        usdc.mint(deployer, 10_000 * 10 ** 6); // 10,000 USDC
        console.log("Minted 10,000 USDC to deployer");

        // 4. Deposit facilitator bond
        usdc.approve(address(escrow), 100 * 10 ** 6); // $100 bond
        escrow.depositBond(100 * 10 ** 6);
        console.log("Deposited $100 facilitator bond");

        vm.stopBroadcast();

        console.log("");
        console.log("===============================================");
        console.log("  Deployment Complete!");
        console.log("===============================================");
        console.log("");
        console.log("Set these environment variables:");
        console.log("");
        console.log("  export USDC_ADDRESS=", address(usdc));
        console.log("  export ESCROW_ADDRESS=", address(escrow));
        console.log("  export FACILITATOR_ADDRESS=", deployer);
        console.log("");
    }
}

/**
 * @title SetupAgentScript
 * @notice Sets up an agent wallet with USDC for testing
 */
contract SetupAgentScript is Script {
    function run() external {
        // Anvil's second account
        uint256 agentPrivateKey = vm.envOr(
            "AGENT_PRIVATE_KEY",
            uint256(
                0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
            )
        );

        address agent = vm.addr(agentPrivateKey);
        address usdcAddress = vm.envAddress("USDC_ADDRESS");

        console.log("Setting up agent:", agent);

        vm.startBroadcast(agentPrivateKey);

        MockUSDC usdc = MockUSDC(usdcAddress);
        usdc.faucet(); // Get 1000 USDC

        console.log("Agent USDC balance:", usdc.balanceOf(agent));

        vm.stopBroadcast();
    }
}
