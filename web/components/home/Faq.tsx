import styles from "./home.module.css";

const QA = [
  {
    q: "Is this real money?",
    a: "Not yet. Till runs on Monad testnet with Agora's test AUSD, which has no value. The contract and the flows are the ones that would run on mainnet.",
  },
  {
    q: "Do I need a crypto wallet or any MON?",
    a: "No. Sign in with a passkey or your email and Till creates a wallet for you. Every action is a signature; Till's relayer submits it and pays the gas.",
  },
  {
    q: "What if the client disappears halfway through?",
    a: "You've already been paid for every second up to the last payout, which happens every few seconds while the tab is open. The rest of the budget stays in the contract and can only go to you, for time on the clock, or back to the client.",
  },
  {
    q: "What stops a freelancer clocking in and doing nothing?",
    a: "The client watches the same tab live and can pause pay at any moment; the clock stops in the same block. The most either side can lose is a few seconds.",
  },
  {
    q: "How do I get money into my local currency?",
    a: "Your pay lands as AUSD, Agora's dollar stablecoin, which you can send to any exchange or wallet with one signature. Local cash-out partners are next on the roadmap; the note already shows your pay in your currency at today's rate.",
  },
  {
    q: "Who can move the money in a tab?",
    a: "Only the contract's rules: earned pay can only go to the freelancer and unspent budget only back to the client. There is no admin key and no upgrade path. The source is verified on Monad's explorer.",
  },
];

export function Faq() {
  return (
    <div className={styles.faq}>
      {QA.map((x) => (
        <details key={x.q} className={styles.qa}>
          <summary>{x.q}</summary>
          <p>{x.a}</p>
        </details>
      ))}
    </div>
  );
}
