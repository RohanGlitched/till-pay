import Link from "next/link";
import { LiveHero, LiveStrip } from "@/components/LiveHero";
import { Footer } from "@/components/Footer";
import styles from "./page.module.css";

const STEPS = [
  {
    title: "The client opens a tab",
    body: "They set an hourly rate and a budget in USDC and send you an invite link. The budget waits in the Till contract on Monad, where it can only go to you or back to them.",
  },
  {
    title: "You clock in",
    body: "Pay builds up every second you're on the clock. Either of you can stop the clock at any moment, and the client can pause pay or close the tab.",
  },
  {
    title: "You're paid as you go",
    body: "Earnings move to your wallet while you work, and you can cash out at any second. When the tab closes, the unspent budget goes straight back to the client.",
  },
];

const COMPARE = [
  {
    what: "When the money arrives",
    wire: "Days after the invoice is finally paid",
    market: "About 10 days after the work week (Upwork hourly)",
    till: "Every second, while you work",
  },
  {
    what: "What it costs to receive",
    wire: "6.49% on average to send money across borders (World Bank, Q1 2025)",
    market: "A platform fee on every payment, then a withdrawal fee",
    till: "No Till fee in the beta. Gas is paid for you.",
  },
  {
    what: "Who holds the money meanwhile",
    wire: "The banks in between",
    market: "The platform, through its security period",
    till: "A public contract that can only pay you or refund the client",
  },
  {
    what: "If the client disappears",
    wire: "You chase an unpaid invoice",
    market: "You open a dispute",
    till: "You were already paid for every second you worked",
  },
];

export default function Home() {
  return (
    <>
      <main>
        <section className={`wrap ${styles.top}`}>
          <h1 className={styles.h1}>Get paid every second you work.</h1>
          <div className={styles.live}>
            <LiveHero />
          </div>
          <div className={styles.pitch}>
            <p className={styles.lede}>
              Your client abroad funds a tab in USDC. While you&apos;re clocked in, your pay builds up every second on Monad and you can cash out
              whenever you like. No invoices, no ten-day wait, no wire fees.
            </p>
            <div className={styles.ctas}>
              <Link href="/open" className="btn primary">
                Open a tab
              </Link>
              <Link href="/app" className="btn">
                See your tabs
              </Link>
            </div>
            <p className={styles.note}>Sign in with your email. No wallet app, no seed phrase, no gas. Test USDC is one click away.</p>
          </div>
        </section>

        <section className={`wrap ${styles.stripRow}`} aria-label="Live network">
          <LiveStrip />
        </section>

        <section id="how" className={`wrap ${styles.section}`}>
          <h2 className={styles.h2}>How a tab works</h2>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className={`denom ${styles.stepNo}`} aria-hidden>
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={`wrap ${styles.section}`}>
          <h2 className={styles.h2}>What it replaces</h2>
          <p className={styles.sub}>Most freelancers abroad are paid by wire or through a marketplace. Here is the same week of work three ways.</p>
          <div className={styles.table} role="table" aria-label="Bank wire, marketplace and Till compared">
            <div className={`${styles.row} ${styles.head}`} role="row">
              <span role="columnheader" />
              <span role="columnheader">Bank wire</span>
              <span role="columnheader">Freelance marketplace</span>
              <span role="columnheader" className={styles.tillCol}>
                Till
              </span>
            </div>
            {COMPARE.map((c) => (
              <div className={styles.row} role="row" key={c.what}>
                <span role="rowheader" className={styles.what}>
                  {c.what}
                </span>
                <span role="cell" data-label="Bank wire">
                  {c.wire}
                </span>
                <span role="cell" data-label="Marketplace">
                  {c.market}
                </span>
                <span role="cell" data-label="Till" className={styles.tillCol}>
                  {c.till}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.sources}>
            Sources:{" "}
            <a href="https://remittanceprices.worldbank.org/" target="_blank" rel="noreferrer">
              World Bank Remittance Prices Worldwide
            </a>
            ,{" "}
            <a href="https://www.upwork.com/resources/understanding-freelancer-payment-protection" target="_blank" rel="noreferrer">
              Upwork payment protection
            </a>
            .
          </p>
        </section>

        <section className={`wrap ${styles.section} ${styles.monad}`}>
          <h2 className={styles.h2}>Why this needs Monad</h2>
          <div className={styles.points}>
            <div>
              <h3>Pay you can watch arrive</h3>
              <p>
                Monad makes a block about every 0.4 seconds and finalises it moments later, so a payout lands while you&apos;re still looking at
                the screen. On a tab page Till pays out every few seconds as you watch.
              </p>
            </div>
            <div>
              <h3>Tabs that never queue behind each other</h3>
              <p>
                Each tab keeps its own state and nothing shared is written when pay builds up or settles, so Monad&apos;s parallel execution can
                settle thousands of tabs side by side.
              </p>
            </div>
            <div>
              <h3>One signature, no gas</h3>
              <p>
                You sign; Till&apos;s relayer submits. Deposits use a USDC permit and cash-outs a USDC transfer authorisation, so neither side
                ever holds MON.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
