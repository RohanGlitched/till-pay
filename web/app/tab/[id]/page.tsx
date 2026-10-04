"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { InviteBox } from "@/components/InviteBox";
import { TabNote, personOf } from "@/components/TabNote";
import { TimeCard } from "@/components/TimeCard";
import { ErrorLine, LandedLine, busyLabel, useAction } from "@/components/ui";
import { explorerTx } from "@/lib/chain";
import { useHistory, useTabs, useUsdcBalance, type StubLine } from "@/lib/hooks";
import { inviteLink, loadInvite } from "@/lib/invite";
import { useChainNow, useLive } from "@/lib/live";
import { ago, currency, formatDuration, formatMoney, formatUsd, toUnits, toUsd } from "@/lib/money";
import { relay, settleNow, signPermit, type Landed } from "@/lib/relay";
import { earnedAt, isZero, stateOf } from "@/lib/tabs";
import { useWallet } from "@/lib/wallet";
import styles from "./tab.module.css";

const AUTO_PAY_MS = 6000;

export default function TabPage() {
  const params = useParams<{ id: string }>();
  const id = useMemo(() => (/^\d+$/.test(params.id) ? BigInt(params.id) : null), [params.id]);
  const ids = useMemo(() => (id ? [id] : null), [id]);
  const { views, profiles, refresh, error } = useTabs(ids, 2000);
  const view = views?.[0];
  const wallet = useWallet();
  const me = wallet.address?.toLowerCase();
  const now = useChainNow();
  const { rates } = useLive();
  const act = useAction();
  const { lines, more } = useHistory(id, view?.tab.lastBlock, 30);
  const [copied, setCopied] = useState(false);
  const [payouts, setPayouts] = useState<(Landed & { amount: number })[]>([]);
  const [topUp, setTopUp] = useState("");
  const [showTopUp, setShowTopUp] = useState(false);
  const { balance } = useUsdcBalance(wallet.address);
  const [invite, setInvite] = useState<string | null>(null);

  const t = view?.tab;
  const state = t ? stateOf(t, now) : null;
  const exists = t && !isZero(t.payer);

  useEffect(() => {
    if (!id) return;
    const k = loadInvite(id);
    setInvite(k ? inviteLink(id, k) : null);
  }, [id]);

  // While someone watches a running tab, pay out every few seconds so the wallet balance moves live.
  const watching = useRef(true);
  useEffect(() => {
    const onVis = () => (watching.current = document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    if (!id || state !== "working") return;
    const tick = async () => {
      if (!watching.current) return;
      try {
        const r = await settleNow(id);
        setPayouts((p) => [{ ...r, amount: toUsd(r.amount) }, ...p].slice(0, 4));
        refresh();
      } catch {}
    };
    const first = setTimeout(tick, 1500);
    const timer = setInterval(tick, AUTO_PAY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [id, state, refresh]);

  if (!id) return <Missing text="That isn't a tab number." />;
  if (error && !view) return <Missing text={error} />;
  if (!views) return <Loading />;
  if (!exists || !t) return <Missing text={`There's no tab № ${id.toString().padStart(4, "0")} yet.`} />;

  const payee = personOf(t.payee, profiles, "invited by link");
  const payer = personOf(t.payer, profiles);
  const cur = currency(payee.currency);
  const iAmPayee = me === t.payee.toLowerCase();
  const iAmPayer = me === t.payer.toLowerCase();
  const earned = earnedAt(t, now);
  const owed = earned - t.paid;
  const remaining = t.budget - earned;
  const runway = t.rate > 0n ? (Number(remaining) * 3600) / Number(t.rate) : 0;
  const money = (usd: number) => (rates && cur.code !== "USD" ? `${formatMoney(usd, cur, rates)} (${formatUsd(usd, 2)})` : formatUsd(usd, 2));
  const lastPaid = lines?.find((l) => l.kind === "paid");

  const go = (what: string, fn: string, args: readonly unknown[]) =>
    act.run(what, async (sent) => {
      const p = relay(wallet, fn, args);
      sent();
      const r = await p;
      refresh();
      return r;
    });

  const topUpUnits = Number(topUp) > 0 ? toUnits(Number(topUp)) : 0n;
  const topUpProblem = !(Number(topUp) > 0) ? "Enter an amount." : balance != null && topUpUnits > balance ? "That's more than your wallet holds." : null;

  return (
    <main className={`wrap ${styles.page}`}>
      <div className={styles.noteWrap}>
        <TabNote view={view!} profiles={profiles} lastPaidAt={lastPaid?.time} engrave />
        <div className={styles.noteBar}>
          <span className="soft">
            Tab <span className="serial">№ {view!.id.toString().padStart(4, "0")}</span>
            {lines?.find((l) => l.kind === "opened")?.time ? `, opened ${new Date(lines.find((l) => l.kind === "opened")!.time * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </span>
          <button
            className={styles.copy}
            onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })}
          >
            {copied ? "Link copied" : "Copy link to this tab"}
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        <section className={styles.controls} aria-label="Actions">
          {iAmPayee && (
            <>
              <h2>{state === "working" ? "You're on the clock" : "You're the freelancer on this tab"}</h2>
              <div className={styles.buttons}>
                {state === "idle" && (
                  <button className="btn live" disabled={act.busy} onClick={() => go("Clocked in", "clockIn", [view!.id])}>
                    {busyLabel(act.phase, "Clock in")}
                  </button>
                )}
                {state === "working" && (
                  <button className="btn primary" disabled={act.busy} onClick={() => go("Clocked out", "clockOut", [view!.id])}>
                    {busyLabel(act.phase, "Clock out")}
                  </button>
                )}
                {owed > 1000n && (
                  <button
                    className="btn"
                    disabled={act.busy}
                    onClick={() =>
                      act.run(`Cashed out ${formatUsd(toUsd(owed), 4)}`, async (sent) => {
                        sent();
                        const r = await settleNow(view!.id);
                        refresh();
                        return r;
                      })
                    }
                  >
                    Cash out {formatUsd(toUsd(owed), 2)} now
                  </button>
                )}
                {state !== "closed" && (
                  <button className="btn quiet" disabled={act.busy} onClick={() => go("Tab closed", "close", [view!.id])}>
                    Close tab
                  </button>
                )}
              </div>
              {state === "paused" && <p className="notice">{payer.name} has paused pay. You can clock in again when they resume it.</p>}
              {state === "spent" && <p className="notice">The budget is used up. {payer.name} can top it up to keep the clock running.</p>}
            </>
          )}

          {iAmPayer && (
            <>
              <h2>You&apos;re paying {payee.name}</h2>
              {state === "invited" && (invite ? <InviteBox link={invite} /> : <p className="notice">The invite link was made in another browser. Open it there, or close this tab to get the budget back.</p>)}
              <div className={styles.buttons}>
                {(state === "working" || state === "idle") && (
                  <button className="btn" disabled={act.busy} onClick={() => go("Pay paused", "hold", [view!.id, true])}>
                    Pause pay
                  </button>
                )}
                {state === "paused" && (
                  <button className="btn primary" disabled={act.busy} onClick={() => go("Pay resumed", "hold", [view!.id, false])}>
                    Resume pay
                  </button>
                )}
                {state !== "closed" && (
                  <button className="btn" disabled={act.busy} onClick={() => setShowTopUp((s) => !s)} aria-expanded={showTopUp}>
                    Top up
                  </button>
                )}
                {state !== "closed" && (
                  <button className="btn quiet" disabled={act.busy} onClick={() => go("Tab closed", "close", [view!.id])}>
                    Close and get {formatUsd(toUsd(remaining > 0n ? remaining : 0n))} back
                  </button>
                )}
              </div>
              {showTopUp && (
                <form
                  className={styles.topup}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (topUpProblem) return;
                    act.run(`Topped up ${formatUsd(Number(topUp))}`, async (sent) => {
                      const permit = await signPermit(wallet, topUpUnits);
                      const p = relay(wallet, "topUpWithPermit", [view!.id, topUpUnits, permit.deadline, permit.v, permit.r, permit.s]);
                      sent();
                      const r = await p;
                      setShowTopUp(false);
                      setTopUp("");
                      refresh();
                      return r;
                    });
                  }}
                >
                  <div className="field">
                    <label htmlFor="topup">Add to the budget (USDC)</label>
                    <input id="topup" className="input" inputMode="decimal" value={topUp} onChange={(e) => setTopUp(e.target.value)} placeholder="5.00" />
                    <span className="hint">Wallet: {balance == null ? "…" : formatUsd(toUsd(balance))}</span>
                  </div>
                  <button className="btn primary" disabled={!!topUpProblem || act.busy}>
                    {busyLabel(act.phase, "Add to budget")}
                  </button>
                </form>
              )}
            </>
          )}

          {!iAmPayee && !iAmPayer && (
            <>
              <h2>Watching this tab</h2>
              <p className="soft">
                Anyone can watch a tab. Only {payer.name} and {payee.name} can change it.{" "}
                {!wallet.address && "Sign in to open a tab of your own."}
              </p>
              <div className={styles.buttons}>
                <Link href="/open" className="btn primary">
                  Open a tab of your own
                </Link>
              </div>
            </>
          )}

          <ErrorLine error={act.error} />
          <LandedLine landed={act.landed} />

          {state === "working" && (
            <div className={styles.payouts} aria-live="polite">
              <p className={styles.payoutsHead}>Paying out every few seconds while this page is open.</p>
              {payouts.length === 0 ? (
                <p className="soft">First payout in a moment…</p>
              ) : (
                <ul>
                  {payouts.map((p) => (
                    <li key={p.hash}>
                      <span>{money(p.amount)}</span> landed in {(p.ms / 1000).toFixed(2)} s,{" "}
                      <a className="serial" href={explorerTx(p.hash)} target="_blank" rel="noreferrer">
                        block {p.block.toLocaleString("en-US")}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className={styles.facts} aria-label="Tab details">
          <dl>
            <div>
              <dt>Rate</dt>
              <dd>{formatUsd(toUsd(t.rate))} an hour</dd>
            </div>
            <div>
              <dt>Earned</dt>
              <dd>{money(toUsd(earned))}</dd>
            </div>
            <div>
              <dt>Paid out</dt>
              <dd>{money(toUsd(t.paid))}</dd>
            </div>
            <div>
              <dt>Budget left</dt>
              <dd>
                {formatUsd(toUsd(remaining > 0n ? remaining : 0n))}
                {state !== "closed" && runway > 0 && <span className="soft"> covers {formatDuration(runway)}</span>}
              </dd>
            </div>
            <div>
              <dt>Between</dt>
              <dd>
                {payer.name}
                {payer.place ? `, ${payer.place}` : ""} and {payee.name}
                {payee.place && !isZero(t.payee) ? `, ${payee.place}` : ""}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {lines && lines.length > 1 && (
        <section className={styles.stub}>
          <h2>Time card</h2>
          <p className="soft">
            {more ? "The most recent stretch of this tab. " : ""}Red is time on the clock, hatched is pay paused, and the line is money that has
            reached the freelancer.
          </p>
          <TimeCard lines={lines} now={now} earnedUsd={toUsd(earned)} running={state === "working"} />
        </section>
      )}

      <section className={styles.stub}>
        <h2>Pay stub</h2>
        <p className="soft">Every change to this tab, straight from Monad. Each line links to its transaction.</p>
        {lines == null ? (
          <div className={`skeleton ${styles.stubSkel}`} />
        ) : lines.length === 0 ? (
          <p className="soft">Nothing yet.</p>
        ) : (
          <ol className={styles.lines}>
            {lines.map((l, i) => (
              <li key={`${l.hash}-${l.kind}-${i}`}>
                <span className={styles.when}>{ago(now - l.time)}</span>
                <span className={styles.what}>{describe(l, payer.name, payee.name, money)}</span>
                <a className="serial" href={explorerTx(l.hash)} target="_blank" rel="noreferrer">
                  block {l.block.toLocaleString("en-US")}
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function describe(l: StubLine, payer: string, payee: string, money: (usd: number) => string): string {
  const amt = l.amount != null ? toUsd(l.amount) : 0;
  switch (l.kind) {
    case "opened":
      return `${payer} opened the tab with ${formatUsd(amt)}`;
    case "claimed":
      return `${payee} joined from the invite`;
    case "in":
      return `${payee} clocked in`;
    case "out":
      return `Clock stopped`;
    case "held":
      return `${payer} paused pay`;
    case "resumed":
      return `${payer} resumed pay`;
    case "rate":
      return `Rate changed to ${formatUsd(amt)} an hour`;
    case "topup":
      return `${payer} added ${formatUsd(amt)}`;
    case "paid":
      return `Paid ${money(amt)} to ${payee}`;
    case "closed":
      return `Tab closed, ${formatUsd(amt)} back to ${payer}`;
  }
}

function Loading() {
  return (
    <main className={`wrap ${styles.page}`} aria-busy="true">
      <div className={`skeleton ${styles.noteSkel}`} />
    </main>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <main className={`wrap ${styles.page}`}>
      <h1 className={styles.missing}>{text}</h1>
      <p>
        <Link href="/app">See your tabs</Link> or <Link href="/open">open a new one</Link>.
      </p>
    </main>
  );
}
