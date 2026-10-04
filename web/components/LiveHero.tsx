"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive } from "@/lib/live";
import { currency, formatUsd, toUsd } from "@/lib/money";
import type { Profile, TabView } from "@/lib/tabs";
import { Note } from "./Note";
import { TabNote } from "./TabNote";
import styles from "./LiveHero.module.css";

type LiveData = {
  tabs: number | null;
  running?: number;
  paid?: string;
  earned?: string;
  block?: number;
  featured?: (Omit<TabView, "id" | "tab"> & { id: string; tab: Record<string, string | boolean> }) | null;
  profiles?: Record<string, Profile>;
};

/** Turns the JSON tab back into bigints. */
function revive(f: NonNullable<LiveData["featured"]>): TabView {
  const t = f.tab;
  const big = (v: unknown) => BigInt(v as string);
  return {
    id: big(f.id),
    earned: big(f.earned),
    owed: big(f.owed),
    runway: big(f.runway),
    tab: {
      payer: t.payer as `0x${string}`,
      payee: t.payee as `0x${string}`,
      invite: t.invite as `0x${string}`,
      rate: big(t.rate),
      held: t.held as boolean,
      closed: t.closed as boolean,
      since: big(t.since),
      lastBlock: big(t.lastBlock),
      budget: big(t.budget),
      banked: big(t.banked),
      paid: big(t.paid),
    },
  };
}

export function useLiveNetwork() {
  const [data, setData] = useState<LiveData | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/live")
        .then((r) => r.json())
        .then((d: LiveData) => !stop && setData(d))
        .catch(() => !stop && setData((d) => d ?? { tabs: null }));
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return data;
}

/** The hero: a real tab running on Monad right now, or a clearly marked specimen if none is. */
export function LiveHero() {
  const data = useLiveNetwork();
  const { rates } = useLive();
  const featured = data?.featured ? revive(data.featured) : null;

  return (
    <div className={styles.hero}>
      {data === null ? (
        <div className={`skeleton ${styles.placeholder}`} aria-label="Loading a live tab" />
      ) : featured ? (
        <>
          <TabNote view={featured} profiles={data.profiles ?? {}} engrave />
          <p className={styles.caption}>
            A real tab on Monad testnet, updating as blocks arrive.{" "}
            <Link href={`/tab/${featured.id}`}>Watch it pay out</Link>
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
  const data = useLiveNetwork();
  if (!data || data.tabs == null)
    return <p className={styles.strip}>{data ? "Monad's public RPC is busy; live numbers will return in a moment." : "Reading Monad…"}</p>;
  return (
    <p className={styles.strip}>
      Right now on Monad: <b>{data.running}</b> {data.running === 1 ? "tab" : "tabs"} running,{" "}
      <b>{formatUsd(toUsd(BigInt(data.earned ?? "0")))}</b> earned across <b>{data.tabs}</b> {data.tabs === 1 ? "tab" : "tabs"}, block{" "}
      <span className="serial">{data.block?.toLocaleString("en-US")}</span>.
    </p>
  );
}
