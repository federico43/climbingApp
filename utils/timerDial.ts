// The big timer dial (Federico's mock-up 2026-11-25, components/IntervalVisuals.tsx
// TimerRing): a ring with 60 clock ticks around it, the phase as a small
// caption, the clock in big poster digits and a round pause button under
// them. Sizes are the mock-up's at a 260 pt ring and scale with the ring.
// Pure (no React Native), so the geometry can be tested in Node.

/** Ring diameter the mock-up was drawn at. */
export const DIAL_BASE = 260
export const DIAL_TICKS = 60

export interface DialGeometry {
  /** Scale against the mock-up (ring size / 260). */
  k: number
  /** Ring stroke width. */
  stroke: number
  /** Width and height of the whole dial, ticks included. */
  box: number
  /** Radius where the ticks start (just outside the ring). */
  tickInner: number
  majorLen: number
  minorLen: number
  /** Diameter of the face inside the ring. */
  face: number
}

export function dialGeometry(size: number): DialGeometry {
  const k = size / DIAL_BASE
  const stroke = Math.max(8, Math.round(14 * k))
  const gap = 8 * k
  const majorLen = 10 * k
  return {
    k,
    stroke,
    box: Math.round(size + 2 * (gap + majorLen)),
    tickInner: size / 2 + gap,
    majorLen,
    minorLen: 5.5 * k,
    face: size - 2 * stroke,
  }
}

export interface DialTicks {
  /** Ticks the arc has reached: every 5th (longer) and the rest. */
  litMajor: string
  litMinor: string
  /** Ticks still ahead of the arc (drawn faded). */
  dimMajor: string
  dimMinor: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The 60 ticks as SVG paths ("M x y L x y" per tick), clockwise from 12
 * o'clock in a `box`-sized square. A tick is lit once the arc (`fill`, 0–100,
 * filling as time passes) has reached it; the one at 12 o'clock always is.
 */
export function dialTicks(size: number, fill: number): DialTicks {
  const g = dialGeometry(size)
  const c = g.box / 2
  const reached = (Math.min(100, Math.max(0, fill)) / 100) * DIAL_TICKS
  const out: DialTicks = { litMajor: "", litMinor: "", dimMajor: "", dimMinor: "" }
  for (let i = 0; i < DIAL_TICKS; i++) {
    const major = i % 5 === 0
    const a = (i / DIAL_TICKS) * 2 * Math.PI - Math.PI / 2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const r0 = g.tickInner
    const r1 = g.tickInner + (major ? g.majorLen : g.minorLen)
    const seg = `M${round2(c + r0 * cos)} ${round2(c + r0 * sin)}L${round2(c + r1 * cos)} ${round2(c + r1 * sin)}`
    const key = `${i <= reached ? "lit" : "dim"}${major ? "Major" : "Minor"}` as keyof DialTicks
    out[key] += seg
  }
  return out
}

// Advance widths (em) of Archivo ExtraCondensed Black, the clock's font.
// Digits use the widest one (they're tabular, so all the same).
const ADVANCE: Record<string, number> = { ":": 0.222, "+": 0.528, "-": 0.24, "!": 0.266, " ": 0.11, g: 0.415, o: 0.433 }
const DIGIT = 0.445

/** Width of `text` in the clock's font, in em. */
export function clockEm(text: string): number {
  let em = 0
  for (const ch of text) em += /\d/.test(ch) ? DIGIT : ADVANCE[ch] ?? 0.45
  return em
}

/**
 * Font size of the clock digits: 104 pt at a 260 ring ("1:22" in the
 * mock-up), smaller when the text wouldn't fit across the face ("12:34",
 * "1:05:00").
 */
export function clockFontSize(text: string, size: number): number {
  const g = dialGeometry(size)
  const full = 104 * g.k
  const em = clockEm(text)
  if (em <= 0) return Math.round(full)
  return Math.round(Math.min(full, (g.face * 0.85) / em))
}

/** Biggest ring (between `min` and `max`) whose whole dial fits in w × h. */
export function fitDialSize(w: number, h: number, max = DIAL_BASE, min = 120): number {
  const ratio = dialGeometry(DIAL_BASE).box / DIAL_BASE
  return Math.round(Math.max(min, Math.min(max, w / ratio, h / ratio)))
}

/** The clock as the dial shows it: "1:22", "12:34", "1:05:00". */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}
