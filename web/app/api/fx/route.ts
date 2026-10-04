import { json } from "@/lib/server";

export const revalidate = 21600;

/** Daily reference rates (open.er-api.com, no key), cached for six hours. Shown to people, never used to move money. */
export async function GET() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { next: { revalidate: 21600 } });
    const data = await res.json();
    if (data.result !== "success") throw new Error("bad rates");
    return json({ rates: data.rates, updated: data.time_last_update_utc }, 200, {
      "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400",
    });
  } catch {
    return json({ rates: null, updated: null }, 200, { "cache-control": "public, s-maxage=60" });
  }
}
