# Security

Till holds clients' budgets in a contract and pays freelancers by the second. This page lists who can move money, what each piece trusts, and how each attack we could think of is stopped. Every claim points at code or a test.

## Who can move money

| Money | Can only go to | Who can trigger it | Code |
|---|---|---|---|
| A tab's earned pay | The tab's freelancer (`payee`) | Anyone, through `settle` / `settleMany` | `Till._settle` |
| A tab's unspent budget | The client who opened it (`payer`) | The client or the freelancer, through `close` | `Till.close` |
| A new budget or top-up | Into the tab | Only the client's own signature (AUSD permit or approval) | `Till._open`, `Till._topUp` |

There is no owner, no admin key, no upgrade path and no fee switch. Nobody, including us, can redirect a budget.

## Trust boundaries

- **Relayer (keeper key).** It pays gas and submits signed requests through OpenZeppelin's `ERC2771Forwarder`. It cannot forge a request: the forwarder checks the user's EIP-712 signature and nonce, and `Till` reads the caller from the forwarder only. The worst a relayer can do is refuse to submit, and users can then call `Till` directly from any wallet.
- **Forwarder.** OpenZeppelin v5.4 `ERC2771Forwarder`, unmodified. `Till` trusts exactly one forwarder, fixed at deployment.
- **AUSD.** Agora's AUSD on Monad testnet (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`), checked against docs.agora.finance. Permits and transfer authorisations are verified by AUSD itself (EIP-712 domain "Agora Dollar", version 1).
- **Exchange rates.** Shown for reading only (open.er-api.com, cached six hours). They never touch the contract or any amount that moves.
- **Practice wallets.** A browser-only key for trying the app with test AUSD. Email sign-in uses Privy's embedded wallet instead.

## Attacks and what stops them

| Attack | What stops it | Proof |
|---|---|---|
| Steal an invite by copying the claim from the mempool | The invite key signs `(contract, chain, tab, claimer)`; a copied signature only works for the original claimer | `test_inviteClaimCannotBeStolen` |
| Claim an invite twice | The invite key is wiped on the first claim | `test_inviteClaimCannotBeStolen` |
| A stranger clocks out, pauses or closes someone's tab | Only the payee can clock in; payer or payee for clock-out and close; payer only for hold, rate, top-up | `test_onlyTheRightPeopleTouchTheClock` |
| Freelancer earns past the budget | Earnings are capped at the budget; time past it is never owed, even after a top-up | `test_budgetCapsPayAndTopUpRestartsTheShift` |
| Client changes the rate mid-shift | `setRate` only works while the clock is stopped | `test_onlyTheRightPeopleTouchTheClock` |
| Rounding drift leaves money stuck or overpays | At close, freelancer received plus client refund equals the budget exactly, across 1,000 fuzzed schedules | `testFuzz_moneyIsConserved` |
| Relayer replays a signed request | Forwarder nonces, checked on chain; the app signs each request with a 10-minute deadline the forwarder enforces | OpenZeppelin `ERC2771Forwarder`, `test_forwarderRejectsReplayExpiryAndForgedFrom` |
| Front-running a permit to make `openWithPermit` fail | A failed permit is ignored if the allowance is already there | `Till._permit` |
| Reentrancy through the token | Transient-storage reentrancy guard on every function that moves tokens; state is written before transfers | `ReentrancyGuardTransient` |
| Relayer drained by spam | The relayer only pays for `Till` calls, verifies the signature, estimates the inner call and refuses requests asking for more than 1.5× that estimate (Monad charges the limit), refuses tabs and top-ups under $0.50, rejects a second copy of a request already in flight, and paces per signer, per IP address and overall | `web/app/api/relay/route.ts` |
| Relayer drained through payouts | `/api/settle` pays at most once per 6 blocks per tab (a throttle every server instance agrees on), skips amounts under half a cent, paces per IP and overall, and stops watch-payouts when the relayer's MON falls below a reserve so clock-ins and closes keep working; the tab page itself slows from every 6 s to every 20 s to once a minute | `web/app/api/settle/route.ts`, `web/app/tab/[id]/page.tsx` |
| Relayer drained through AUSD transfers | `/api/send` relays transfers of at least $0.01 between two different addresses, paced per sender, per IP and overall | `web/app/api/send/route.ts` |
| Faucet drained | One drip per address per hour, six per IP address per hour, 120 an hour per server instance, refused when the wallet already holds 10 AUSD | `web/app/api/faucet/route.ts` |
| Two relayer instances race on a nonce | Sends from one key are serialised within an instance and retried with a fresh nonce across instances; a reverted duplicate costs its gas limit and nothing else | `web/lib/server.ts` |
| Logged invite keys | The invite key travels after `#` in the link, so it never reaches a server log | `web/lib/invite.ts` |

## Monad specifics

- **Gas limit is charged, not gas used.** Every transaction the relayer, faucet and bots send uses the chain's own estimate plus 15%. A forwarded request carries the gas the signer asked for (the app asks for the estimate plus 25%), and the relayer refuses anything above 1.5× its own estimate. Nothing uses a blanket limit.
- **Parallel execution.** Pay accrues from timestamps and settles per tab; the only shared counter is `tabCount`, written once when a tab opens. Settling and clocking never touch shared storage.
- **Log queries are capped at 100 blocks on public RPCs.** Each tab stores the block of its last change, and every change emits `Activity(id, prevBlock)`, so the history is read one exact block at a time with no indexer.

## What the audit found and how it is handled

A second review on Oct 4 added 34 tests (`contracts/test/TillEdges.t.sol`: 32 edge cases and a stateful invariant suite). Nothing on chain needed changing. Three things are worth knowing:

- **Issuer controls on AUSD.** AUSD can freeze accounts. A frozen freelancer blocks `close` on their tab, so the client's refund waits until the freeze lifts (the client can still pause pay); a frozen freelancer also makes a whole `settleMany` batch revert, so the keeper falls back to settling tabs one at a time. A frozen client blocks `close`, but `settle` still pays the freelancer. `test_frozenPayeeLocksRefundAndBreaksBatch`, `test_frozenPayerBlocksCloseButNotSettle`.
- **Unsolicited tabs.** Anyone can open a tab to any address and `tabsOf` has no limit, so the app and the bots read tab lists in pages, and the demo freelancers only clock in on tabs of at least $0.50, a few per minute. `test_dustTabsBloatPayeeTabList`.
- **Rounding.** Pay rounds down once per shift, losing under a millionth of a dollar each time; settling often loses nothing because pay is recomputed from the start of the shift. `test_roundingLossIsUnderOneUnitPerShift`, `test_frequentSettlesLoseNothingToRounding`.

The stateful suite (`TillInvariantTest`) drives random opens, clock-ins and outs, holds, rate changes, top-ups, settles, batch settles, closes and time jumps, and checks after every action that the contract holds exactly what open tabs still owe, that freelancers hold exactly what was paid, that `paid ≤ earned ≤ budget`, and that pay never goes down.

**The relayer is best-effort testnet infrastructure.** Its limits are per server instance and signing costs nothing, so a determined spammer can still burn the keeper's MON. The worst case is that the gasless path pauses; the contract is unaffected and anyone can call it directly from a funded wallet.

## Out of scope for the hackathon

- Disputes about the quality of work. Till pays for time on the clock; either side can stop at any second, so the most either can lose is the seconds since the last check.
- Proof that the freelancer was actually working while clocked in. The client watches the tab live and can pause pay at once.
- Mainnet deployment. Till runs on Monad testnet with test AUSD.

## Reporting

Open an issue on the repository or email rohanboradevit@gmail.com.
