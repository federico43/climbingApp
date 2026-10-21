import { alternateMainBlock, MAIN_BLOCKS, MAIN_CYCLE, type LibraryBlockRef, type MainType } from "@/utils/planRotation"

// The athlete's own ⇄ switch of a plan workout's main block mid-workout
// (Project ↔ Max, 4×4 ↔ Base 1) — the same alternation as the coach's ⇄ Swap
// on the next-workout card, but for this session only: the saved workout is
// left as the coach built it. Pure; the library fetch lives in WorkoutContext.

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface MainSwap {
  mainType: MainType
  from: LibraryBlockRef
  to: LibraryBlockRef
}

// What block `index` can switch to: only a main block (matched by name +
// type, like builtMainBlock) of a type with two of them. null otherwise.
export function mainSwapFor(blocks: any[], index: number): MainSwap | null {
  const b = blocks[index]
  if (typeof b?.blockName !== "string" || typeof b?.type !== "string") return null
  for (const mainType of MAIN_CYCLE) {
    const from = MAIN_BLOCKS[mainType].find((r) => r.type === b.type && sameName(r.name, b.blockName))
    if (!from) continue
    const to = alternateMainBlock(mainType, from)
    return to ? { mainType, from, to } : null
  }
  return null
}

// The blocks with `index` — and the copies of the same main block right
// after it that nothing's been logged on yet (main runs × 2) — replaced by
// `replacement`. Each keeps its own id and coached flag.
export function applyMainSwap(blocks: any[], index: number, replacement: any, logged: Set<number>): any[] {
  const from = blocks[index]
  if (!from) return blocks
  const same = (b: any) => b?.type === from.type && sameName(b?.blockName ?? "", from.blockName ?? "")
  const swap = new Set<number>([index])
  for (let i = index + 1; i < blocks.length && same(blocks[i]) && !logged.has(i); i++) swap.add(i)
  return blocks.map((b, i) => (swap.has(i) ? { ...replacement, id: b.id, coached: b.coached } : b))
}
