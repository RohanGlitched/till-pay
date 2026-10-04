"use client";

import { useCallback, useState, type ReactNode } from "react";
import { explorerTx } from "@/lib/chain";
import { plainError, type Landed } from "@/lib/relay";
import { useWallet } from "@/lib/wallet";
import styles from "./ui.module.css";

export type Phase = "idle" | "signing" | "sending" | "done" | "error";

/**
 * Runs one action at a time with honest phases: waiting for the signature, then waiting for
 * Monad. The button that started it stays locked until it finishes (no double submits).
 */
export function useAction() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [landed, setLanded] = useState<(Landed & { what: string }) | null>(null);
  const [which, setWhich] = useState<string | null>(null);

  const run = useCallback(async (what: string, fn: (sent: () => void) => Promise<Landed | void>) => {
    setWhich(what);
    setError(null);
    setPhase("signing");
    try {
      const res = await fn(() => setPhase("sending"));
      if (res) setLanded({ ...res, what });
      setPhase("done");
      return res;
    } catch (e) {
      setError(plainError(e));
      setPhase("error");
      return undefined;
    }
  }, []);

  const busy = phase === "signing" || phase === "sending";
  return { phase, error, landed, run, busy, which, clearError: () => setError(null) };
}

export function busyLabel(phase: Phase, idle: string) {
  if (phase === "signing") return "Waiting for your signature…";
  if (phase === "sending") return "Sending to Monad…";
  return idle;
}

/** "Clocked in. Landed in 0.71 s, block 68,081,233." with the transaction one click away. */
export function LandedLine({ landed }: { landed: (Landed & { what: string }) | null }) {
  if (!landed) return null;
  return (
    <p className={styles.landed} role="status">
      {landed.what}. Landed in {(landed.ms / 1000).toFixed(2)} s,{" "}
      <a className="serial" href={explorerTx(landed.hash)} target="_blank" rel="noreferrer">
        block {landed.block.toLocaleString("en-US")}
      </a>
      .
    </p>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="notice error" role="alert">
      {error}
    </p>
  );
}

/** Shown wherever an action needs a wallet: email through Privy, or a practice wallet at once. */
export function SignInPanel({ title, children }: { title: string; children?: ReactNode }) {
  const wallet = useWallet();
  return (
    <div className={styles.signin}>
      <h2>{title}</h2>
      {children}
      <div className={styles.signinActions}>
        {wallet.privyEnabled && (
          <button className="btn primary" onClick={wallet.signIn} disabled={!wallet.ready}>
            Continue with email
          </button>
        )}
        <button className={`btn ${wallet.privyEnabled ? "" : "primary"}`} onClick={wallet.usePractice} disabled={!wallet.ready}>
          {wallet.privyEnabled ? "Use a practice wallet instead" : "Start with a practice wallet"}
        </button>
      </div>
      <p className={styles.fine}>
        {wallet.privyEnabled
          ? "Email sign-in creates a wallet for you. A practice wallet lives only in this browser."
          : "A practice wallet is created in this browser at once. It holds test USDC only."}{" "}
        You never need MON or gas.
      </p>
    </div>
  );
}
