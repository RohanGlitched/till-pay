import { concat, decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";
import { forwarderAbi, tillAbi } from "@/lib/abi";
import { FORWARDER, TILL, publicClient } from "@/lib/chain";
import { json, limited, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";

/** Till calls the relayer will pay for. Views and anything else are refused. */
const ALLOWED = new Set([
  "open",
  "openWithPermit",
  "claim",
  "clockIn",
  "clockOut",
  "hold",
  "setRate",
  "topUp",
  "topUpWithPermit",
  "settle",
  "close",
  "setProfile",
]);
const MAX_CALL_GAS = 900_000n;
/** Forwarder overhead: signature check, nonce, and the 1/64 gas reserve it keeps for itself. */
const OVERHEAD = 70_000n;

type Req = { from: Address; to: Address; value: string; gas: string; nonce: string; deadline: number; data: Hex; signature: Hex };

export async function POST(req: Request) {
  let body: { request?: Req };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a signed request." }, 400);
  }
  const r = body.request;
  if (!r || typeof r.data !== "string" || typeof r.signature !== "string") return json({ error: "Send a signed request." }, 400);
  if (r.to?.toLowerCase() !== TILL.toLowerCase() || BigInt(r.value) !== 0n) return json({ error: "The relayer only pays for Till actions." }, 400);
  const gas = BigInt(r.gas);
  if (gas > MAX_CALL_GAS) return json({ error: "That request asks for too much gas." }, 400);

  let fn: string;
  try {
    fn = decodeFunctionData({ abi: tillAbi, data: r.data }).functionName;
  } catch {
    return json({ error: "The relayer only pays for Till actions." }, 400);
  }
  if (!ALLOWED.has(fn)) return json({ error: "The relayer only pays for Till actions." }, 400);
  if (limited(`relay:${r.from.toLowerCase()}`, 40, 60_000)) return json({ error: "Too many actions in a minute. Wait a moment and try again." }, 429);

  const request = { from: r.from, to: r.to, value: 0n, gas, deadline: Number(r.deadline), data: r.data, signature: r.signature };
  const valid = await publicClient
    .readContract({ address: FORWARDER, abi: forwarderAbi, functionName: "verify", args: [request] })
    .catch(() => false);
  if (!valid) return json({ error: "The signature doesn't match this request. Reload the page and try again." }, 400);

  // Simulate the inner call exactly as the forwarder will make it, so a revert comes back with its reason.
  try {
    await publicClient.call({ account: FORWARDER, to: TILL, data: concat([r.data, r.from]), gas });
  } catch (e) {
    return json({ error: revertReason(e) }, 400);
  }

  try {
    const keeper = signer("keeper");
    const data = encodeFunctionData({ abi: forwarderAbi, functionName: "execute", args: [request] });
    const landed = await sendAndWait(keeper, { to: FORWARDER, data, minGas: gas + OVERHEAD });
    return json({ ...landed, fn });
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  }
}
