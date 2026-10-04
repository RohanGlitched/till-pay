import { FORWARDER, TILL, DOLLAR, explorerAddress } from "@/lib/chain";
import { Mark } from "./Mark";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.foot}>
      <div className={`wrap ${styles.inner}`}>
        <div className={styles.brand}>
          <Mark size={26} />
          <p>Till runs on Monad testnet with Agora&apos;s test AUSD. Nothing here is real money.</p>
        </div>
        <dl className={styles.contracts}>
          <div>
            <dt>Till contract</dt>
            <dd>
              <a href={explorerAddress(TILL)} target="_blank" rel="noreferrer" className="serial">
                {TILL}
              </a>
            </dd>
          </div>
          <div>
            <dt>Gasless forwarder</dt>
            <dd>
              <a href={explorerAddress(FORWARDER)} target="_blank" rel="noreferrer" className="serial">
                {FORWARDER}
              </a>
            </dd>
          </div>
          <div>
            <dt>AUSD (Agora, testnet)</dt>
            <dd>
              <a href={explorerAddress(DOLLAR)} target="_blank" rel="noreferrer" className="serial">
                {DOLLAR}
              </a>
            </dd>
          </div>
        </dl>
        <p className={styles.links}>
          <a href="https://github.com/RohanGlitched/till-pay" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
          <a href="https://github.com/RohanGlitched/till-pay/blob/main/VERIFY.md" target="_blank" rel="noreferrer">
            How to verify it
          </a>
        </p>
      </div>
    </footer>
  );
}
