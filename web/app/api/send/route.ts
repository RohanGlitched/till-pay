import { encodeFunctionData, hexToSignature, isAddress, type Address, type Hex } from "viem";
import { USDC, publicClient, usdcAbi } from "@/lib/chain";
import { json, limited, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";

/** Relays a USDC transferWithAuthorization (EIP-3009) so people can move their pay without gas. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as
    | { from: Address; to: Address; value: string; validBefore: string; nonce: Hex; signature: Hex }
    | null;
  if (!b || !isAddress(b.from) || !isAddress(b.to)) return json({ error: "Enter a valid wallet address." }, 400);
  if (limited(`send:${b.from.toLowerCase()}`, 10, 60_000)) return json({ error: "Too many transfers in a minute." }, 429);
  const { r, s, v } = hexToSignature(b.signature);
  const args = [b.from, b.to, BigInt(b.value), 0n, BigInt(b.validBefore), b.nonce, Number(v ?? 27n), r, s] as const;
  const data = encodeFunctionData({ abi: usdcAbi, functionName: "transferWithAuthorization", args });
  try {
    await publicClient.call({ to: USDC, data });
  } catch (e) {
    const why = revertReason(e);
    return json({ error: /balance/i.test(why) ? "Not enough USDC in your wallet." : why }, 400);
  }
  try {
    return json(await sendAndWait(signer("keeper"), { to: USDC, data }));
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  }
}
