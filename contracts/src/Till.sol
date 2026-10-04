// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Till: pay by the second
/// @notice A client opens a tab with a USDC budget and an hourly rate. While the freelancer is
/// clocked in, pay accrues every second and can be settled to their wallet at any block. The
/// client can pause pay or close the tab at any time and gets the unspent budget back at once.
/// @dev Every function reads the caller through ERC-2771, so a relayer can submit signed requests
/// and neither side ever needs gas. Tabs keep their own state and nothing shared is written when
/// pay accrues or settles, so independent tabs never contend for the same storage.
contract Till is ERC2771Context, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Tab {
        address payer; // client who funds the tab
        uint64 rate; // token units per hour
        bool held; // client paused pay: freelancer can't clock in
        bool closed;
        address payee; // freelancer; zero until an invite is claimed
        uint64 since; // clocked in at (unix seconds), zero when clocked out
        address invite; // one-time invite key while the payee is unknown
        uint64 lastBlock; // block of this tab's latest activity (see Activity)
        uint128 budget; // total deposited by the client
        uint128 banked; // pay earned in finished shifts
        uint128 paid; // pay already sent to the freelancer
    }

    struct TabView {
        uint256 id;
        Tab tab;
        uint256 earned; // banked + the running shift, capped at the budget
        uint256 owed; // earned but not yet settled
        uint256 runway; // seconds of clocked-in time the remaining budget covers
    }

    struct Profile {
        string name;
        string place;
        bytes3 currency; // ISO 4217 code the person thinks in, e.g. "INR"
    }

    bytes32 private constant INVITE_TAG = keccak256("TILL_INVITE_V1");
    uint256 private constant MAX_TEXT = 48;

    IERC20 public immutable usdc;
    uint256 public tabCount;
    mapping(uint256 => Tab) internal _tabs;
    mapping(address => uint256[]) internal _tabsOf;
    mapping(address => Profile) internal _profiles;

    event Opened(uint256 indexed id, address indexed payer, address indexed payee, uint64 rate, uint128 budget, address invite, string memo);
    event Claimed(uint256 indexed id, address indexed payee);
    event ClockedIn(uint256 indexed id, uint64 at);
    event ClockedOut(uint256 indexed id, address indexed by, uint128 banked);
    event Held(uint256 indexed id, bool held);
    event RateChanged(uint256 indexed id, uint64 rate);
    event ToppedUp(uint256 indexed id, uint128 amount, uint128 budget);
    event Settled(uint256 indexed id, address indexed payee, uint128 amount, uint128 paid);
    event Closed(uint256 indexed id, uint128 paid, uint128 refunded);
    /// @notice Emitted with every change to a tab. prevBlock is the block of the tab's previous
    /// activity, so a reader can walk a tab's whole history with one exact-block log query per step.
    event Activity(uint256 indexed id, uint64 prevBlock);
    event ProfileSet(address indexed who, string name, string place, bytes3 currency);

    error NoTab();
    error NotPayer();
    error NotParty();
    error NotPayee();
    error TabClosed();
    error OnHold();
    error AlreadyIn();
    error NotIn();
    error BudgetUsed();
    error BadInvite();
    error AlreadyClaimed();
    error ZeroAmount();
    error ZeroRate();
    error SelfPay();
    error TextTooLong();

    constructor(IERC20 usdc_, address forwarder) ERC2771Context(forwarder) {
        usdc = usdc_;
    }

    // ---------------------------------------------------------------- opening

    /// @notice Open a tab. Pass a payee, or zero plus an invite key whose private half travels in the invite link.
    function open(address payee, address invite, uint64 rate, uint128 budget, string calldata memo) external nonReentrant returns (uint256) {
        return _open(_msgSender(), payee, invite, rate, budget, memo);
    }

    /// @notice Same as open, approving the deposit with an EIP-2612 permit in the same call.
    function openWithPermit(
        address payee,
        address invite,
        uint64 rate,
        uint128 budget,
        string calldata memo,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256) {
        address payer = _msgSender();
        _permit(payer, budget, deadline, v, r, s);
        return _open(payer, payee, invite, rate, budget, memo);
    }

    /// @notice The freelancer claims an invited tab with a signature from the invite key.
    function claim(uint256 id, bytes calldata inviteSig) external {
        Tab storage t = _live(id);
        if (t.payee != address(0)) revert AlreadyClaimed();
        address me = _msgSender();
        if (me == t.payer) revert SelfPay();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(inviteDigest(id, me));
        if (t.invite == address(0) || ECDSA.recover(digest, inviteSig) != t.invite) revert BadInvite();
        t.payee = me;
        t.invite = address(0);
        _tabsOf[me].push(id);
        _touch(id, t);
        emit Claimed(id, me);
    }

    /// @notice What the invite key signs: binds the claim to this contract, chain, tab and claimer.
    function inviteDigest(uint256 id, address claimer) public view returns (bytes32) {
        return keccak256(abi.encode(INVITE_TAG, address(this), block.chainid, id, claimer));
    }

    // ---------------------------------------------------------------- the clock

    function clockIn(uint256 id) external {
        Tab storage t = _live(id);
        if (_msgSender() != t.payee) revert NotPayee();
        if (t.held) revert OnHold();
        if (t.since != 0) revert AlreadyIn();
        if (_earned(t) >= t.budget) revert BudgetUsed();
        t.since = uint64(block.timestamp);
        _touch(id, t);
        emit ClockedIn(id, t.since);
    }

    /// @notice Either side can stop the clock.
    function clockOut(uint256 id) external {
        Tab storage t = _live(id);
        address me = _msgSender();
        if (me != t.payee && me != t.payer) revert NotParty();
        if (t.since == 0) revert NotIn();
        _stop(id, t, me);
    }

    /// @notice The client pauses pay (stopping the clock) or lets the freelancer clock in again.
    function hold(uint256 id, bool on) external {
        Tab storage t = _live(id);
        address me = _msgSender();
        if (me != t.payer) revert NotPayer();
        if (on && t.since != 0) _stop(id, t, me);
        t.held = on;
        _touch(id, t);
        emit Held(id, on);
    }

    /// @notice New hourly rate for future time. Only while clocked out, so no shift changes price midway.
    function setRate(uint256 id, uint64 rate) external {
        Tab storage t = _live(id);
        if (_msgSender() != t.payer) revert NotPayer();
        if (t.since != 0) revert AlreadyIn();
        if (rate == 0) revert ZeroRate();
        t.rate = rate;
        _touch(id, t);
        emit RateChanged(id, rate);
    }

    // ---------------------------------------------------------------- money

    function topUp(uint256 id, uint128 amount) external nonReentrant {
        _topUp(id, amount);
    }

    function topUpWithPermit(uint256 id, uint128 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        _permit(_msgSender(), amount, deadline, v, r, s);
        _topUp(id, amount);
    }

    /// @notice Send everything earned so far to the freelancer. Anyone may call it; money only ever goes to the payee.
    function settle(uint256 id) external nonReentrant returns (uint128) {
        Tab storage t = _tabs[id];
        if (t.payer == address(0)) revert NoTab();
        return _settle(id, t);
    }

    /// @notice Settle many tabs in one transaction (used by the keeper every few blocks).
    function settleMany(uint256[] calldata ids) external nonReentrant returns (uint256 total) {
        for (uint256 i; i < ids.length; ++i) {
            Tab storage t = _tabs[ids[i]];
            if (t.payer != address(0)) total += _settle(ids[i], t);
        }
    }

    /// @notice Either side ends the tab: the freelancer is paid what they earned, the client gets the rest back.
    function close(uint256 id) external nonReentrant {
        Tab storage t = _live(id);
        address me = _msgSender();
        if (me != t.payer && me != t.payee) revert NotParty();
        if (t.since != 0) _stop(id, t, me);
        _settle(id, t);
        t.closed = true;
        _touch(id, t);
        uint128 refund = t.budget - t.paid;
        if (refund > 0) usdc.safeTransfer(t.payer, refund);
        emit Closed(id, t.paid, refund);
    }

    // ---------------------------------------------------------------- profiles

    function setProfile(string calldata name, string calldata place, bytes3 currency) external {
        if (bytes(name).length > MAX_TEXT || bytes(place).length > MAX_TEXT) revert TextTooLong();
        address me = _msgSender();
        _profiles[me] = Profile(name, place, currency);
        emit ProfileSet(me, name, place, currency);
    }

    // ---------------------------------------------------------------- views

    function profileOf(address who) external view returns (Profile memory) {
        return _profiles[who];
    }

    function tabsOf(address who) external view returns (uint256[] memory) {
        return _tabsOf[who];
    }

    function getTab(uint256 id) public view returns (TabView memory v) {
        Tab storage t = _tabs[id];
        v.id = id;
        v.tab = t;
        v.earned = _earned(t);
        v.owed = v.earned - t.paid;
        if (t.rate > 0 && !t.closed) v.runway = (uint256(t.budget) - v.earned) * 3600 / t.rate;
    }

    function getTabs(uint256[] calldata ids) external view returns (TabView[] memory out) {
        out = new TabView[](ids.length);
        for (uint256 i; i < ids.length; ++i) out[i] = getTab(ids[i]);
    }

    function earned(uint256 id) external view returns (uint256) {
        return _earned(_tabs[id]);
    }

    // ---------------------------------------------------------------- internals

    function _open(address payer, address payee, address invite, uint64 rate, uint128 budget, string calldata memo) internal returns (uint256 id) {
        if (rate == 0) revert ZeroRate();
        if (budget == 0) revert ZeroAmount();
        if (payee == payer) revert SelfPay();
        if (payee == address(0) && invite == address(0)) revert BadInvite();
        if (bytes(memo).length > MAX_TEXT) revert TextTooLong();
        id = ++tabCount;
        _tabs[id] = Tab({
            payer: payer,
            rate: rate,
            held: false,
            closed: false,
            payee: payee,
            since: 0,
            invite: payee == address(0) ? invite : address(0),
            budget: budget,
            banked: 0,
            paid: 0,
            lastBlock: 0
        });
        _touch(id, _tabs[id]);
        _tabsOf[payer].push(id);
        if (payee != address(0)) _tabsOf[payee].push(id);
        usdc.safeTransferFrom(payer, address(this), budget);
        emit Opened(id, payer, payee, rate, budget, invite, memo);
    }

    function _topUp(uint256 id, uint128 amount) internal {
        Tab storage t = _live(id);
        address me = _msgSender();
        if (me != t.payer) revert NotPayer();
        if (amount == 0) revert ZeroAmount();
        // Time worked past the old budget was never earned; restart the running shift from now.
        if (t.since != 0 && _earned(t) >= t.budget) {
            t.banked = t.budget;
            t.since = uint64(block.timestamp);
        }
        t.budget += amount;
        _touch(id, t);
        usdc.safeTransferFrom(me, address(this), amount);
        emit ToppedUp(id, amount, t.budget);
    }

    function _stop(uint256 id, Tab storage t, address by) internal {
        t.banked = uint128(_earned(t));
        t.since = 0;
        _touch(id, t);
        emit ClockedOut(id, by, t.banked);
    }

    function _settle(uint256 id, Tab storage t) internal returns (uint128 amount) {
        if (t.payee == address(0)) return 0;
        amount = uint128(_earned(t)) - t.paid;
        if (amount == 0) return 0;
        t.paid += amount;
        _touch(id, t);
        usdc.safeTransfer(t.payee, amount);
        emit Settled(id, t.payee, amount, t.paid);
    }

    function _touch(uint256 id, Tab storage t) internal {
        if (t.lastBlock == block.number) return; // one link per block; that block's logs hold every event
        emit Activity(id, t.lastBlock);
        t.lastBlock = uint64(block.number);
    }

    function _earned(Tab storage t) internal view returns (uint256 e) {
        e = t.banked;
        if (t.since != 0) e += (block.timestamp - t.since) * t.rate / 3600;
        if (e > t.budget) e = t.budget;
    }

    function _live(uint256 id) internal view returns (Tab storage t) {
        t = _tabs[id];
        if (t.payer == address(0)) revert NoTab();
        if (t.closed) revert TabClosed();
    }

    function _permit(address owner, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) internal {
        // A front-run permit leaves the allowance in place, so a failure here is not fatal.
        try IERC20Permit(address(usdc)).permit(owner, address(this), value, deadline, v, r, s) {} catch {}
    }
}
