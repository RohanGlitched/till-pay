import { tillAbi } from "@/lib/abi";
import { TILL, publicClient } from "@/lib/chain";
import { json } from "@/lib/server";
import { earnedAt, readProfiles, readTabs } from "@/lib/tabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { at: number; body: unknown } | null = null;

/**
 * Network-wide numbers for the landing page, read straight from contract state (no indexer):
 * how many tabs exist and run right now, what has been paid, and one running tab to show.
 */
export async function GET() {
  if (cache && Date.now() - cache.at < 3000) return json(cache.body, 200, { "cache-control": "no-store" });
  try {
    const count = (await publicClient.readContract({ address: TILL, abi: tillAbi, functionName: "tabCount" })) as bigint;
    const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
    const [tabs, block] = await Promise.all([readTabs(ids), publicClient.getBlock()]);
    const now = Number(block.timestamp);
    let paid = 0n;
    let earned = 0n;
    const running = tabs.filter((v) => !v.tab.closed && v.tab.since > 0n && earnedAt(v.tab, now) < v.tab.budget);
    for (const v of tabs) {
      paid += v.tab.paid;
      earned += earnedAt(v.tab, now);
    }
    // Feature the running tab that has been going longest, so the hero has a story behind it.
    const featured = [...running].sort((a, b) => Number(a.tab.since - b.tab.since))[0] ?? tabs.filter((v) => !v.tab.closed).at(-1) ?? null;
    const profiles = featured ? await readProfiles([featured.tab.payer, featured.tab.payee]) : {};
    const body = {
      tabs: tabs.length,
      running: running.length,
      paid,
      earned,
      block: Number(block.number),
      blockTime: now,
      featured,
      profiles,
    };
    cache = { at: Date.now(), body };
    return json(body, 200, { "cache-control": "no-store" });
  } catch {
    return json({ tabs: null }, 200, { "cache-control": "no-store" });
  }
}
