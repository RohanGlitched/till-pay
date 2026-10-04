# Verify Till

Everything here can be checked on Monad testnet (chain 10143) without trusting us.

## Deployed contracts

| Contract | Address | Source |
|---|---|---|
| Till | [`0x4720B1FA15a8e3b8AEc7aA6B7b627dCacEaa1b4f`](https://testnet.monadvision.com/address/0x4720B1FA15a8e3b8AEc7aA6B7b627dCacEaa1b4f) | Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/v2/verify/35c9dc31-5c2d-4400-9004-8201d9f8f1c4)) |
| ERC2771Forwarder (OpenZeppelin 5.4, unmodified) | [`0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1`](https://testnet.monadvision.com/address/0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1) | Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/v2/verify/197e7720-567e-4e95-81d2-336d820b0aba)) |
| USDC (Circle) | [`0x534b2f3A21130d7a60830c2Df862319e593943A3`](https://testnet.monadvision.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3) | [Circle's address list](https://developers.circle.com/stablecoins/usdc-contract-addresses) |

Deployment transactions: [forwarder](https://testnet.monadvision.com/tx/0x4ec106a8034299c0146d51b18ef56852c693ee1205eb16c93623fa3958625a15), [Till](https://testnet.monadvision.com/tx/0x01b70c15205c7f32748aa462af61a132bd23d5d16f1831bc6fbd5b722d632881).

## One tab, every action, on chain

`bots/proof.mjs` runs a whole tab with fresh wallets and no gas on either side: every Till action is signed by the client or freelancer and submitted by the relayer through the forwarder. Tab № 4, client `0xe5F9F03F87a226e50016578708B646A4C5D397ce`, freelancer `0x4E6e8C8fbA00Bd2C78FC85415F686845e2072cAc`.

| # | Step | Transaction | Block | Submit to receipt |
|---|---|---|---|---|
| 1 | Fund a fresh client with 1.50 test USDC | [0x91bcf731…](https://testnet.monadvision.com/tx/0x91bcf731211e6873b5c5d815c1a5692114a50297445e2f611199fdbf3d1208a5) | 68,095,311 | 2.58 s |
| 2 | Client sets a profile (gasless) | [0xc08e8009…](https://testnet.monadvision.com/tx/0xc08e8009fa78a7a0a255784aaad429aa9723c8586f0da7f0d99fe8d01fdbe013) | 68,095,321 | 1.57 s |
| 3 | Freelancer sets a profile (gasless) | [0x0836a2c1…](https://testnet.monadvision.com/tx/0x0836a2c1c9571bbb1043139feaae6cd7cc2f030c7b3e4f5e711eb8ac4a8ce3e8) | 68,095,328 | 1.58 s |
| 4 | Open a tab by invite, $36/h, $1 budget (permit) | [0x6f41a3d5…](https://testnet.monadvision.com/tx/0x6f41a3d5d157c215ddbed9e6adca7acfc644bd07403ae2595327ca8eead80d30) | 68,095,337 | 1.55 s |
| 5 | Freelancer claims the invite | [0x7ba3f7fa…](https://testnet.monadvision.com/tx/0x7ba3f7faca737b402b666cca08ceca9dd22ce4e1d0c1e4ca4db42aede1889028) | 68,095,346 | 1.54 s |
| 6 | Freelancer clocks in | [0x89aeadff…](https://testnet.monadvision.com/tx/0x89aeadffa56ba3d153cbe4552b0ab41936fbf7667e58760c4871bf04fdc3ee94) | 68,095,353 | 2.27 s |
| 7 | Payout 1 while working (anyone can settle) | [0x51e02193…](https://testnet.monadvision.com/tx/0x51e02193882ad335be06553034cd7442032d55eb6aa408c32ea86378829f5933) | 68,095,382 | 3.58 s |
| 8 | Payout 2 while working (anyone can settle) | [0xcb422e9d…](https://testnet.monadvision.com/tx/0xcb422e9d62a56ae88efc77986f2a689b45ed7dbafe50a91b6ec7db4dd79f57bc) | 68,095,411 | 3.02 s |
| 9 | Payout 3 while working (anyone can settle) | [0x7aaa94d3…](https://testnet.monadvision.com/tx/0x7aaa94d38f0fbce3fb7d7a49f5c569364e772d657fce5e7aa91dc789a2567fe0) | 68,095,439 | 2.52 s |
| 10 | Client pauses pay (stops the clock) | [0xbf5ebefc…](https://testnet.monadvision.com/tx/0xbf5ebefca555308824c2a3f769817c3955c6c1553a450fcdcd3b9176b905b58d) | 68,095,447 | 0.76 s |
| 11 | Client tops up $0.50 (permit) | [0xc5503d21…](https://testnet.monadvision.com/tx/0xc5503d218213dba1c4b70a5644707f18e001728f6006f7df5d6107097c763069) | 68,095,455 | 1.16 s |
| 12 | Client resumes pay | [0xe1bbd655…](https://testnet.monadvision.com/tx/0xe1bbd655b4ee223530ee91a6b4a8079f8c4a6146a38427831d4265e2c8b5a2da) | 68,095,461 | 1.93 s |
| 13 | Freelancer clocks in again | [0x4e9f7767…](https://testnet.monadvision.com/tx/0x4e9f776710e81f19f206ecf82d88b1e003a3cb0efdf31a0e267b89e43b13eeb5) | 68,095,469 | 0.77 s |
| 14 | Freelancer clocks out | [0x821ed1b4…](https://testnet.monadvision.com/tx/0x821ed1b4e960eb0fca0c426b582904f1d5fb26c239a99d1ea9839c6fcf8a5269) | 68,095,496 | 1.03 s |
| 15 | Final payout | [0x3011dd6a…](https://testnet.monadvision.com/tx/0x3011dd6a630759be90c1599f70f8e54723c3c061ccd67b301e41d9a348eaa147) | 68,095,500 | 1.68 s |
| 16 | Freelancer cashes out $0.3600 (EIP-3009) | [0xb16f5635…](https://testnet.monadvision.com/tx/0xb16f5635f32a405c9c2448f07366f38fab5b4799ad4b1a3c0e737beec0170c7b) | 68,095,507 | 1.31 s |
| 17 | Client closes the tab; unspent budget refunded | [0x6aa10200…](https://testnet.monadvision.com/tx/0x6aa102003a3716644e0a6ce8331c10c44856a4d1026befb2325358b926d11618) | 68,095,514 | 1.35 s |
| 18 | Client's refund returned to the faucet | [0x7a2b7e8d…](https://testnet.monadvision.com/tx/0x7a2b7e8d651b1fba2493cd9fdeb6af9c4ea4d5a022b1f39f8a3a53041ae8d7b9) | 68,095,520 | 1.27 s |

Result: the freelancer was paid **$0.360000** for the seconds on the clock and the client got **$1.140000** back; together exactly the $1.50 deposited. Times are from a laptop in India to Monad's public RPC, including polling for the receipt.

Run it yourself (needs a funded deployer and keeper in `keys/wallets.json`):

```bash
TILL=0x4720B1FA15a8e3b8AEc7aA6B7b627dCacEaa1b4f FORWARDER=0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1 node bots/proof.mjs
```

## Tests

```bash
cd contracts
forge test                                                    # 12 tests, fuzz at 1,000 runs
forge test --match-contract Fork --fork-url monad_testnet     # Circle USDC permit + transferWithAuthorization on a Monad fork
```

| Claim | Test |
|---|---|
| Pay accrues per second only while clocked in | `test_paysBySecondAndRefundsTheRest`, `test_noPayWhileClockedOut` |
| Client can pause pay at any moment | `test_clientHoldStopsTheClock` |
| Pay never exceeds the budget; topping up doesn't pay for time past it | `test_budgetCapsPayAndTopUpRestartsTheShift` |
| Only the right people can act on a tab | `test_onlyTheRightPeopleTouchTheClock` |
| Invites can't be stolen from the mempool | `test_inviteClaimCannotBeStolen` |
| Unclaimed invites refund in full | `test_unclaimedInviteRefundsInFull` |
| Many tabs settle in one transaction | `test_settleManyPaysEveryTab` |
| Gasless open with permit through the forwarder | `test_gaslessOpenWithPermitAndClockIn` |
| History is walkable block to block | `test_activityChainLinksEveryBlock` |
| Paid + refunded always equals the budget | `testFuzz_moneyIsConserved` |

The web app has an end-to-end test that drives the real UI on the deployed site: faucet, profile, open a tab to a demo freelancer, payouts while watching, pause, close and refund, then an invite joined from a second browser at phone width (`scripts/e2e.cjs`).

## Claim to code

| Claim on the site | Where |
|---|---|
| "Pay builds up every second" | `Till._earned`: `banked + (now - since) * rate / 3600`, capped at the budget |
| "Can only pay you or refund the client" | `Till._settle` pays `payee` only; `Till.close` refunds `payer` only; no owner or admin functions exist |
| "No gas, one signature" | `web/lib/relay.ts` (EIP-712 forward requests, EIP-2612 permit, EIP-3009 transfers), `web/app/api/relay/route.ts` |
| "Payouts every few seconds while you watch" | `web/app/tab/[id]/page.tsx` calls `/api/settle` every 6 s while the page is visible |
| Live numbers on the landing page | `web/app/api/live/route.ts` reads every tab's state from the contract (no indexer) |
| Pay stub from chain | `web/lib/hooks.ts` `useHistory` walks `Activity(id, prevBlock)` one exact block at a time |
