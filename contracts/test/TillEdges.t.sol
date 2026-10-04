// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Till} from "../src/Till.sol";

/// A 6-decimal dollar with permit and an issuer freeze, like Agora's AUSD (`isAccountFrozen` exists on the live token).
contract FreezableUSD is ERC20, ERC20Permit {
    mapping(address => bool) public frozen;

    error AccountFrozen(address who);

    constructor() ERC20("Agora Dollar", "AUSD") ERC20Permit("Agora Dollar") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function freeze(address who, bool on) external {
        frozen[who] = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (frozen[from]) revert AccountFrozen(from);
        if (frozen[to]) revert AccountFrozen(to);
        super._update(from, to, value);
    }
}

/// Edge cases and audit findings that Till.t.sol does not cover. Each test name says what it proves.
contract TillEdgesTest is Test {
    FreezableUSD usd;
    ERC2771Forwarder fwd;
    Till till;

    uint256 clientKey = 0xC11E;
    uint256 freelancerKey = 0xF2EE;
    address client;
    address freelancer;
    address keeper = makeAddr("keeper");
    address stranger = makeAddr("stranger");

    uint64 constant RATE = 30e6; // $30 an hour
    uint128 constant BUDGET = 100e6;
    uint256 constant START = 1_000_000e6;
    bytes32 constant ACTIVITY = keccak256("Activity(uint256,uint64)");

    function setUp() public {
        vm.warp(1_790_000_000);
        usd = new FreezableUSD();
        fwd = new ERC2771Forwarder("Till");
        till = new Till(usd, address(fwd));
        client = vm.addr(clientKey);
        freelancer = vm.addr(freelancerKey);
        usd.mint(client, START);
        vm.prank(client);
        usd.approve(address(till), type(uint256).max);
    }

    // ---------------------------------------------------------------- settling

    function test_settleAfterCloseReturnsZeroAndPaysNothing() public {
        uint256 id = _open();
        _in(id);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(client);
        till.close(id);
        uint256 before = usd.balanceOf(freelancer);

        vm.warp(block.timestamp + 10 hours);
        vm.recordLogs();
        uint128 amount = till.settle(id);
        assertEq(amount, 0, "nothing left to settle on a closed tab");
        assertEq(usd.balanceOf(freelancer), before, "no transfer after close");
        assertEq(vm.getRecordedLogs().length, 0, "a zero settle emits nothing and adds no Activity link");
        assertEq(till.getTab(id).owed, 0, "closed tab owes nothing");
        assertEq(till.getTab(id).runway, 0, "closed tab has no runway");
    }

    function test_settleManySkipsUnknownIdsAndPaysDuplicatesOnce() public {
        uint256 a = _open();
        address ana = makeAddr("ana");
        uint256 b = _openTo(ana, RATE, BUDGET);
        _in(a);
        vm.prank(ana);
        till.clockIn(b);
        vm.warp(block.timestamp + 1 hours);

        uint256[] memory ids = new uint256[](6);
        (ids[0], ids[1], ids[2], ids[3], ids[4], ids[5]) = (a, a, 999, b, 0, a);
        vm.prank(keeper);
        uint256 total = till.settleMany(ids);
        assertEq(total, 2 * uint256(RATE), "each tab paid once");
        assertEq(usd.balanceOf(freelancer), RATE, "duplicate ids do not double pay");
        assertEq(usd.balanceOf(ana), RATE);
        assertEq(usd.balanceOf(address(till)), 2 * uint256(BUDGET) - 2 * uint256(RATE), "escrow holds the rest");

        vm.expectRevert(Till.NoTab.selector);
        till.settle(999); // the single-tab version is strict
    }

    function test_settleOnUnclaimedInvitePaysNothing() public {
        (uint256 id,) = _openInvite();
        vm.warp(block.timestamp + 1 days);
        assertEq(till.settle(id), 0, "no payee yet");
        assertEq(usd.balanceOf(address(till)), BUDGET);
    }

    /// Settling often loses nothing to rounding: pay is recomputed from the shift start, not added per settle.
    function test_frequentSettlesLoseNothingToRounding() public {
        uint256 a = _open();
        address ana = makeAddr("ana");
        uint256 b = _openTo(ana, RATE, BUDGET);
        _in(a);
        vm.prank(ana);
        till.clockIn(b);
        for (uint256 i; i < 600; ++i) {
            vm.warp(block.timestamp + 1);
            till.settle(a);
        }
        till.settle(b);
        assertEq(usd.balanceOf(freelancer), usd.balanceOf(ana), "600 settles pay the same as one");
        assertEq(usd.balanceOf(ana), 600 * uint256(RATE) / 3600);
    }

    /// Info: each shift rounds down on its own, so a client who clocks the freelancer out every second
    /// shaves under one token unit (a millionth of a dollar) per shift. Bounded and negligible at real rates.
    function test_roundingLossIsUnderOneUnitPerShift() public {
        uint256 id = _open();
        for (uint256 i; i < 100; ++i) {
            _in(id);
            vm.warp(block.timestamp + 1);
            vm.prank(client);
            till.clockOut(id);
        }
        uint256 continuous = 100 * uint256(RATE) / 3600;
        uint256 got = till.earned(id);
        assertEq(got, 100 * (uint256(RATE) / 3600), "floor per shift");
        assertLt(continuous - got, 100, "loss below one unit per shift");
    }

    // ---------------------------------------------------------------- invites

    function test_claimEdgeCases() public {
        uint256 direct = _open();
        (address inviteAddr, uint256 inviteKey) = makeAddrAndKey("invite");
        vm.prank(stranger);
        vm.expectRevert(Till.AlreadyClaimed.selector);
        till.claim(direct, _inviteSig(inviteKey, direct, stranger)); // a tab opened to a payee has no invite

        vm.prank(client);
        uint256 id = till.open(address(0), inviteAddr, RATE, BUDGET, "");

        vm.prank(client);
        vm.expectRevert(Till.SelfPay.selector);
        till.claim(id, _inviteSig(inviteKey, id, client));

        (, uint256 otherKey) = makeAddrAndKey("not the invite");
        vm.prank(freelancer);
        vm.expectRevert(Till.BadInvite.selector);
        till.claim(id, _inviteSig(otherKey, id, freelancer));

        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 3));
        till.claim(id, hex"010203"); // Info: malformed signatures surface OZ's error, not BadInvite

        vm.prank(freelancer);
        vm.expectRevert(Till.NoTab.selector);
        till.claim(id + 1, _inviteSig(inviteKey, id + 1, freelancer));

        vm.prank(freelancer);
        till.claim(id, _inviteSig(inviteKey, id, freelancer));
        Till.Tab memory t = till.getTab(id).tab;
        assertEq(t.payee, freelancer);
        assertEq(t.invite, address(0), "invite key wiped");
    }

    function test_holdOnInvitedTabCarriesOverToClaim() public {
        (uint256 id, uint256 inviteKey) = _openInvite();
        vm.prank(stranger);
        vm.expectRevert(Till.NotParty.selector);
        till.close(id); // with no payee yet, only the client can close

        vm.prank(client);
        till.hold(id, true);
        vm.prank(client);
        till.setRate(id, 45e6);

        vm.prank(freelancer);
        till.claim(id, _inviteSig(inviteKey, id, freelancer));
        assertTrue(till.getTab(id).tab.held, "hold survives the claim");

        vm.prank(freelancer);
        vm.expectRevert(Till.OnHold.selector);
        till.clockIn(id);

        vm.prank(client);
        till.hold(id, false);
        _in(id);
        vm.warp(block.timestamp + 1 hours);
        assertEq(till.earned(id), 45e6, "pays at the rate set before the claim");
    }

    function test_invitedTabClosedBeforeClaimRefundsAndClaimFails() public {
        (uint256 id, uint256 inviteKey) = _openInvite();
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(client), START, "full refund");

        vm.prank(freelancer);
        vm.expectRevert(Till.TabClosed.selector);
        till.claim(id, _inviteSig(inviteKey, id, freelancer));
    }

    /// Info: when a payee is given, the invite argument is ignored in storage but still echoed in `Opened`.
    function test_inviteIgnoredWhenPayeeGiven() public {
        (address inviteAddr,) = makeAddrAndKey("invite");
        vm.expectEmit(true, true, true, true, address(till));
        emit Till.Opened(1, client, freelancer, RATE, BUDGET, inviteAddr, "both");
        vm.prank(client);
        uint256 id = till.open(freelancer, inviteAddr, RATE, BUDGET, "both");
        assertEq(till.getTab(id).tab.invite, address(0), "stored invite is zero");
    }

    // ---------------------------------------------------------------- budget and top-ups

    function test_topUpMidShiftKeepsSince() public {
        uint256 id = _open();
        _in(id);
        uint64 start = till.getTab(id).tab.since;
        vm.warp(block.timestamp + 1 hours);

        vm.prank(client);
        till.topUp(id, 50e6);
        Till.Tab memory t = till.getTab(id).tab;
        assertEq(t.since, start, "shift not restarted while budget remains");
        assertEq(t.banked, 0);
        assertEq(till.earned(id), RATE, "no pay added or lost");

        vm.warp(block.timestamp + 2 hours);
        assertEq(till.earned(id), 3 * uint256(RATE));
        vm.warp(block.timestamp + 2 hours);
        assertEq(till.earned(id), 150e6, "five hours fills the new budget exactly");
        vm.warp(block.timestamp + 1 hours);
        assertEq(till.earned(id), 150e6, "capped again");
    }

    function test_topUpExactlyAtExhaustionRestartsShift() public {
        uint256 id = _openTo(freelancer, RATE, 30e6);
        _in(id);
        vm.warp(block.timestamp + 1 hours);
        assertEq(till.earned(id), 30e6, "exactly spent");

        vm.prank(client);
        till.topUp(id, 30e6);
        Till.Tab memory t = till.getTab(id).tab;
        assertEq(t.since, block.timestamp, "restarted from now");
        assertEq(t.banked, 30e6, "old budget banked");
        vm.warp(block.timestamp + 30 minutes);
        assertEq(till.earned(id), 45e6);
    }

    function test_topUpAfterExhaustionDoesNotPayForIdleTime() public {
        uint256 id = _openTo(freelancer, RATE, 30e6);
        _in(id);
        vm.warp(block.timestamp + 5 hours); // four hours past the budget
        vm.prank(client);
        till.topUp(id, 30e6);
        assertEq(till.earned(id), 30e6, "time past the old budget is not owed");
        vm.warp(block.timestamp + 30 minutes);
        assertEq(till.earned(id), 45e6);

        // Clocked out and spent: a top-up leaves the clock alone and lets the freelancer back in.
        vm.warp(block.timestamp + 2 hours);
        vm.prank(freelancer);
        till.clockOut(id);
        vm.prank(freelancer);
        vm.expectRevert(Till.BudgetUsed.selector);
        till.clockIn(id);
        vm.prank(client);
        till.topUp(id, 15e6);
        assertEq(till.getTab(id).tab.since, 0);
        _in(id);
        vm.warp(block.timestamp + 30 minutes);
        assertEq(till.earned(id), 75e6);
    }

    function test_topUpGuards() public {
        uint256 id = _open();
        vm.prank(freelancer);
        vm.expectRevert(Till.NotPayer.selector);
        till.topUp(id, 1);
        vm.prank(client);
        vm.expectRevert(Till.ZeroAmount.selector);
        till.topUp(id, 0);
        vm.prank(client);
        till.close(id);
        vm.prank(client);
        vm.expectRevert(Till.TabClosed.selector);
        till.topUp(id, 1);
    }

    function test_clockInWhenBudgetExactlySpentReverts() public {
        uint256 id = _openTo(freelancer, RATE, 30e6);
        _in(id);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(freelancer);
        till.clockOut(id);
        assertEq(till.getTab(id).tab.banked, 30e6);
        vm.prank(freelancer);
        vm.expectRevert(Till.BudgetUsed.selector);
        till.clockIn(id);

        // One unit left is enough to clock in; pay then caps at the budget within a second.
        uint256 id2 = _openTo(freelancer, RATE, 30e6 + 1);
        _in(id2);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(freelancer);
        till.clockOut(id2);
        _in(id2);
        vm.warp(block.timestamp + 1);
        assertEq(till.earned(id2), 30e6 + 1);
    }

    /// uint64 rate times any timestamp gap fits in uint256, and the cap keeps the uint128 casts safe.
    function test_extremeRateNeverOverflows() public {
        uint256 id = _openTo(freelancer, type(uint64).max, BUDGET);
        _in(id);
        vm.warp(block.timestamp + 1);
        assertEq(till.earned(id), BUDGET, "capped after one second");
        assertEq(till.getTab(id).runway, 0);
        vm.warp(type(uint64).max);
        assertEq(till.earned(id), BUDGET, "no overflow at the end of time");
        till.settle(id);
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(freelancer), BUDGET);
        assertEq(usd.balanceOf(address(till)), 0);
    }

    // ---------------------------------------------------------------- hold, rate, close

    function test_setRateWhileHeldAppliesToNextShift() public {
        uint256 id = _open();
        _in(id);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(client);
        till.hold(id, true);
        vm.prank(client);
        till.setRate(id, 60e6);
        vm.prank(client);
        vm.expectRevert(Till.ZeroRate.selector);
        till.setRate(id, 0);
        vm.prank(client);
        till.hold(id, false);
        _in(id);
        vm.warp(block.timestamp + 30 minutes);
        assertEq(till.earned(id), 30e6 + 30e6, "old rate for the first hour, new rate after");
    }

    function test_closeWhileHeld() public {
        uint256 id = _open();
        _in(id);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(client);
        till.hold(id, true);
        vm.warp(block.timestamp + 5 hours);
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(freelancer), RATE, "only the hour before the hold");
        assertEq(usd.balanceOf(client), START - RATE, "the rest came back");
        assertEq(usd.balanceOf(address(till)), 0);
    }

    function test_payeeClosesMidShiftAndRefundStillGoesToPayer() public {
        uint256 id = _open();
        _in(id);
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(freelancer);
        till.close(id);
        assertEq(usd.balanceOf(freelancer), 15e6);
        assertEq(usd.balanceOf(client), START - 15e6, "refund goes to the payer, never the closer");
        assertEq(till.getTab(id).tab.since, 0);

        vm.prank(freelancer);
        vm.expectRevert(Till.TabClosed.selector);
        till.clockIn(id);
        vm.prank(client);
        vm.expectRevert(Till.TabClosed.selector);
        till.close(id);
    }

    function test_openGuards() public {
        vm.startPrank(client);
        vm.expectRevert(Till.ZeroRate.selector);
        till.open(freelancer, address(0), 0, BUDGET, "");
        vm.expectRevert(Till.ZeroAmount.selector);
        till.open(freelancer, address(0), RATE, 0, "");
        vm.expectRevert(Till.SelfPay.selector);
        till.open(client, address(0), RATE, BUDGET, "");
        vm.expectRevert(Till.BadInvite.selector);
        till.open(address(0), address(0), RATE, BUDGET, "");
        vm.stopPrank();
    }

    /// A tab whose payee is a contract that never calls Till (here Till itself) can never accrue; the client gets everything back.
    function test_payeeThatCannotActNeverAccrues() public {
        vm.prank(client);
        uint256 id = till.open(address(till), address(0), RATE, BUDGET, "");
        vm.prank(client);
        vm.expectRevert(Till.NotPayee.selector);
        till.clockIn(id);
        vm.warp(block.timestamp + 1 days);
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(client), START);
    }

    // ---------------------------------------------------------------- text limits and views

    function test_textLimitsAre48Bytes() public {
        vm.startPrank(freelancer);
        till.setProfile(_str(48), _str(48), "INR");
        assertEq(till.profileOf(freelancer).name, _str(48));
        vm.expectRevert(Till.TextTooLong.selector);
        till.setProfile(_str(49), "", "INR");
        vm.expectRevert(Till.TextTooLong.selector);
        till.setProfile("", _str(49), "INR");
        // The limit counts bytes: sixteen three-byte characters fit, seventeen do not.
        till.setProfile(unicode"日日日日日日日日日日日日日日日日", "", "JPY");
        vm.expectRevert(Till.TextTooLong.selector);
        till.setProfile(unicode"日日日日日日日日日日日日日日日日日", "", "JPY");
        vm.stopPrank();

        vm.prank(client);
        till.open(freelancer, address(0), RATE, BUDGET, _str(48));
        vm.prank(client);
        vm.expectRevert(Till.TextTooLong.selector);
        till.open(freelancer, address(0), RATE, BUDGET, _str(49));
    }

    function test_getTabsWithUnknownIdReturnsZeroView() public {
        uint256 id = _open();
        uint256[] memory ids = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (id, 999, 0);
        Till.TabView[] memory views = till.getTabs(ids);
        assertEq(views[0].tab.payer, client);
        assertEq(views[0].runway, uint256(BUDGET) * 3600 / RATE, "runway of a fresh tab");
        for (uint256 i = 1; i < 3; ++i) {
            assertEq(views[i].id, ids[i], "id echoed");
            assertEq(views[i].tab.payer, address(0), "unknown tab is empty");
            assertEq(views[i].earned, 0);
            assertEq(views[i].owed, 0);
            assertEq(views[i].runway, 0);
        }
        assertEq(till.earned(999), 0);
    }

    /// Two tabs touched in the same block each get their own link; a second touch of one tab in that block adds none.
    function test_activityLinksAreIndependentPerTab() public {
        vm.roll(50);
        uint256 a = _open();
        uint256 b = _open();
        vm.roll(60);
        vm.recordLogs();
        _in(a);
        _in(b);
        vm.prank(client);
        till.hold(a, true); // second action on tab a in block 60
        vm.warp(block.timestamp + 60);
        till.settle(b);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != ACTIVITY) continue;
            uint256 id = uint256(logs[i].topics[1]);
            assertEq(id, n == 0 ? a : b, "one link per tab, in order");
            assertEq(abi.decode(logs[i].data, (uint64)), 50, "each points at its own previous block");
            ++n;
        }
        assertEq(n, 2, "two tabs, two links");
        assertEq(till.getTab(a).tab.lastBlock, 60);
        assertEq(till.getTab(b).tab.lastBlock, 60);
    }

    // ---------------------------------------------------------------- ERC-2771 and permits

    function test_forwarderRejectsReplayExpiryAndForgedFrom() public {
        bytes memory call = abi.encodeCall(Till.setProfile, ("Priya Nair", "Pune", bytes3("INR")));
        ERC2771Forwarder.ForwardRequestData memory req = _request(freelancerKey, freelancer, call, 200_000, uint48(block.timestamp + 600));
        assertTrue(fwd.verify(req));
        vm.prank(keeper);
        fwd.execute(req);
        assertEq(till.profileOf(freelancer).name, "Priya Nair", "relayed call acted as the signer");
        assertFalse(fwd.verify(req), "nonce used");

        vm.prank(keeper);
        vm.expectPartialRevert(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector);
        fwd.execute(req); // replay

        ERC2771Forwarder.ForwardRequestData memory late = _request(freelancerKey, freelancer, call, 200_000, uint48(block.timestamp + 600));
        vm.warp(block.timestamp + 601);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderExpiredRequest.selector, late.deadline));
        fwd.execute(late);

        // The client signs a request that claims to come from the freelancer.
        uint256 id = _open();
        ERC2771Forwarder.ForwardRequestData memory forged =
            _request(clientKey, freelancer, abi.encodeCall(Till.clockIn, (id)), 200_000, uint48(block.timestamp + 600));
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ERC2771Forwarder.ERC2771ForwarderInvalidSigner.selector, client, freelancer));
        fwd.execute(forged);
    }

    /// Appending an address to calldata only means something when the forwarder is the caller.
    function test_spoofedSenderSuffixIgnoredOutsideForwarder() public {
        uint256 id = _open();
        vm.prank(stranger);
        (bool ok, bytes memory ret) = address(till).call(abi.encodePacked(abi.encodeCall(Till.clockIn, (id)), freelancer));
        assertFalse(ok, "suffix ignored");
        assertEq(ret, abi.encodeWithSelector(Till.NotPayee.selector));
    }

    /// Off-chain finding: the forwarder only checks that the call *received* enough gas, so an honest
    /// relay needs far less than `request.gas`. /api/relay sets the limit to request.gas + 70k, and Monad
    /// charges the limit, so a signer who asks for 900k gas makes the keeper pay for 970k.
    function test_forwarderDoesNotNeedRequestGasUpFront() public {
        bytes memory call = abi.encodeCall(Till.setProfile, (_str(48), _str(48), bytes3("INR")));
        ERC2771Forwarder.ForwardRequestData memory req = _request(freelancerKey, freelancer, call, 900_000, uint48(block.timestamp + 600));
        uint256 g = gasleft();
        vm.prank(keeper);
        fwd.execute{gas: 400_000}(req);
        uint256 used = g - gasleft();
        assertEq(till.profileOf(freelancer).name, _str(48), "the call ran in full");
        assertLt(used, 400_000, "well under the 970k the relay route would reserve");
    }

    function test_frontRunPermitDoesNotBlockOpen() public {
        (address newClient, uint256 key) = makeAddrAndKey("new client");
        usd.mint(newClient, 20e6);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(key, newClient, 20e6, deadline);

        vm.prank(stranger);
        usd.permit(newClient, address(till), 20e6, deadline, v, r, s); // copied from the mempool

        vm.prank(newClient);
        uint256 id = till.openWithPermit(freelancer, address(0), RATE, 20e6, "", deadline, v, r, s);
        assertEq(till.getTab(id).tab.payer, newClient);
        assertEq(usd.balanceOf(address(till)), 20e6);
    }

    function test_badPermitFallsBackToAllowance() public {
        (address newClient,) = makeAddrAndKey("new client");
        usd.mint(newClient, 20e6);
        vm.prank(newClient);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(till), 0, 10e6));
        till.openWithPermit(freelancer, address(0), RATE, 10e6, "", block.timestamp, 27, bytes32(0), bytes32(0));

        vm.prank(newClient);
        usd.approve(address(till), 10e6);
        vm.prank(newClient);
        till.openWithPermit(freelancer, address(0), RATE, 10e6, "", block.timestamp, 27, bytes32(0), bytes32(0));
        assertEq(usd.balanceOf(address(till)), 10e6, "garbage permit ignored, approval used");

        // Someone else's permit cannot pull from its signer: the payer is always the caller.
        (address victim, uint256 victimKey) = makeAddrAndKey("victim");
        usd.mint(victim, 50e6);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(victimKey, victim, 50e6, deadline);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(till), 0, 50e6));
        till.openWithPermit(freelancer, address(0), RATE, 50e6, "", deadline, v, r, s);
        assertEq(usd.balanceOf(victim), 50e6);
    }

    // ---------------------------------------------------------------- findings: token freeze and dust

    /// MEDIUM (documented, contract not redeployable): `close` pays the freelancer and refunds the client in
    /// one transaction, so if AUSD freezes the payee the client's refund is stuck until the freeze lifts.
    /// One frozen payee also makes a whole `settleMany` batch revert, so other freelancers go unpaid in it.
    function test_frozenPayeeLocksRefundAndBreaksBatch() public {
        uint256 id = _open();
        address ana = makeAddr("ana");
        uint256 other = _openTo(ana, RATE, BUDGET);
        _in(id);
        vm.prank(ana);
        till.clockIn(other);
        vm.warp(block.timestamp + 1 hours);

        usd.freeze(freelancer, true);
        bytes memory frozenErr = abi.encodeWithSelector(FreezableUSD.AccountFrozen.selector, freelancer);

        vm.expectRevert(frozenErr);
        till.settle(id);
        vm.prank(client);
        vm.expectRevert(frozenErr);
        till.close(id);

        uint256[] memory both = new uint256[](2);
        (both[0], both[1]) = (id, other);
        vm.prank(keeper);
        vm.expectRevert(frozenErr);
        till.settleMany(both);
        assertEq(usd.balanceOf(ana), 0, "an unrelated freelancer is not paid by that batch");

        // The client can still stop pay; the refund waits for the freeze to lift.
        vm.prank(client);
        till.hold(id, true);
        vm.warp(block.timestamp + 10 hours);
        usd.freeze(freelancer, false);
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(freelancer), RATE, "only the hour before the hold");
        assertEq(usd.balanceOf(client), START - 2 * uint256(BUDGET) + (BUDGET - RATE));
    }

    /// LOW: a frozen client blocks `close` for both sides (the refund leg reverts), but `settle` still pays the freelancer.
    function test_frozenPayerBlocksCloseButNotSettle() public {
        uint256 id = _open();
        _in(id);
        vm.warp(block.timestamp + 1 hours);
        usd.freeze(client, true);

        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(FreezableUSD.AccountFrozen.selector, client));
        till.close(id);

        vm.prank(freelancer);
        till.clockOut(id);
        till.settle(id);
        assertEq(usd.balanceOf(freelancer), RATE, "the freelancer still gets paid");
    }

    /// LOW on chain, MEDIUM off chain: anyone can open dust tabs to any payee (1 unit = $0.000001 each,
    /// and the relayer pays the gas). `tabsOf` grows without bound and bots auto clock in on stranger tabs.
    function test_dustTabsBloatPayeeTabList() public {
        usd.mint(stranger, 100);
        vm.prank(stranger);
        usd.approve(address(till), type(uint256).max);
        for (uint256 i; i < 100; ++i) {
            vm.prank(stranger);
            till.open(freelancer, address(0), 1, 1, "");
        }
        uint256[] memory list = till.tabsOf(freelancer);
        assertEq(list.length, 100, "100 tabs for 100 millionths of a dollar");
        uint256 g = gasleft();
        till.getTabs(list);
        assertGt(g - gasleft(), 500_000, "reading the list gets expensive for every client of this payee");
        _in(list[0]); // and each one is a live tab the payee can be lured into clocking in on
    }

    // ---------------------------------------------------------------- fuzz

    /// Top-ups never add pay for past time or take pay away, and at close the money splits exactly.
    function testFuzz_topUpAndSettleConserveMoney(uint64 rate, uint128 budget, uint128[3] memory adds, uint32[4] memory gaps, uint8 pattern) public {
        rate = uint64(bound(rate, 1, 500e6));
        budget = uint128(bound(budget, 1, 1_000e6));
        uint256 id = _openTo(freelancer, rate, budget);
        _in(id);
        uint256 total = budget;
        uint256 last;
        for (uint256 i; i < 4; ++i) {
            vm.warp(block.timestamp + bound(gaps[i], 0, 3 days));
            uint256 e = till.earned(id);
            assertGe(e, last, "pay never goes down");
            assertLe(e, total, "never past the budget");
            last = e;
            if ((pattern >> i) & 1 == 1) till.settle(id);
            if (i < 3) {
                uint128 add = uint128(bound(adds[i], 1, 1_000e6));
                vm.prank(client);
                till.topUp(id, add);
                total += add;
                assertEq(till.earned(id), last, "a top-up neither pays for the past nor takes pay away");
            }
            Till.Tab memory t = till.getTab(id).tab;
            if ((pattern >> (i + 4)) & 1 == 1) {
                if (t.since != 0) {
                    vm.prank(client);
                    till.clockOut(id);
                } else if (till.earned(id) < t.budget) {
                    _in(id);
                }
            }
        }
        uint256 earnedAtClose = till.earned(id);
        vm.prank(client);
        till.close(id);
        assertEq(usd.balanceOf(freelancer), earnedAtClose, "freelancer gets what was earned");
        assertEq(usd.balanceOf(client), START - earnedAtClose, "client gets the rest of every deposit");
        assertEq(usd.balanceOf(address(till)), 0, "nothing stuck");
    }

    // ---------------------------------------------------------------- helpers

    function _open() internal returns (uint256 id) {
        id = _openTo(freelancer, RATE, BUDGET);
    }

    function _openTo(address payee, uint64 rate, uint128 budget) internal returns (uint256 id) {
        vm.prank(client);
        id = till.open(payee, address(0), rate, budget, "Edge");
    }

    function _openInvite() internal returns (uint256 id, uint256 inviteKey) {
        address inviteAddr;
        (inviteAddr, inviteKey) = makeAddrAndKey("invite");
        vm.prank(client);
        id = till.open(address(0), inviteAddr, RATE, BUDGET, "");
    }

    function _in(uint256 id) internal {
        vm.prank(till.getTab(id).tab.payee);
        till.clockIn(id);
    }

    function _str(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; ++i) b[i] = "a";
        return string(b);
    }

    function _inviteSig(uint256 key, uint256 id, address claimer) internal view returns (bytes memory) {
        // Rebuilt here rather than read from till.inviteDigest, so it never consumes a pending vm.prank
        // and independently checks the digest layout the web app signs.
        bytes32 inner = keccak256(abi.encode(keccak256("TILL_INVITE_V1"), address(till), block.chainid, id, claimer));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toEthSignedMessageHash(inner));
        return abi.encodePacked(r, s, v);
    }

    function _permitSig(uint256 key, address owner, uint256 value, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(till),
                value,
                usd.nonces(owner),
                deadline
            )
        );
        return vm.sign(key, MessageHashUtils.toTypedDataHash(usd.DOMAIN_SEPARATOR(), structHash));
    }

    function _request(uint256 key, address from, bytes memory data, uint256 gas, uint48 deadline)
        internal
        view
        returns (ERC2771Forwarder.ForwardRequestData memory req)
    {
        req = ERC2771Forwarder.ForwardRequestData({
            from: from, to: address(till), value: 0, gas: gas, deadline: deadline, data: data, signature: ""
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _forwardDigest(req));
        req.signature = abi.encodePacked(r, s, v);
    }

    function _forwardDigest(ERC2771Forwarder.ForwardRequestData memory req) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"),
                req.from,
                req.to,
                req.value,
                req.gas,
                fwd.nonces(req.from),
                req.deadline,
                keccak256(req.data)
            )
        );
        return MessageHashUtils.toTypedDataHash(_forwarderDomain(), structHash);
    }

    function _forwarderDomain() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = fwd.eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
    }
}

/// Drives random sequences of every money-moving and clock action across several tabs.
contract TillHandler is Test {
    Till public till;
    FreezableUSD public usd;
    address[3] public payers;
    address[3] public payees;
    uint256[] public ids;
    mapping(uint256 => uint256) public lastEarned;
    bool public earnedWentDown;

    constructor(Till till_, FreezableUSD usd_, address[3] memory payers_, address[3] memory payees_) {
        till = till_;
        usd = usd_;
        payers = payers_;
        payees = payees_;
    }

    function count() external view returns (uint256) {
        return ids.length;
    }

    function open(uint256 p, uint256 f, uint64 rate, uint128 budget) external {
        if (ids.length >= 16) return;
        rate = uint64(bound(rate, 1, 1_000e6));
        budget = uint128(bound(budget, 1, 500e6));
        vm.prank(payers[p % 3]);
        ids.push(till.open(payees[f % 3], address(0), rate, budget, ""));
        _check();
    }

    function clockIn(uint256 s) external {
        if (ids.length == 0) return;
        (uint256 id, Till.Tab memory t) = _pick(s);
        if (t.closed || t.held || t.since != 0 || till.earned(id) >= t.budget) return;
        vm.prank(t.payee);
        till.clockIn(id);
        _check();
    }

    function clockOut(uint256 s, bool byPayer) external {
        if (ids.length == 0) return;
        (uint256 id, Till.Tab memory t) = _pick(s);
        if (t.closed || t.since == 0) return;
        vm.prank(byPayer ? t.payer : t.payee);
        till.clockOut(id);
        _check();
    }

    function hold(uint256 s, bool on) external {
        if (ids.length == 0) return;
        (uint256 id, Till.Tab memory t) = _pick(s);
        if (t.closed) return;
        vm.prank(t.payer);
        till.hold(id, on);
        _check();
    }

    function setRate(uint256 s, uint64 rate) external {
        if (ids.length == 0) return;
        (uint256 id, Till.Tab memory t) = _pick(s);
        if (t.closed || t.since != 0) return;
        vm.prank(t.payer);
        till.setRate(id, uint64(bound(rate, 1, 1_000e6)));
        _check();
    }

    function topUp(uint256 s, uint128 amount) external {
        if (ids.length == 0) return;
        (uint256 id, Till.Tab memory t) = _pick(s);
        if (t.closed) return;
        vm.prank(t.payer);
        till.topUp(id, uint128(bound(amount, 1, 200e6)));
        _check();
    }

    function settle(uint256 s) external {
        if (ids.length == 0) return;
        (uint256 id,) = _pick(s);
        till.settle(id);
        _check();
    }

    function settleMany(uint256 a, uint256 b) external {
        if (ids.length == 0) return;
        uint256[] memory list = new uint256[](4);
        (list[0],) = _pick(a);
        (list[1],) = _pick(b);
        list[2] = list[0];
        list[3] = 10_000;
        till.settleMany(list);
        _check();
    }

    function close(uint256 s, bool byPayer) external {
        if (ids.length == 0) return;
        (uint256 id, Till.Tab memory t) = _pick(s);
        if (t.closed) return;
        vm.prank(byPayer ? t.payer : t.payee);
        till.close(id);
        _check();
    }

    function wait(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 2 days));
        vm.roll(block.number + 1);
        _check();
    }

    function _pick(uint256 s) internal view returns (uint256 id, Till.Tab memory t) {
        id = ids[s % ids.length];
        t = till.getTab(id).tab;
    }

    function _check() internal {
        for (uint256 i; i < ids.length; ++i) {
            uint256 e = till.earned(ids[i]);
            if (e < lastEarned[ids[i]]) earnedWentDown = true;
            lastEarned[ids[i]] = e;
        }
    }
}

/// Stateful invariants: escrow always equals what open tabs still hold, and every unit is accounted for.
contract TillInvariantTest is Test {
    FreezableUSD usd;
    ERC2771Forwarder fwd;
    Till till;
    TillHandler handler;
    address[3] payers;
    address[3] payees;
    uint256 constant START = 1_000_000_000e6;

    function setUp() public {
        vm.warp(1_790_000_000);
        usd = new FreezableUSD();
        fwd = new ERC2771Forwarder("Till");
        till = new Till(usd, address(fwd));
        for (uint256 i; i < 3; ++i) {
            payers[i] = makeAddr(string.concat("payer", vm.toString(i)));
            payees[i] = makeAddr(string.concat("payee", vm.toString(i)));
            usd.mint(payers[i], START);
            vm.prank(payers[i]);
            usd.approve(address(till), type(uint256).max);
        }
        handler = new TillHandler(till, usd, payers, payees);

        bytes4[] memory sels = new bytes4[](10);
        sels[0] = TillHandler.open.selector;
        sels[1] = TillHandler.clockIn.selector;
        sels[2] = TillHandler.clockOut.selector;
        sels[3] = TillHandler.hold.selector;
        sels[4] = TillHandler.setRate.selector;
        sels[5] = TillHandler.topUp.selector;
        sels[6] = TillHandler.settle.selector;
        sels[7] = TillHandler.settleMany.selector;
        sels[8] = TillHandler.close.selector;
        sels[9] = TillHandler.wait.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_moneyIsAlwaysAccountedFor() public view {
        uint256 escrow;
        uint256 paidOut;
        uint256 spentByPayers;
        for (uint256 i; i < handler.count(); ++i) {
            Till.TabView memory v = till.getTab(handler.ids(i));
            assertLe(v.tab.paid, v.earned, "never paid ahead of earnings");
            assertLe(v.earned, v.tab.budget, "never earned past the budget");
            assertLe(v.tab.banked, v.tab.budget, "banked within the budget");
            if (v.tab.held) assertEq(v.tab.since, 0, "a held tab is clocked out");
            if (v.tab.closed) {
                assertEq(v.tab.since, 0, "a closed tab is clocked out");
                assertEq(v.earned, v.tab.paid, "a closed tab owes nothing");
                spentByPayers += v.tab.paid; // the rest was refunded
            } else {
                escrow += v.tab.budget - v.tab.paid;
                spentByPayers += v.tab.budget;
            }
            paidOut += v.tab.paid;
        }
        assertEq(usd.balanceOf(address(till)), escrow, "escrow equals what open tabs still hold");
        uint256 received;
        uint256 left;
        for (uint256 i; i < 3; ++i) {
            received += usd.balanceOf(payees[i]);
            left += usd.balanceOf(payers[i]);
        }
        assertEq(received, paidOut, "freelancers hold exactly what was paid");
        assertEq(3 * START - left, spentByPayers, "clients are out exactly deposits minus refunds");
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_earnedNeverGoesDown() public view {
        assertFalse(handler.earnedWentDown(), "earned is monotonic through every action");
    }
}
