// A workout as a short summary by phase — S&C, warm-up / test, main — with
// an estimated duration. Pure. Used by the athlete's Plan tab for built
// workouts (from their blocks) and upcoming ones (from the rotation).

import type { BlockRow } from "@/services/BoulderGraphService"
import { type Adaptation, resolveAdaptation } from "@/utils/adaptations"
import { findLibraryBlock } from "@/utils/planWorkout"
import {
  MAIN_BLOCK_COPIES,
  PLAN_FOCUS_LABEL,
  type PlanFocus,
  TEST_BLOCK,
  WARMUP_INTERVALS_BLOCK,
  type WorkoutSpec,
} from "@/utils/planRotation"
import { SC_PLAN_RULES } from "@/utils/scPlanBuilder"
import { FOCUS_LABEL, type Focus } from "@/utils/scProgression"

export type PhaseKey = "sc" | "warmup" | "test" | "main"

export interface PhaseSummary {
  key: PhaseKey
  label: string          // "S&C", "Warm-up", "Test", "Main"
  adaptation: Adaptation // colour
  title: string          // "Project Bouldering ×2", "3 constraints", "Max force"
  detail: string         // "5 attempts each", "4 exercises · 3 rounds"
  minutes: number
}

export interface WorkoutSummary {
  phases: PhaseSummary[]
  minutes: number
}

const PHASE_LABEL: Record<PhaseKey, string> = { sc: "S&C", warmup: "Warm-up", test: "Test", main: "Main" }

// ─── Duration ────────────────────────────────────────────────────────────────

// Seconds the athlete has actually spent on a block, from their sessions'
// blockDurations — keyed by type + name, and by type alone.
export type DurationHistory = Map<string, number[]>

const nameKey = (type: string, name: string) => `${type}|${name.trim().toLowerCase()}`

export function buildDurationHistory(
  sessions: { protocol: string; blockDurations?: string }[],
): DurationHistory {
  const history: DurationHistory = new Map()
  const add = (key: string, secs: number) => {
    const list = history.get(key)
    if (list) list.push(secs)
    else history.set(key, [secs])
  }
  for (const s of sessions) {
    if (!s.blockDurations) continue
    try {
      const blocks: any[] = JSON.parse(s.protocol)
      const durations: Record<string, number> = JSON.parse(s.blockDurations)
      blocks.forEach((b, i) => {
        const secs = durations[i]
        // Under a minute = skipped through or not timed — not a real duration.
        // Coached blocks run to the coach's clock, not the block's.
        if (!b?.type || b.coached || !secs || secs < 60) return
        add(nameKey(b.type, b.blockName ?? ""), secs)
        add(b.type, secs)
      })
    } catch {}
  }
  return history
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const ATTEMPT_SECS = 60

// From the block's own settings when there's no history.
function settingsSeconds(b: any): number {
  const n = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? v : fallback)
  switch (b.type) {
    case "project_bouldering":
    case "sequence":
      return n(b.targetAttempts, 5) * (ATTEMPT_SECS + n(b.restTime, 180))
    case "constraint_warmup":
      return n(b.targetAttempts, 3) * 2 * ATTEMPT_SECS
    case "four_by_four":
      return n(b.sets, 4) * (n(b.bouldersPerSet, 4) * ATTEMPT_SECS + n(b.restTime, 240))
    case "intervals":
      return n(b.series, 4) * (n(b.workTime, 60) + n(b.restTime, 60))
    case "strength_conditioning":
      return n(b.rounds, 3) * ((b.exercises?.length || 2) * ATTEMPT_SECS + n(b.restBetweenRounds, 120))
    default: // exploration / free session
      return n(b.timeLimit, 20) * 60
  }
}

// History (same block name, then — for blocks whose names vary, like
// S&C and constraints — same type), else the block's settings.
export function estimateBlockSeconds(b: any, history: DurationHistory): number {
  const byName = history.get(nameKey(b.type, b.blockName ?? ""))
  if (byName?.length) return median(byName)
  if (b.type === "strength_conditioning" || b.type === "constraint_warmup") {
    const byType = history.get(b.type)
    if (byType?.length) return median(byType)
  }
  return settingsSeconds(b)
}

// "45m", "1h", "1h 40m".
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

const toMinutes = (secs: number) => Math.max(5, Math.round(secs / 60 / 5) * 5)

// ─── Summaries ───────────────────────────────────────────────────────────────

function phaseOf(b: any): PhaseKey {
  if (b.type === "strength_conditioning") return "sc"
  if (b.type === "constraint_warmup" || (b.type === "intervals" && b.kind === "warmup")) return "warmup"
  if (b.adaptation === "test" || (b.type === TEST_BLOCK.type && (b.blockName ?? "").trim().toLowerCase() === TEST_BLOCK.name.toLowerCase())) return "test"
  return "main"
}

function plural(n: number, word: string) {
  return `${n} ${word}${n !== 1 ? "s" : ""}`
}

function mainDetail(b: any, copies: number): string {
  const each = copies > 1 ? " each" : ""
  switch (b.type) {
    case "project_bouldering":
    case "sequence":
      return b.targetAttempts ? `${plural(b.targetAttempts, "attempt")}${each}` : ""
    case "four_by_four":
      return b.sets && b.bouldersPerSet ? `${b.sets} sets of ${b.bouldersPerSet} boulders${each}` : ""
    case "intervals":
      return b.series ? `${b.series} × ${b.workTime}s on / ${b.restTime}s off` : ""
    default:
      return b.timeLimit ? `${b.timeLimit} min${each}` : ""
  }
}

function scFocusOf(blocks: any[]): Focus | null {
  for (const b of blocks) for (const e of b.exercises ?? []) if (e.focus) return e.focus
  return null
}

function summarizeGroup(key: PhaseKey, blocks: any[], minutes: number): PhaseSummary {
  const first = blocks[0]
  const base = { key, label: PHASE_LABEL[key], minutes, adaptation: resolveAdaptation(first) }
  if (key === "sc") {
    const focus = scFocusOf(blocks)
    const exercises = blocks.reduce((n, b) => n + (b.exercises?.length ?? 0), 0)
    return {
      ...base,
      adaptation: "conditioning",
      title: focus ? FOCUS_LABEL[focus] : "Strength & conditioning",
      detail: [plural(exercises, "exercise"), first.rounds ? plural(first.rounds, "round") : null].filter(Boolean).join(" · "),
    }
  }
  if (key === "warmup") {
    if (first.type === "intervals") {
      // 1 on 1 off goes in untagged (§6.2) — a general warm-up, not power endurance.
      const adaptation: Adaptation = first.adaptation ? resolveAdaptation(first) : "general"
      return { ...base, adaptation, title: first.blockName || "Intervals", detail: first.series ? plural(first.series, "round") : "" }
    }
    return {
      ...base,
      title: plural(blocks.length, "constraint"),
      detail: blocks.map((b) => b.blockName).filter(Boolean).join(" · "),
    }
  }
  if (key === "test") {
    return { ...base, adaptation: "test", title: first.blockName || "Test", detail: first.timeLimit ? `${first.timeLimit} min` : "" }
  }
  const names = [...new Set(blocks.map((b) => b.blockName || "Block"))]
  return {
    ...base,
    title: names.length === 1 ? `${names[0]}${blocks.length > 1 ? ` ×${blocks.length}` : ""}` : names.join(" · "),
    detail: names.length === 1 ? mainDetail(first, blocks.length) : plural(blocks.length, "block"),
  }
}

// A built workout's blocks, consecutive blocks of the same phase grouped.
export function summarizeBlocks(blocks: any[], history: DurationHistory): WorkoutSummary {
  const phases: PhaseSummary[] = []
  let group: any[] = []
  let groupKey: PhaseKey | null = null
  const flush = () => {
    if (!groupKey || group.length === 0) return
    const secs = group.reduce((t, b) => t + estimateBlockSeconds(b, history), 0)
    phases.push(summarizeGroup(groupKey, group, toMinutes(secs)))
  }
  for (const b of blocks) {
    const key = phaseOf(b)
    if (key !== groupKey) {
      flush()
      group = []
      groupKey = key
    }
    group.push(b)
  }
  flush()
  return { phases, minutes: phases.reduce((t, p) => t + p.minutes, 0) }
}

// An upcoming workout from the rotation (docs/training-plan.md §5, §7.2):
// the same phases Build will produce, timed from the library blocks and
// the athlete's history. Specific constraints / exercises are picked at
// build time, so they're counted, not named.
export function summarizeSpec(
  spec: WorkoutSpec,
  plan: { focus: PlanFocus; hasMobility: boolean; scPatterns: unknown[] },
  library: BlockRow[],
  history: DurationHistory,
): WorkoutSummary {
  const fromLibrary = (ref: { name: string; type: string }) => {
    const row = findLibraryBlock(ref as any, library)
    let data: any = {}
    try { data = row ? JSON.parse(row.data) : {} } catch {}
    return { ...data, type: ref.type, blockName: row?.name ?? ref.name }
  }
  const phases: PhaseSummary[] = []

  if (spec.scFocus) {
    const patterns = plan.scPatterns.length || 4
    const sc = (exercises: number, rest: number) => ({
      type: "strength_conditioning",
      rounds: SC_PLAN_RULES.rounds,
      restBetweenRounds: rest,
      exercises: Array.from({ length: exercises }, () => ({})),
    })
    const blocks = plan.hasMobility
      ? [sc(3, SC_PLAN_RULES.restWithMobility), sc(3, SC_PLAN_RULES.restWithMobility), sc(2, SC_PLAN_RULES.restMobilityBlock)]
      : [sc(patterns / 2, spec.scFocus === "hypertrophy" ? SC_PLAN_RULES.restHypertrophy : SC_PLAN_RULES.restOther),
         sc(patterns / 2, spec.scFocus === "hypertrophy" ? SC_PLAN_RULES.restHypertrophy : SC_PLAN_RULES.restOther)]
    const secs = blocks.reduce((t, b) => t + estimateBlockSeconds(b, history), 0)
    phases.push({
      key: "sc",
      label: PHASE_LABEL.sc,
      adaptation: "conditioning",
      title: FOCUS_LABEL[spec.scFocus],
      detail: `${plural(patterns, "exercise")}${plan.hasMobility ? " + mobility" : ""} · ${plural(SC_PLAN_RULES.rounds, "round")}`,
      minutes: toMinutes(secs),
    })
  }

  // The Density test isn't in the workout — it's homework (§8).
  if (spec.warmup === "constraints") {
    const one = { type: "constraint_warmup", blockName: "", targetAttempts: 3 }
    phases.push({
      key: "warmup",
      label: PHASE_LABEL.warmup,
      adaptation: plan.focus, // the focus picks the constraints (§6.1)
      title: "3 constraints",
      detail: `${PLAN_FOCUS_LABEL[plan.focus]} focus`,
      minutes: toMinutes(3 * estimateBlockSeconds(one, history)),
    })
  } else {
    const warm = { ...fromLibrary(WARMUP_INTERVALS_BLOCK), kind: "warmup", series: 4 }
    phases.push(summarizeGroup("warmup", [warm], toMinutes(estimateBlockSeconds(warm, history))))
  }

  const main = fromLibrary(spec.mainBlock)
  const mainBlocks = Array.from({ length: MAIN_BLOCK_COPIES }, () => ({ ...main, adaptation: spec.mainType }))
  const mainSecs = mainBlocks.reduce((t, b) => t + estimateBlockSeconds(b, history), 0)
  phases.push(summarizeGroup("main", mainBlocks, toMinutes(mainSecs)))

  return { phases, minutes: phases.reduce((t, p) => t + p.minutes, 0) }
}
