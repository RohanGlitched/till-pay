// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {Till} from "../src/Till.sol";

/// forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    address constant MONAD_TESTNET_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external {
        vm.startBroadcast();
        ERC2771Forwarder fwd = new ERC2771Forwarder("Till");
        Till till = new Till(IERC20(MONAD_TESTNET_USDC), address(fwd));
        vm.stopBroadcast();
        console.log("forwarder", address(fwd));
        console.log("till", address(till));
    }
}
