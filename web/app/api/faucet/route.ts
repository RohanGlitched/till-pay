import { encodeFunctionData, isAddress, type Address } from "viem";
import { USDC, publicClient, usdcAbi } from "@/lib/chain";
import { json, limited, revertReason, sendAndWait, signer } from "@/lib/server";

export const runtime = "nodejs";

const DRIP = 10_000_000n; // 10 test USDC: hours of pay at a typical rate
const ENOUGH = 5_000_000n;

/** One click of Circle's real test USDC on Monad, so a judge can open a tab without visiting any faucet. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { address?: Address } | null;
  if (!b?.address || !isAddress(b.address)) return json({ error: "Sign in first so we know where to send it." }, 400);
  const who = b.address.toLowerCase();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
  if (limited(`faucet:${who}`, 1, 3_600_000) || limited(`faucet-ip:${ip}`, 4, 3_600_000))
    return json({ error: "Test USDC was sent here in the last hour. Try again later." }, 429);
  const balance = (await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [b.address] })) as bigint;
  if (balance >= ENOUGH) return json({ error: "You already have enough test USDC to open a tab." }, 400);
  try {
    const faucet = signer("faucet");
    const pool = (await publicClient.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [faucet.account.address],
    })) as bigint;
    if (pool < DRIP)
      return json({ error: "The test USDC faucet is empty right now. Circle's faucet works too: faucet.circle.com, Monad Testnet." }, 503);
    const data = encodeFunctionData({ abi: usdcAbi, functionName: "transfer", args: [b.address, DRIP] });
    const landed = await sendAndWait(faucet, { to: USDC, data });
    return json({ ...landed, amount: 10 });
  } catch (e) {
    return json({ error: revertReason(e) }, 502);
  }
}
