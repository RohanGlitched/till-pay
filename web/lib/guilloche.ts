/**
 * Guilloche geometry for the notes. Every tab gets its own rosette from a seed, the way every
 * banknote series has its own engraving. Rings are hypotrochoids (the spirograph curve used in
 * security printing); one ring is engraved for each hour worked.
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(...parts: (string | number | bigint)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export type Ring = { R: number; r: number; d: number; rot: number; scale: number; weight: number };

/** Fixed/rolling circle pairs that make good-looking rosettes with 5 to 13 lobes. */
const PAIRS: [number, number][] = [
  [10, 3], [11, 4], [12, 5], [13, 5], [9, 4], [14, 5], [11, 3], [13, 4], [12, 7], [15, 4], [16, 7], [10, 7],
];

export function ringsFor(seed: number, count = 7): Ring[] {
  const rnd = mulberry32(seed);
  const rings: Ring[] = [];
  for (let k = 0; k < count; k++) {
    const [R, r] = PAIRS[Math.floor(rnd() * PAIRS.length)];
    rings.push({
      R,
      r,
      d: r * (0.55 + rnd() * 0.7),
      rot: rnd() * Math.PI * 2,
      scale: 0.36 + (k / (count - 1)) * 0.62,
      weight: 0.55 + rnd() * 0.5,
    });
  }
  return rings;
}

/** SVG path for one hypotrochoid ring centred at (cx, cy) with outer radius `size * ring.scale`. */
export function ringPath(cx: number, cy: number, size: number, ring: Ring): string {
  const { R, r, d, rot } = ring;
  const k = (R - r) / r;
  const turns = r / gcd(R, r);
  const steps = Math.max(240, Math.round(turns * 150));
  const max = R - r + d;
  const s = (size * ring.scale) / max;
  let out = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * Math.PI * 2;
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
    const xr = x * Math.cos(rot) - y * Math.sin(rot);
    const yr = x * Math.sin(rot) + y * Math.cos(rot);
    out += `${i ? "L" : "M"}${(cx + xr * s).toFixed(1)} ${(cy + yr * s).toFixed(1)}`;
  }
  return out + "Z";
}

/** A band of interlaced waves along a straight line: the engraved border of a note. */
export function wavePath(x0: number, y0: number, length: number, amp: number, period: number, phase: number, vertical = false): string {
  const steps = Math.max(8, Math.round((length / period) * 10));
  let out = "";
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * length;
    const w = amp * Math.sin((u / period) * Math.PI * 2 + phase);
    const x = vertical ? x0 + w : x0 + u;
    const y = vertical ? y0 + u : y0 + w;
    out += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return out;
}

export type Band = { radius: number; amp: number; lobes: number; strands: number; twist: number; weight: number };

/**
 * The woven bands of a rosette, one per hour worked. Each band is several sine waves wrapped
 * round a circle with staggered phases; where they cross they make the lattice seen on notes.
 */
export function bandsFor(seed: number, count = 7): Band[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const lobesChoices = [16, 18, 20, 22, 24, 26, 28, 30];
  const out: Band[] = [];
  for (let k = 0; k < count; k++) {
    out.push({
      radius: 0.37 + k * 0.094,
      amp: 0.03 + rnd() * 0.022,
      lobes: lobesChoices[Math.floor(rnd() * lobesChoices.length)]! + k * 2,
      strands: 7 + Math.floor(rnd() * 3),
      twist: rnd() * Math.PI,
      weight: 0.5 + rnd() * 0.35,
    });
  }
  return out;
}

/** One path per strand of a band. */
export function bandPaths(cx: number, cy: number, size: number, b: Band): string[] {
  const paths: string[] = [];
  const steps = b.lobes * 14;
  for (let i = 0; i < b.strands; i++) {
    const phase = b.twist + (i / b.strands) * Math.PI * 2;
    let d = "";
    for (let j = 0; j <= steps; j++) {
      const t = (j / steps) * Math.PI * 2;
      const r = size * (b.radius + b.amp * Math.sin(b.lobes * t + phase) + b.amp * 0.35 * Math.sin(3 * t + phase * 0.5));
      d += `${j ? "L" : "M"}${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`;
    }
    paths.push(d + "Z");
  }
  return paths;
}
