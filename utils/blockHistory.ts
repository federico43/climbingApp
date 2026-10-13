import type { SessionRow } from "@/services/BoulderGraphService"
import type { Attempt } from "@/hooks/WorkoutHook"

// Reads "what did this athlete do last time on this block" out of their
// session history. The block-level counterpart to scHistory.ts (which works
// per S&C exercise): shared by every block's athlete runtime (prefilling the
// next session's suggestion) and the coach's block editor (flagging the
// same suggestion while authoring), so both always agree.

// What identifies "the same block" across sessions. libraryBlockId is the
// rename-safe key (set when a block is cloned from the library); the name is
// only a fallback for blocks with no library link, e.g. sessions logged
// before libraryBlockId existed.
export interface BlockRef {
  type: string
  blockName?: string
  libraryBlockId?: string
}

// One past run of a block: the block config as it was run that session, plus
// that block's own attempts (in logged order).
export interface BlockRun {
  sessionId: string
  createdAt: string
  block: any
  attempts: Attempt[]
}

function blockMatches(candidate: any, ref: BlockRef): boolean {
  if (candidate?.type !== ref.type) return false
  if (ref.libraryBlockId && candidate?.libraryBlockId) return candidate.libraryBlockId === ref.libraryBlockId
  return !!ref.blockName && candidate?.blockName === ref.blockName
}

// A coached sequence block's attempts, split into one run per route (the
// coach made up several), newest — last logged — first.
function coachedSequenceRuns(s: SessionRow, block: any, attempts: Attempt[]): BlockRun[] {
  const byRoute = new Map<string, Attempt[]>()
  for (const a of attempts) {
    if (!a.routeId) continue // the Done marker
    const list = byRoute.get(a.routeId)
    if (list) list.push(a)
    else byRoute.set(a.routeId, [a])
  }
  return [...byRoute.values()].reverse()
    .map((own) => ({ sessionId: s.$id, createdAt: s.$createdAt, block, attempts: own }))
}

// Every run of this block, newest session first (sessions are expected
// newest-first, as getSessions/getSessionsByUserId return them). Runs with no
// logged attempts are dropped — a block opened and left without logging
// anything says nothing about how it went. A session that ran the same block
// twice yields both runs, later block first.
//
// Coached blocks (run by the coach in person, §12 of
// docs/training-plan-implementation.md) log nothing to progress from, so
// they're skipped — progression carries on from the last guided run. Except
// sequences: each of the coach's sequences the athlete saved counts as a run
// on that route (one run per route, newest first).
export function findBlockRuns(sessions: SessionRow[], ref: BlockRef): BlockRun[] {
  const runs: BlockRun[] = []
  for (const s of sessions) {
    let protocol: any[] = []
    let attempts: Attempt[] = []
    try { protocol = JSON.parse(s.protocol || "[]") } catch { continue }
    try { attempts = JSON.parse(s.attempts || "[]") } catch { continue }
    if (!Array.isArray(protocol) || !Array.isArray(attempts)) continue
    for (let i = protocol.length - 1; i >= 0; i--) {
      if (!blockMatches(protocol[i], ref)) continue
      const own = attempts.filter((a) => a?.blockIndex === i)
      if (own.length === 0) continue
      if (protocol[i]?.coached) {
        if (protocol[i].type === "sequence") runs.push(...coachedSequenceRuns(s, protocol[i], own))
        continue
      }
      runs.push({ sessionId: s.$id, createdAt: s.$createdAt, block: protocol[i], attempts: own })
    }
  }
  return runs
}
