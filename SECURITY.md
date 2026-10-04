# Security

Till holds clients' budgets in a contract and pays freelancers by the second. This page lists who can move money, what each piece trusts, and how each attack we could think of is stopped. Every claim points at code or a test.

## Who can move money

| Money | Can only go to | Who can trigger it | Code |
|---|---|---|---|
| A tab's earned pay | The tab's freelancer (`payee`) | Anyone, through `settle` / `settleMany` | `Till._settle` |
| A tab's unspent budget | The client who opened it (`payer`) | The client or the freelancer, through `close` | `Till.close` |
| A new budget or top-up | Into the tab | Only the client's own signature (USDC permit or approval) | `Till._open`, `Till._topUp` |

There is no owner, no admin key, no upgrade path and no fee switch. Nobody, including us, can redirect a budget.

## Trust boundaries

- **Relayer (keeper key).** It pays gas and submits signed requests through OpenZeppelin's `ERC2771Forwarder`. It cannot forge a request: the forwarder checks the user's EIP-712 signature and nonce, and `Till` reads the caller from the forwarder only. The worst a relayer can do is refuse to submit, and users can then call `Till` directly from any wallet.
- **Forwarder.** OpenZeppelin v5.4 `ERC2771Forwarder`, unmodified. `Till` trusts exactly one forwarder, fixed at deployment.
- **USDC.** Circle's USDC on Monad testnet (`0x534b2f3A21130d7a60830c2Df862319e593943A3`), checked against developers.circle.com. Permits and transfer authorisations are verified by USDC itself.
- **Exchange rates.** Shown for reading only (open.er-api.com, cached six hours). They never touch the contract or any amount that moves.
- **Practice wallets.** A browser-only key for trying the app with test USDC. Email sign-in uses Privy's embedded wallet instead.

## Attacks and what stops them

| Attack | What stops it | Proof |
|---|---|---|
| Steal an invite by copying the claim from the mempool | The invite key signs `(contract, chain, tab, claimer)`; a copied signature only works for the original claimer | `test_inviteClaimCannotBeStolen` |
| Claim an invite twice | The invite key is wiped on the first claim | `test_inviteClaimCannotBeStolen` |
| A stranger clocks out, pauses or closes someone's tab | Only the payee can clock in; payer or payee for clock-out and close; payer only for hold, rate, top-up | `test_onlyTheRightPeopleTouchTheClock` |
| Freelancer earns past the budget | Earnings are capped at the budget; time past it is never owed, even after a top-up | `test_budgetCapsPayAndTopUpRestartsTheShift` |
| Client changes the rate mid-shift | `setRate` only works while the clock is stopped | `test_onlyTheRightPeopleTouchTheClock` |
| Rounding drift leaves money stuck or overpays | At close, freelancer received plus client refund equals the budget exactly, across 1,000 fuzzed schedules | `testFuzz_moneyIsConserved` |
| Relayer replays a signed request | Forwarder nonces; requests expire after 10 minutes | OpenZeppelin `ERC2771Forwarder` |
| Front-running a permit to make `openWithPermit` fail | A failed permit is ignored if the allowance is already there | `Till._permit` |
| Reentrancy through the token | Transient-storage reentrancy guard on every function that moves tokens; state is written before transfers | `ReentrancyGuardTransient` |
| Relayer drained by spam | The relayer only pays for `Till` calls, verifies the signature and simulates the call before sending, and rate-limits per signer | `web/app/api/relay/route.ts` |
| Faucet drained | One drip per address per hour, four per IP per hour, refused when the wallet already holds 5 USDC | `web/app/api/faucet/route.ts` |
| Logged invite keys | The invite key travels after `#` in the link, so it never reaches a server log | `web/lib/invite.ts` |

## Monad specifics

- **Gas limit is charged, not gas used.** Every transaction the relayer, faucet and bots send uses the chain's own estimate plus 15% (25% for the forwarded call). Nothing uses a blanket limit.
- **Parallel execution.** Pay accrues from timestamps and settles per tab; the only shared counter is `tabCount`, written once when a tab opens. Settling and clocking never touch shared storage.
- **Log queries are capped at 100 blocks on public RPCs.** Each tab stores the block of its last change, and every change emits `Activity(id, prevBlock)`, so the history is read one exact block at a time with no indexer.

## Out of scope for the hackathon

- Disputes about the quality of work. Till pays for time on the clock; either side can stop at any second, so the most either can lose is the seconds since the last check.
- Proof that the freelancer was actually working while clocked in. The client watches the tab live and can pause pay at once.
- Mainnet deployment. Till runs on Monad testnet with test USDC.

## Reporting

Open an issue on the repository or email rohanboradevit@gmail.com.
