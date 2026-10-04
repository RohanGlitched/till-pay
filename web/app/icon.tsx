import { ImageResponse } from "next/og";
import { ringPath, ringsFor } from "@/lib/guilloche";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

const RINGS = ringsFor(1712, 3).map((r, i) => ({ ...r, scale: [0.55, 0.78, 1][i]! }));

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 64, height: 64, display: "flex", background: "#EDF1EC", borderRadius: 14 }}>
        <svg width="64" height="64" viewBox="0 0 100 100">
          {RINGS.map((r, i) => (
            <path key={i} d={ringPath(50, 50, 44, r)} fill="none" stroke={i === 2 ? "#C0266D" : "#17332B"} strokeWidth={i === 2 ? 3 : 2.4} />
          ))}
        </svg>
      </div>
    ),
    size,
  );
}
