// Serialize a workout into the payload shape `saveSession` expects.
//
// Skipped blocks are dropped and the surviving block indices are remapped so
// attempts/durations stay aligned. Shared by the live completion path and the
// crash-recovery flush (both in the workout provider) so both produce
// identical sessions.

export interface SerializedSession {
  protocol: string
  attempts: string
  blockDurations: string
}

export function serializeSession(
  protocol: any[],
  attempts: { blockIndex: number; [k: string]: any }[],
  blockDurations: Record<number, number>,
  skippedBlocks: Set<number>,
): SerializedSession {
  const keptIdx = protocol.map((_, i) => i).filter((i) => !skippedBlocks.has(i))
  const remap = new Map<number, number>()
  keptIdx.forEach((oldIdx, newIdx) => remap.set(oldIdx, newIdx))

  const protocolOut = keptIdx.map((i) => protocol[i])
  const attemptsOut = attempts
    .filter((a) => !skippedBlocks.has(a.blockIndex))
    .map((a) => ({ ...a, blockIndex: remap.get(a.blockIndex) ?? a.blockIndex }))
  const durationsOut: Record<number, number> = {}
  keptIdx.forEach((oldIdx, newIdx) => {
    durationsOut[newIdx] = blockDurations[oldIdx] ?? 0
  })

  return {
    protocol: JSON.stringify(protocolOut),
    attempts: JSON.stringify(attemptsOut),
    blockDurations: JSON.stringify(durationsOut),
  }
}
