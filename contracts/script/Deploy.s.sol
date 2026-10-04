// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {Till} from "../src/Till.sol";

/// forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    /// Agora AUSD on Monad testnet (docs.agora.finance/developer/contract-deployments).
    address constant MONAD_TESTNET_AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    /// The forwarder deployed with the first Till; reused so every Till trusts the same one.
    address constant FORWARDER = 0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1;

    function run() external {
        vm.startBroadcast();
        // A fresh chain gets its own forwarder; Monad testnet reuses the deployed one.
        address fwd = block.chainid == 10143 && FORWARDER.code.length > 0 ? FORWARDER : address(new ERC2771Forwarder("Till"));
        Till till = new Till(IERC20(MONAD_TESTNET_AUSD), fwd);
        vm.stopBroadcast();
        console.log("forwarder", fwd);
        console.log("till", address(till));
    }
}
