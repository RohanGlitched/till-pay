import { encodeFunctionData } from "viem";
import { tillAbi } from "@/lib/abi";
import { TILL, publicClient } from "@/lib/chain";
import { json, limited, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Pays out whatever a tab has earned. Anyone may ask (money only ever goes to the freelancer);
 * the tab page calls it every few seconds while someone is watching, so the wallet balance moves live.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!b?.id || !/^\d+$/.test(b.id)) return json({ error: "Which tab?" }, 400);
  const id = BigInt(b.id);
  if (limited(`settle:${id}`, 1, 2_500)) return json({ skipped: true, reason: "Paid out moments ago." });
  const view = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "getTab", args: [id] })) as {
    owed: bigint;
    tab: { payee: string; closed: boolean };
  };
  if (view.tab.closed || /^0x0+$/.test(view.tab.payee)) return json({ skipped: true, reason: "Nothing to pay on this tab." });
  if (view.owed < 1_000n) return json({ skipped: true, reason: "Less than a tenth of a cent is owed." });
  try {
    const data = encodeFunctionData({ abi: tillAbi, functionName: "settle", args: [id] });
    const landed = await sendAndWait(signer("keeper"), { to: TILL, data });
    return json({ ...landed, amount: view.owed });
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  }
}
