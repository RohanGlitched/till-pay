import "server-only";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  decodeErrorResult,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tillAbi } from "./abi";
import { RPC_URL, TILL, monadTestnet, publicClient } from "./chain";

/** The relayer pays gas for every signed request; the faucet hands out test USDC. Keys live only in env vars. */
export function signer(kind: "keeper" | "faucet") {
  const key = (kind === "keeper" ? process.env.KEEPER_KEY : process.env.FAUCET_KEY) as Hex | undefined;
  if (!key) throw new Error(`${kind === "keeper" ? "Relayer" : "Faucet"} is not configured on this deployment.`);
  const account = privateKeyToAccount(key);
  return createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) });
}

type Client = ReturnType<typeof signer>;

/**
 * Sends a transaction and waits for its receipt. Monad charges for the gas limit, not gas used, and
 * prices storage differently from Ethereum, so the limit is the chain's own estimate plus 15%.
 * A nonce race between two serverless instances is retried once with a fresh nonce.
 */
export async function sendAndWait(client: Client, tx: { to: Address; data: Hex; minGas?: bigint }) {
  for (let attempt = 0; ; attempt++) {
    try {
      const est = await publicClient.estimateGas({ account: client.account.address, to: tx.to, data: tx.data });
      const gas = (est * 115n) / 100n > (tx.minGas ?? 0n) ? (est * 115n) / 100n : tx.minGas!;
      const nonce = await publicClient.getTransactionCount({ address: client.account.address, blockTag: "pending" });
      const hash = await client.sendTransaction({ to: tx.to, data: tx.data, gas, nonce, account: client.account, chain: monadTestnet });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 150, timeout: 30_000 });
      if (receipt.status !== "success") throw new Error("Monad rejected the transaction.");
      return { hash, block: Number(receipt.blockNumber) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 0 && /nonce|replacement|already known/i.test(msg)) continue;
      throw e;
    }
  }
}

/** Pulls Till's custom error name out of a failed simulation so the app can explain it. */
export function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) return revert.data.errorName;
    const raw = e.walk((err) => typeof (err as { data?: unknown }).data === "string") as { data?: Hex } | null;
    if (raw?.data) {
      try {
        return decodeErrorResult({ abi: tillAbi, data: raw.data }).errorName;
      } catch {}
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Very small in-memory limiter per serverless instance; enough to stop a runaway loop on testnet. */
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  return false;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export { TILL };
