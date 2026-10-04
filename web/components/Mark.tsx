import { ringPath, ringsFor } from "@/lib/guilloche";

const RINGS = ringsFor(1712, 3).map((r, i) => ({ ...r, scale: [0.55, 0.78, 1][i]! }));
const PATHS = RINGS.map((r) => ringPath(50, 50, 46, r));

/** Till's mark: a small guilloche rosette, the same engraving every tab note is built from. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ flex: "none" }}>
      {PATHS.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={i === 2 ? "var(--serial)" : "currentColor"} strokeWidth={i === 2 ? 2.2 : 1.6} />
      ))}
    </svg>
  );
}
