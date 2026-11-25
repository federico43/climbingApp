// Phone workout builder, "spine" layout (mock-ups 2026-11-25): what each
// block's card and sheet show. Pure.

import { estimateBlockSeconds } from "@/utils/workoutSummary"

// How the athlete gets the block: the coach runs it in person, the athlete
// does it on their own in the workout, or it moves to homework on save.
export type BlockMode = "coached" | "own" | "homework"

export function blockMode(block: { coached?: boolean }, homework: boolean): BlockMode {
  if (homework) return "homework"
  return block.coached ? "coached" : "own"
}

// Estimated minutes from the block's own settings (no history reads here).
export function blockMinutes(block: any): number {
  return Math.max(1, Math.round(estimateBlockSeconds(block, new Map()) / 60))
}

export function workoutMinutes(blocks: any[]): number {
  return blocks.reduce((sum, b) => sum + blockMinutes(b), 0)
}

// The card's one-line preview of the coach's note.
export function noteExcerpt(text: string | null | undefined, max = 70): string {
  const line = (text ?? "").trim().split(/\n+/)[0]?.trim() ?? ""
  if (line.length <= max) return line
  return line.slice(0, max - 1).trimEnd() + "…"
}

// "Block 02 of 03".
export function blockOrdinal(index: number, total: number): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `Block ${pad(index + 1)} of ${pad(Math.max(total, index + 1))}`
}
