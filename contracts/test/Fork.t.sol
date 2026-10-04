// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Till} from "../src/Till.sol";

interface IUSDC {
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
}

/// Rehearsal on a fork of Monad testnet with Circle's real USDC (permit and transferWithAuthorization).
/// Run: forge test --match-contract Fork --fork-url monad_testnet
contract ForkTest is Test {
    IERC20 constant USDC = IERC20(0x534b2f3A21130d7a60830c2Df862319e593943A3);

    function test_realUsdcGaslessFlow() public {
        if (block.chainid != 10143) return; // only on a Monad testnet fork
        ERC2771Forwarder fwd = new ERC2771Forwarder("Till");
        Till till = new Till(USDC, address(fwd));
        uint256 clientKey = 0xA11CE;
        address client = vm.addr(clientKey);
        address freelancer = makeAddr("freelancer");
        address keeper = makeAddr("keeper");
        deal(address(USDC), client, 25e6);

        // Client opens with a permit, relayed: no gas, no approval transaction.
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 permitHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                client, address(till), 10e6, IERC20Permit(address(USDC)).nonces(client), deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(clientKey, MessageHashUtils.toTypedDataHash(IERC20Permit(address(USDC)).DOMAIN_SEPARATOR(), permitHash));
        vm.prank(client);
        uint256 id = till.openWithPermit(freelancer, address(0), 36e6, 10e6, "Fork rehearsal", deadline, v, r, s);
        assertEq(USDC.balanceOf(address(till)), 10e6);

        vm.prank(freelancer);
        till.clockIn(id);
        vm.warp(block.timestamp + 100);
        vm.prank(keeper);
        till.settle(id);
        assertEq(USDC.balanceOf(freelancer), 1e6, "100 seconds at $36/h");

        // The freelancer sends their pay on with an EIP-3009 authorization a relayer submits.
        uint256 freelancerKey = 0xF2EE;
        address wallet = vm.addr(freelancerKey);
        vm.prank(freelancer);
        USDC.transfer(wallet, 1e6);
        bytes32 nonce = keccak256("cash-out-1");
        bytes32 authHash = keccak256(
            abi.encode(
                keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
                wallet, keeper, 1e6, 0, block.timestamp + 1 hours, nonce
            )
        );
        (v, r, s) = vm.sign(freelancerKey, MessageHashUtils.toTypedDataHash(IERC20Permit(address(USDC)).DOMAIN_SEPARATOR(), authHash));
        IUSDC(address(USDC)).transferWithAuthorization(wallet, keeper, 1e6, 0, block.timestamp + 1 hours, nonce, v, r, s);
        assertEq(USDC.balanceOf(keeper), 1e6);

        vm.prank(client);
        till.close(id);
        assertEq(USDC.balanceOf(client), 25e6 - 1e6);
    }
}
