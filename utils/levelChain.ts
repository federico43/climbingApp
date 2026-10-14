import type { Focus, LevelStep } from "./scProgression"

// A progression chain only ever gets *authored* on one exercise at a time —
// whichever row the coach happens to have open, via its own `levels` field
// (the "harder than me" list, see LevelStep in scProgression.ts). Nothing
// links back the other way, so opening a different member of the same chain
// (e.g. the "Elevated push-up" that "Push-up" points to as a level) sees an
// empty chain and the coach has to redefine it from scratch.
//
// These helpers fix that without changing the on-wire shape: every
// exercise's `levels` edges are read as one graph (a -> b means "b is the
// next level after a") so the full easiest -> hardest order can be
// recovered no matter which member it's viewed from, and re-split back into
// per-member "harder than me" tails so every row in the chain stays in sync.

export interface ChainMember {
  $id: string
  name: string
  loadMode?: "weight" | "level"
  levels?: LevelStep[]
  focuses?: Focus[]   // "Used for" — none / empty = all three
}

// Every row's `levels` is read as edges between consecutive steps
// ([row, ...levels]). A healthy ladder is one straight line, but stored
// data can fork — two exercises both saved as "the step right below X"
// (e.g. one linked from each end before linking merged ladders). Instead of
// silently keeping one branch (each member then saw a different ladder),
// everything connected is put in one easiest → hardest order: a
// topological sort of the edges, ties (the forked steps) broken by library
// order. The coach fixes the order once in the ladder editor; saving
// rewrites every member, which removes the fork from the data.
interface LadderGraph {
  next: Map<string, Set<string>>
  prev: Map<string, Set<string>>
  names: Map<string, string>
}

function buildGraph(all: ChainMember[]): LadderGraph {
  const next = new Map<string, Set<string>>()
  const prev = new Map<string, Set<string>>()
  const names = new Map<string, string>()
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    if (!m.has(k)) m.set(k, new Set())
    m.get(k)!.add(v)
  }
  for (const ex of all) names.set(ex.$id, ex.name)
  for (const ex of all) {
    if (ex.loadMode !== "level" || !ex.levels?.length) continue
    const seq: LevelStep[] = [{ exerciseId: ex.$id, name: ex.name }, ...ex.levels]
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i].exerciseId
      const b = seq[i + 1].exerciseId
      if (a === b) continue
      if (!names.has(b)) names.set(b, seq[i + 1].name)
      add(next, a, b)
      add(prev, b, a)
    }
  }
  return { next, prev, names }
}

// Everything linked to `exerciseId`, in either direction.
function component(exerciseId: string, g: LadderGraph): Set<string> {
  const seen = new Set<string>()
  const stack = [exerciseId]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const n of g.next.get(id) ?? []) stack.push(n)
    for (const p of g.prev.get(id) ?? []) stack.push(p)
  }
  return seen
}

export function resolveFullChain(exerciseId: string, all: ChainMember[]): LevelStep[] {
  const g = buildGraph(all)
  if (!g.next.has(exerciseId) && !g.prev.has(exerciseId)) return []
  const members = component(exerciseId, g)
  const rank = new Map(all.map((ex, i) => [ex.$id, i] as const))
  const byRank = (a: string, b: string) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b)

  const indegree = new Map<string, number>()
  for (const id of members) indegree.set(id, [...(g.prev.get(id) ?? [])].filter((p) => members.has(p)).length)
  const order: string[] = []
  const remaining = new Set(members)
  while (remaining.size) {
    const ready = [...remaining].filter((id) => indegree.get(id) === 0).sort(byRank)
    // A loop (a before b and b before a) has no ready step — break it at
    // the first remaining exercise rather than dropping members.
    const id = ready[0] ?? [...remaining].sort(byRank)[0]
    remaining.delete(id)
    order.push(id)
    for (const n of g.next.get(id) ?? []) if (remaining.has(n)) indegree.set(n, (indegree.get(n) ?? 1) - 1)
  }
  return order.map((id) => ({ exerciseId: id, name: g.names.get(id) ?? id }))
}

// True when the stored data for this exercise's ladder forks — two
// exercises on the same step. The ladder editor warns and the next save
// fixes it.
export function ladderHasFork(exerciseId: string, all: ChainMember[]): boolean {
  const g = buildGraph(all)
  const members = component(exerciseId, g)
  if (members.size < 2) return false
  const chain = resolveFullChain(exerciseId, all)
  const pos = new Map(chain.map((l, i) => [l.exerciseId, i] as const))
  // Every stored edge must point exactly one step up the resolved line.
  for (const id of members) {
    for (const n of g.next.get(id) ?? []) {
      // Rows store their whole harder tail, so only consecutive pairs are
      // edges — a straight line has each step's next exactly one up.
      if ((pos.get(n) ?? -1) !== (pos.get(id) ?? -2) + 1) return true
    }
  }
  return false
}

// Adding `picked` to a ladder being edited when `picked` already belongs to
// a ladder of its own: the two become one line — never two exercises on
// the same step. The picked exercise goes right next to `selfId` (above it
// for "harder", below for "easier"); its old ladder keeps its order around
// it. `ladder` is the one being edited, `selfId` included.
export function mergeIntoLadder(
  ladder: LevelStep[], selfId: string, picked: LevelStep, pickedChain: LevelStep[], side: "easier" | "harder",
): LevelStep[] {
  const inLadder = new Set(ladder.map((l) => l.exerciseId))
  const other = (pickedChain.length ? pickedChain : [picked]).filter((l) => !inLadder.has(l.exerciseId) || l.exerciseId === picked.exerciseId)
  const at = other.findIndex((l) => l.exerciseId === picked.exerciseId)
  const otherBefore = at >= 0 ? other.slice(0, at) : []
  const otherAfter = at >= 0 ? other.slice(at + 1) : []
  const selfAt = ladder.findIndex((l) => l.exerciseId === selfId)
  const self = ladder[selfAt]
  const before = [...ladder.slice(0, selfAt), ...otherBefore]
  const after = [...otherAfter, ...ladder.slice(selfAt + 1)]
  return side === "harder"
    ? [...before, self, picked, ...after]
    : [...before, picked, self, ...after]
}

// The tail of the resolved chain after `exerciseId` — i.e. what that
// member's own `levels` field should hold, per the existing "harder than
// me" convention every exercise row already uses.
export function chainTailFor(exerciseId: string, fullChain: LevelStep[]): LevelStep[] {
  const idx = fullChain.findIndex((l) => l.exerciseId === exerciseId)
  return idx === -1 ? [] : fullChain.slice(idx + 1)
}

// ─── Resolving a block exercise's chain at workout time ─────────────────────
//
// A block keeps a *copy* of its exercise's `levels` from when it was added,
// and that copy only holds the levels harder than the one prescribed. So a
// block prescribing "Push-up" never knew about "Knee push-up" below it, and
// chain edits in the library never reached saved templates/plans. The live
// library is the source of truth: resolve the full easiest → hardest chain
// from it, and only fall back to the block's copy when the library isn't
// available (offline) or no longer has the row.

export interface ChainSource {
  exerciseId?: string
  name: string
  loadMode?: "weight" | "level"
  levels?: LevelStep[]
}

export interface ResolvedChain {
  chain: LevelStep[]      // full chain, easiest → hardest
  prescribedIdx: number   // where the block's own exercise sits in it
  // Each member's "Used for" focuses, from the library (absent offline or
  // when not set = every focus).
  focuses?: Record<string, Focus[]>
}

// Which ladder steps the app may move an athlete onto at `focus`: those
// whose "Used for" includes it (or isn't set). A negative pull-up or an
// isometric hold can't be done explosively, so explosiveness skips them.
export function usableAt(resolved: ResolvedChain, focus: Focus | undefined): (step: LevelStep) => boolean {
  return (step) => {
    const f = resolved.focuses?.[step.exerciseId]
    return !focus || !f || f.length === 0 || f.includes(focus)
  }
}

// The library row behind a block exercise: by id, else by exact name —
// AI-generated and some older blocks carry no exerciseId.
export function findLibraryRow<T extends ChainMember>(ex: ChainSource, library: T[]): T | undefined {
  if (ex.exerciseId) {
    const byId = library.find((row) => row.$id === ex.exerciseId)
    if (byId) return byId
  }
  const name = ex.name.trim().toLowerCase()
  return name ? library.find((row) => row.name.trim().toLowerCase() === name) : undefined
}

// null = not a level exercise (weight mode). With a library, its answer
// wins even when it disagrees with the block's copy in either direction.
export function resolveExerciseChain(ex: ChainSource, library: ChainMember[] | null): ResolvedChain | null {
  const row = library ? findLibraryRow(ex, library) : undefined
  if (row) {
    const chain = resolveFullChain(row.$id, library!)
    if (chain.length < 2) return null
    const focuses: Record<string, Focus[]> = {}
    for (const step of chain) {
      const f = library!.find((r) => r.$id === step.exerciseId)?.focuses
      if (f?.length) focuses[step.exerciseId] = f
    }
    return { chain, prescribedIdx: chain.findIndex((l) => l.exerciseId === row.$id), ...(Object.keys(focuses).length ? { focuses } : {}) }
  }
  if (ex.loadMode !== "level" || !ex.levels?.length) return null
  // An id-less exercise gets "" as its step id; logging maps it back to
  // "no id" so its history still matches by name.
  return { chain: [{ exerciseId: ex.exerciseId ?? "", name: ex.name }, ...ex.levels], prescribedIdx: 0 }
}

// Every exercise id in the chain — the "family" a logged round may belong to.
export function chainIds(resolved: ResolvedChain, ownId?: string): string[] {
  return [...new Set([ownId, ...resolved.chain.map((l) => l.exerciseId)].filter((id): id is string => !!id))]
}

// Where a logged exercise sits in the chain; -1 when it isn't a member.
export function chainIndexOf(resolved: ResolvedChain, exerciseId: string | undefined): number {
  return resolved.chain.findIndex((l) => l.exerciseId === (exerciseId ?? ""))
}
