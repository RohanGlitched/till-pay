import { ImageResponse } from "next/og";
import { bandPaths, bandsFor, ringPath, ringsFor, seedOf, wavePath } from "@/lib/guilloche";

export const alt = "Till: get paid every second you work";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG() {
  const seed = seedOf("till", "1");
  const bands = bandsFor(seed, 7).flatMap((b) => bandPaths(300, 315, 250, b));
  const core = ringsFor(seed, 2).map((r, i) => ringPath(300, 315, 250 * (i ? 0.33 : 0.29), { ...r, scale: 1 }));
  const waves = [0, 1, 2].flatMap((i) => [wavePath(30, 26, 1140, 7, 34, i * 2.1), wavePath(30, 604, 1140, 7, 34, i * 2.1 + 1)]);
  // Google Fonts serves TrueType to clients that don't announce woff2 support, which is what Satori reads.
  const font = await fetch("https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,700")
    .then((r) => r.text())
    .then((css) => css.match(/src: url\((.+?)\)/)?.[1])
    .then((url) => (url ? fetch(url).then((r) => r.arrayBuffer()) : null))
    .catch(() => null);

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", background: "#EDF1EC", position: "relative", fontFamily: "Archivo" }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          {waves.map((d, i) => (
            <path key={`w${i}`} d={d} fill="none" stroke="#2557B0" strokeWidth="1.2" opacity="0.7" />
          ))}
          {bands.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={i < bands.length - 8 ? "#2557B0" : "#C0266D"} strokeWidth="0.8" opacity="0.8" />
          ))}
          {core.map((d, i) => (
            <path key={`c${i}`} d={d} fill="none" stroke="#2557B0" strokeWidth="0.9" />
          ))}
          <circle cx="300" cy="315" r="62" fill="#EDF1EC" stroke="#2557B0" strokeWidth="2" />
        </svg>
        <div style={{ position: "absolute", left: 258, top: 284, fontSize: 52, fontWeight: 700, color: "#2557B0" }}>AR</div>
        <div style={{ position: "absolute", left: 610, top: 120, display: "flex", flexDirection: "column", width: 540 }}>
          <div style={{ fontSize: 30, color: "#C0266D", fontWeight: 600 }}>Till</div>
          <div style={{ fontSize: 72, lineHeight: 1, color: "#17332B", fontWeight: 700, marginTop: 18, letterSpacing: -2 }}>
            Get paid every second you work.
          </div>
          <div style={{ fontSize: 28, color: "#4E6159", marginTop: 26, lineHeight: 1.35 }}>
            Cross-border pay in USDC that lands on Monad while you work.
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Archivo", data: font, weight: 700 }] : undefined },
  );
}
