import { encodeFunctionData, isAddress, type Address } from "viem";
import { AGORA_FAUCET, DOLLAR, dollarAbi, publicClient } from "@/lib/chain";
import { clientIp, json, limited, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";

const DRIP = 25_000_000n; // 25 test AUSD: most of an hour at a typical rate
const ENOUGH = 10_000_000n;
const REFILL_BELOW = 500_000_000n;

/**
 * One click of Agora's test AUSD on Monad, so a judge can open a tab without visiting any faucet.
 * The faucet wallet tops itself up from Agora's on-chain faucet (10,000 AUSD a call) when it runs low.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { address?: Address } | null;
  if (!b?.address || !isAddress(b.address)) return json({ error: "Sign in first so we know where to send it." }, 400);
  const who = b.address.toLowerCase();
  if (limited(`faucet:${who}`, 1, 3_600_000) || limited(`faucet-ip:${clientIp(req)}`, 6, 3_600_000) || limited("faucet:all", 120, 3_600_000))
    return json({ error: "Test AUSD was sent here in the last hour. Try again later." }, 429);
  const balance = (await publicClient.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [b.address] })) as bigint;
  if (balance >= ENOUGH) return json({ error: "You already have enough test AUSD to open a tab." }, 400);
  try {
    const faucet = signer("faucet");
    const pool = (await publicClient.readContract({
      address: DOLLAR,
      abi: dollarAbi,
      functionName: "balanceOf",
      args: [faucet.account.address],
    })) as bigint;
    if (pool < REFILL_BELOW) {
      const refill = encodeFunctionData({ abi: dollarAbi, functionName: "requestFunds", args: [faucet.account.address] });
      await sendAndWait(faucet, { to: AGORA_FAUCET, data: refill }).catch(() => null);
    }
    const data = encodeFunctionData({ abi: dollarAbi, functionName: "transfer", args: [b.address, DRIP] });
    const { logs: _logs, ...landed } = await sendAndWait(faucet, { to: DOLLAR, data });
    return json({ ...landed, amount: 25 });
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  }
}
