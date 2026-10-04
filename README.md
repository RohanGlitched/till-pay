# Till

**Get paid every second you work.** A client abroad opens a tab in AUSD, Agora's digital dollar, with an hourly rate and a budget. While the freelancer is clocked in, pay builds up every second on Monad and lands in their wallet as they work. Either side can stop the clock at any moment; closing the tab sends the unspent budget straight back.

Live app: **https://till-pay.vercel.app** on Monad testnet, paid in Agora's AUSD

| | |
|---|---|
| Till contract | [`0xeb6c2c519c9bcc4495364c34ac116c20098113d1`](https://testnet.monadvision.com/address/0xeb6c2c519c9bcc4495364c34ac116c20098113d1) |
| Gasless forwarder (OpenZeppelin ERC2771Forwarder) | [`0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1`](https://testnet.monadvision.com/address/0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1) |
| AUSD (Agora, Monad testnet) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadvision.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |

## The problem

Freelancers outside the US and Europe wait for their money and pay to receive it. Sending money across borders costs 6.49% on average ([World Bank, Q1 2025](https://remittanceprices.worldbank.org/)). Hourly work on a marketplace reaches the freelancer about ten days after the week ends ([Upwork](https://www.upwork.com/resources/understanding-freelancer-payment-protection)). And if a client disappears, the freelancer chases an invoice for work already done.

## What Till does

1. **The client opens a tab.** They set a rate and a budget in AUSD and send an invite link. The budget sits in the Till contract, which can only pay the freelancer or refund the client.
2. **The freelancer clocks in.** Pay accrues every second on the clock. Either side can stop it; the client can pause pay or close the tab.
3. **Pay lands as they work.** Earnings settle to the freelancer's wallet every few seconds while the tab is open on screen, and they can cash out at any moment. Nobody is ever owed more than the seconds since the last payout.

Every tab is drawn as a **banknote that prints itself**: a guilloche rosette in the ink of the freelancer's currency, with a new band engraved as the hours add up, the live amount rolling in their own currency, and the tab number and Monad block as its serial.

## Money: Agora's AUSD

Tabs are funded and paid in [AUSD](https://www.agora.finance), Agora's dollar stablecoin, on Monad. AUSD supports EIP-2612 permits and EIP-3009 transfer authorisations, so opening a tab, topping up and sending AUSD to anyone are all one signature with no gas. The app's faucet hands judges 25 test AUSD and refills itself from Agora's testnet faucet.

## Why Monad

- **Pay you can watch arrive.** Blocks every ~0.4 s with fast finality: a payout lands while the freelancer is still looking at the screen. The tab page settles every few seconds while it is open and shows how long each payout took.
- **Built for parallel execution.** Pay accrues from timestamps and each tab keeps its own state. Clocking and settling never write shared storage, so thousands of tabs settle side by side; `settleMany` pays many tabs in one transaction.
- **No gas for anyone.** Every action is an EIP-712 signature submitted by a relayer through an ERC-2771 forwarder; deposits use an AUSD permit (EIP-2612) and sends an AUSD transfer authorisation (EIP-3009). Neither side ever holds MON.
- **Monad-aware engineering.** Monad charges the gas limit rather than gas used, so every transaction is sent with the chain's own estimate plus a margin. Public RPCs cap log queries at 100 blocks, so each tab links its changes block to block (`Activity(id, prevBlock)`) and the app reads a tab's full pay stub with one exact-block query per step, no indexer needed.

## Try it

1. Open https://till-pay.vercel.app and choose **Open a tab**. Create an account with a passkey (or use your email, or a practice wallet).
2. Click **Get 25 test AUSD**, pick a demo freelancer (they clock in by themselves a few seconds later) and open a tab with a couple of dollars.
3. Watch the note print and the payouts land. Pause pay, top up, close the tab and see the refund in the pay stub.
4. To be the freelancer, choose **Someone I'll invite by link** and open the link in another browser.

Seeded studios in Berlin, Austin and Singapore pay freelancers in Manila, Lagos, Pune, São Paulo and Nairobi around their local working hours, so there is always a live tab to look at.

## Architecture

```
contracts/   Till.sol (Solidity 0.8.28, OpenZeppelin 5.4), Foundry tests, deploy script
web/         Next.js 15 app: landing, your tabs, open, tab, join; API routes for the
             relayer (/api/relay), cash-outs (/api/send), payouts (/api/settle),
             test AUSD (/api/faucet, topped up from Agora's faucet), network stats (/api/live) and exchange rates (/api/fx)
bots/        The seeded studios and freelancers, plus the keeper that settles running tabs
scripts/     ABI export, screenshots, end-to-end UI test
```

## Run it

```bash
# contracts
cd contracts && forge test                                   # 12 tests incl. 1,000-run fuzz
forge test --match-contract Fork --fork-url monad_testnet    # rehearsal with Agora's real AUSD

# web
cd web && npm install && npm run dev
```

Environment for the web app: `NEXT_PUBLIC_TILL_ADDRESS`, `NEXT_PUBLIC_FORWARDER_ADDRESS`, `NEXT_PUBLIC_PRIVY_APP_ID` (optional; without it the app offers practice wallets), and server-only `KEEPER_KEY` and `FAUCET_KEY`.

## Proof

See [VERIFY.md](VERIFY.md) for deployed addresses, transactions for every action and how to reproduce them, and [SECURITY.md](SECURITY.md) for who can move money and how each attack is stopped.

## Built during Monad Metropolis

All code in this repository was written during the hackathon (from October 2026); no earlier project code is reused.

## Licence

MIT
