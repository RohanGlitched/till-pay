import { encodeFunctionData, hexToSignature, isAddress, type Address, type Hex } from "viem";
import { DOLLAR, publicClient, dollarAbi } from "@/lib/chain";
import { clientIp, json, limited, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";

/** The smallest transfer the relayer pays gas for: one cent. */
const MIN_SEND = 10_000n;

/** Relays an AUSD transferWithAuthorization (EIP-3009) so people can move their pay without gas. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as
    | { from: Address; to: Address; value: string; validBefore: string; nonce: Hex; signature: Hex }
    | null;
  if (!b || !isAddress(b.from) || !isAddress(b.to)) return json({ error: "Enter a valid wallet address." }, 400);
  if (b.from.toLowerCase() === b.to.toLowerCase()) return json({ error: "That's your own wallet." }, 400);
  let data: Hex;
  try {
    const value = BigInt(b.value);
    if (value < MIN_SEND) return json({ error: "The smallest amount the relayer sends is $0.01." }, 400);
    const { r, s, v } = hexToSignature(b.signature);
    const args = [b.from, b.to, value, 0n, BigInt(b.validBefore), b.nonce, Number(v ?? 27n), r, s] as const;
    data = encodeFunctionData({ abi: dollarAbi, functionName: "transferWithAuthorization", args });
  } catch {
    return json({ error: "That transfer isn't signed properly. Reload the page and try again." }, 400);
  }
  if (limited(`send:${b.from.toLowerCase()}`, 10, 60_000) || limited(`send-ip:${clientIp(req)}`, 20, 60_000) || limited("send:all", 120, 60_000))
    return json({ error: "Too many transfers in a minute." }, 429);
  try {
    await publicClient.call({ to: DOLLAR, data });
  } catch (e) {
    const why = revertReason(e);
    return json({ error: /balance/i.test(why) ? "Not enough AUSD in your wallet." : why }, 400);
  }
  try {
    const { logs: _logs, ...landed } = await sendAndWait(signer("keeper"), { to: DOLLAR, data });
    return json(landed);
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  }
}
