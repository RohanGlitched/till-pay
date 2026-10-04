"use client";

import { useLive, useChainNow } from "@/lib/live";
import { ago, currency, formatDuration, toUsd } from "@/lib/money";
import { STATE_WORDS, earnedAt, isZero, shortAddress, stateOf, type Profile, type TabView } from "@/lib/tabs";
import { Note } from "./Note";

export function personOf(addr: string, profiles: Record<string, Profile>, fallbackPlace = "") {
  const p = profiles[addr.toLowerCase()];
  return {
    name: p?.name || (isZero(addr) ? "The freelancer" : shortAddress(addr)),
    place: p?.place || fallbackPlace,
    currency: p?.currency || "USD",
  };
}

/** A live note for one tab: the amount ticks with chain time between reads. */
export function TabNote({
  view,
  profiles,
  lastPaidAt,
  engrave,
}: {
  view: TabView;
  profiles: Record<string, Profile>;
  lastPaidAt?: number;
  engrave?: boolean;
}) {
  const { head, rates } = useLive();
  const now = useChainNow();
  const t = view.tab;
  const earned = earnedAt(t, now);
  const state = stateOf(t, now);
  const payee = personOf(t.payee, profiles, "invited by link");
  const payer = personOf(t.payer, profiles);
  const rateUsd = toUsd(t.rate);
  const hours = rateUsd > 0 ? toUsd(earned) / rateUsd : 0;
  const status =
    state === "working" ? `On the clock for ${formatDuration(now - Number(t.since))}` : STATE_WORDS[state];
  const serialBits = [head ? `block ${head.number.toLocaleString("en-US")}` : null, lastPaidAt ? `paid ${ago(now - lastPaidAt)}` : null].filter(Boolean);

  return (
    <Note
      id={view.id}
      usd={toUsd(earned)}
      cur={currency(payee.currency)}
      rates={rates}
      payee={payee}
      payer={payer}
      rateUsd={rateUsd}
      hours={hours}
      live={state === "working"}
      status={status}
      serialLine={serialBits.join(", ") || undefined}
      engrave={engrave}
    />
  );
}
