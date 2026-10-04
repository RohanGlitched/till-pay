"use client";

import Link from "next/link";
import { useLive } from "@/lib/live";
import { currency, formatUsd, toUsd } from "@/lib/money";
import { useNetwork } from "@/lib/network";
import { Note } from "./Note";
import { TabNote } from "./TabNote";
import styles from "./LiveHero.module.css";

/** The hero: a real tab running on Monad right now, or a clearly marked specimen if none is. */
export function LiveHero() {
  const net = useNetwork();
  const { rates } = useLive();
  const featured = net?.featured ?? null;

  return (
    <div className={styles.hero}>
      {net === undefined ? (
        <div className={`skeleton ${styles.placeholder}`} aria-label="Loading a live tab" />
      ) : featured ? (
        <>
          <TabNote view={featured} profiles={net?.profiles ?? {}} engrave />
          <p className={styles.caption}>
            A real tab on Monad testnet, updating as blocks arrive. <Link href={`/tab/${featured.id}`}>Watch it pay out</Link>
          </p>
        </>
      ) : (
        <>
          <div className={styles.specimen}>
            <Note
              id={0}
              usd={20.51}
              cur={currency("PHP")}
              rates={rates}
              payee={{ name: "Ana Reyes", place: "Manila" }}
              payer={{ name: "Northwind Studio", place: "Berlin" }}
              rateUsd={30}
              hours={0.68}
              live={false}
              status="Specimen"
              engrave
            />
            <span className={styles.stamp} aria-hidden>
              Specimen
            </span>
          </div>
          <p className={styles.caption}>No tab is running this minute. Open one and it appears here.</p>
        </>
      )}
    </div>
  );
}

export function LiveStrip() {
  const net = useNetwork();
  if (!net) return <p className={styles.strip}>{net === null ? "Monad's public RPC is busy; live numbers will return in a moment." : "Reading Monad…"}</p>;
  return (
    <p className={styles.strip}>
      Right now on Monad: <b>{net.running}</b> {net.running === 1 ? "tab" : "tabs"} running, <b>{formatUsd(toUsd(net.earned))}</b> earned across{" "}
      <b>{net.tabs}</b> {net.tabs === 1 ? "tab" : "tabs"}, block <span className="serial">{net.block.toLocaleString("en-US")}</span>.
    </p>
  );
}
