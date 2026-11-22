// A redone S&C round replaces the earlier one. The athlete can redo a round
// with the circuit's Back arrow, or by leaving the block and coming back into
// it (it restarts at round 1); each Done used to add a new attempt, so the
// same round was counted twice by history, the Progression card and the
// charts (Nalguete, 17 Nov: 3 rounds counted as 6). Pure.

interface ScAttemptLike {
  blockIndex?: number
  type?: string
  scData?: {
    round?: number
    slot?: number
    exerciseId?: string
    exerciseName?: string
    swappedFrom?: { exerciseId?: string; exerciseName?: string } | null
  } | null
  scReview?: { exerciseId?: string; exerciseName?: string } | null
}

// Which round of which exercise of which block an S&C attempt is. `slot` is
// the exercise's place in the block (logged since 2026-11-22); older logs
// fall back to the exercise it replaced (a swap) or its own identity. The
// end-of-block review (one per exercise) is keyed too: a block done again
// logs it again.
export function scRoundKey(a: ScAttemptLike): string | null {
  if (a?.type === "strength_conditioning" && a.scReview && a.blockIndex != null) {
    return `${a.blockIndex}|review|${a.scReview.exerciseId || a.scReview.exerciseName || ""}`
  }
  const d = a?.scData
  if (a?.type !== "strength_conditioning" || !d || d.round == null || a.blockIndex == null) return null
  const exercise = d.slot != null
    ? `#${d.slot}`
    : d.swappedFrom ? `from:${d.swappedFrom.exerciseId || d.swappedFrom.exerciseName || ""}` : d.exerciseId || d.exerciseName || ""
  return `${a.blockIndex}|${d.round}|${exercise}`
}

// The attempts with only the latest log of each S&C round kept (later in
// the array = later); everything else untouched, order kept.
export function withoutRedoneRounds<T extends ScAttemptLike>(attempts: T[]): T[] {
  const last = new Map<string, number>()
  attempts.forEach((a, i) => {
    const key = scRoundKey(a)
    if (key) last.set(key, i)
  })
  if (last.size === attempts.filter((a) => scRoundKey(a)).length) return attempts
  return attempts.filter((a, i) => {
    const key = scRoundKey(a)
    return !key || last.get(key) === i
  })
}
