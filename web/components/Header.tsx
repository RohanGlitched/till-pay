"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/tabs";
import { Mark } from "./Mark";
import styles from "./Header.module.css";

export function Header() {
  const wallet = useWallet();
  const path = usePathname();
  return (
    <header className={styles.bar}>
      <div className={`wrap ${styles.inner}`}>
        <Link href="/" className={styles.brand} aria-label="Till home">
          <Mark size={30} />
          <span className={styles.word}>Till</span>
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/#how" className={styles.link}>
            How it works
          </Link>
          <Link href="/app" className={styles.link} aria-current={path?.startsWith("/app") ? "page" : undefined}>
            Your tabs
          </Link>
          {wallet.address ? (
            <Link href="/app" className={styles.who} title={wallet.address}>
              <i aria-hidden className={styles.dot} />
              {wallet.kind === "email" ? wallet.label : shortAddress(wallet.address)}
            </Link>
          ) : (
            <button className="btn small primary" onClick={wallet.signIn} disabled={!wallet.ready}>
              Sign in
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
