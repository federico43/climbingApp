// An athlete's progress through the technique modules (docs/technique-modules.md).
// Pure: no React Native, no Appwrite. Stored as JSON in users.techniqueProgress
// (a TEXT column, PR 3) with a phone copy, like next-session tasks.
//
// The rules:
// - A route passes with ≤ maxBreaks rule breaks and a feel in passFeels.
// - routesInARow passing routes in a row (across sessions) at the athlete's
//   level and colour earn the next step.
// - The next step is a colour up instead of a level up when every route in
//   that run had 0 breaks and felt easy (the colour was too low to test
//   them), up to maxColourStep colours.
// - A level up is proposed (pending); the coach confirms or holds it. If the
//   coach hasn't answered by the athlete's next module session, it unlocks
//   when that session starts.
// - Passing the last level marks the module mastered; they stay on it.

import { shiftColour } from "@/utils/boulderColours"
import {
  MAX_BREAKS_TAP, moduleLevel, type RouteFeel, type TechniqueId, type TechniqueModule,
  type TechniqueModuleId, isTechniqueModuleId,
} from "@/utils/techniqueModules"

export interface RouteLog {
  breaks: number // 0…MAX_BREAKS_TAP (3 = "3 or more")
  feel: RouteFeel
}

export type LevelChangeBy = "coach" | "auto" | "coach_set"

export interface LevelChange {
  level: number
  on: string // YYYY-MM-DD
  by: LevelChangeBy
}

// A level up waiting on the coach.
export interface PendingLevelUp {
  level: number
  since: string // the session day it was earned
}

// The start check / retest result: what the athlete logged on those days.
export interface CheckResult {
  on: string
  level: number
  routes: RouteLog[]
}

export interface ModuleProgress {
  level: number
  colourStep: number          // colours above the level's base colour
  streak: number              // passing routes in a row at this level and colour
  easyRun: boolean            // every route in the streak had 0 breaks and felt easy
  pending: PendingLevelUp | null
  mastered: boolean
  found: TechniqueId[]        // technique cards revealed so far, in order found
  startCheck: CheckResult | null
  retest: CheckResult | null
  history: LevelChange[]      // newest last, capped at HISTORY_MAX
  sessions: number            // module sessions logged
}

export interface TechniqueProgress {
  modules: Partial<Record<TechniqueModuleId, ModuleProgress>>
  updatedAt: number
}

export const HISTORY_MAX = 20

export const EMPTY_PROGRESS: TechniqueProgress = { modules: {}, updatedAt: 0 }

export function freshModuleProgress(): ModuleProgress {
  return {
    level: 1, colourStep: 0, streak: 0, easyRun: true, pending: null, mastered: false,
    found: [], startCheck: null, retest: null, history: [], sessions: 0,
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const FEELS: RouteFeel[] = ["hard", "ok", "easy"]
const BY: LevelChangeBy[] = ["coach", "auto", "coach_set"]
const TECHNIQUES: TechniqueId[] = ["smear", "flag", "leg_tension", "pogo"]

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
const int = (v: unknown, min: number, max: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : dflt

function parseRoute(v: any): RouteLog | null {
  if (!v || typeof v !== "object" || !FEELS.includes(v.feel)) return null
  return { breaks: int(v.breaks, 0, MAX_BREAKS_TAP, 0), feel: v.feel }
}

function parseCheck(v: any): CheckResult | null {
  if (!v || typeof v !== "object" || !isDay(v.on)) return null
  const routes = Array.isArray(v.routes) ? v.routes.map(parseRoute).filter((r: RouteLog | null): r is RouteLog => !!r) : []
  return { on: v.on, level: int(v.level, 1, 99, 1), routes }
}

function parseModule(v: any): ModuleProgress {
  const p = freshModuleProgress()
  if (!v || typeof v !== "object") return p
  p.level = int(v.level, 1, 99, 1)
  p.colourStep = int(v.colourStep, 0, 5, 0)
  p.streak = int(v.streak, 0, 99, 0)
  p.easyRun = typeof v.easyRun === "boolean" ? v.easyRun : true
  p.pending = v.pending && isDay(v.pending.since) ? { level: int(v.pending.level, 1, 99, p.level + 1), since: v.pending.since } : null
  p.mastered = v.mastered === true
  p.found = Array.isArray(v.found) ? [...new Set(v.found.filter((t: unknown): t is TechniqueId => TECHNIQUES.includes(t as TechniqueId)))] as TechniqueId[] : []
  p.startCheck = parseCheck(v.startCheck)
  p.retest = parseCheck(v.retest)
  p.history = Array.isArray(v.history)
    ? v.history
      .filter((h: any) => h && isDay(h.on) && BY.includes(h.by))
      .map((h: any) => ({ level: int(h.level, 1, 99, 1), on: h.on, by: h.by }))
      .slice(-HISTORY_MAX)
    : []
  p.sessions = int(v.sessions, 0, 9999, 0)
  return p
}

// Junk, null or a bad JSON string → EMPTY_PROGRESS. Unknown module ids dropped.
export function parseTechniqueProgress(raw: unknown): TechniqueProgress {
  let v: any = raw
  if (typeof raw === "string") {
    try { v = JSON.parse(raw) } catch { return EMPTY_PROGRESS }
  }
  if (!v || typeof v !== "object" || !v.modules || typeof v.modules !== "object") return EMPTY_PROGRESS
  const modules: TechniqueProgress["modules"] = {}
  for (const [id, m] of Object.entries(v.modules)) {
    if (isTechniqueModuleId(id)) modules[id] = parseModule(m)
  }
  return { modules, updatedAt: Number.isFinite(v.updatedAt) ? v.updatedAt : 0 }
}

export function serializeTechniqueProgress(p: TechniqueProgress): string {
  return JSON.stringify(p)
}

// The newer of two copies (phone vs server). Ties keep `a`.
export function newerProgress(a: TechniqueProgress, b: TechniqueProgress): TechniqueProgress {
  return b.updatedAt > a.updatedAt ? b : a
}

export function getModuleProgress(all: TechniqueProgress, id: TechniqueModuleId): ModuleProgress {
  return all.modules[id] ?? freshModuleProgress()
}

export function withModuleProgress(all: TechniqueProgress, id: TechniqueModuleId, p: ModuleProgress, now: number): TechniqueProgress {
  return { modules: { ...all.modules, [id]: p }, updatedAt: now }
}

// ─── Before a session ─────────────────────────────────────────────────────────

function pushHistory(history: LevelChange[], change: LevelChange): LevelChange[] {
  return [...history, change].slice(-HISTORY_MAX)
}

function atLevel(p: ModuleProgress, module: TechniqueModule, level: number, on: string, by: LevelChangeBy): ModuleProgress {
  const l = Math.max(1, Math.min(module.levels.length, Math.round(level)))
  return {
    ...p, level: l, colourStep: 0, streak: 0, easyRun: true, pending: null, mastered: false,
    history: pushHistory(p.history, { level: l, on, by }),
  }
}

// Call when a module session starts. A level up the coach hasn't answered
// since an earlier day unlocks now. Same object back when nothing changes.
export function atSessionStart(p: ModuleProgress, module: TechniqueModule, today: string): ModuleProgress {
  if (!p.pending || p.pending.since >= today) return p
  return atLevel(p, module, p.pending.level, today, "auto")
}

export type ModuleSessionKind = "start_check" | "level" | "retest"

// Which session this is: the very first one is the start check; the first
// session in the plan's last week (finalWeek) is the retest, once.
export function sessionKind(p: ModuleProgress, opts: { finalWeek: boolean }): ModuleSessionKind {
  if (!p.startCheck) return "start_check"
  if (opts.finalWeek && !p.retest) return "retest"
  return "level"
}

// The level rule a session uses: the start check is always Level 1.
export function sessionLevel(p: ModuleProgress, kind: ModuleSessionKind): number {
  return kind === "start_check" ? 1 : p.level
}

// Route colour: one below flash (orange floor), plus the athlete's colour
// step. No flash level → orange, plus the step.
export function routeColour(flash: string | null | undefined, colourStep: number): string {
  const base = flash ? shiftColour(flash, -1) : "orange"
  return shiftColour(base, Math.max(0, colourStep))
}

// ─── After a session ──────────────────────────────────────────────────────────

export function routePasses(module: TechniqueModule, r: RouteLog): boolean {
  return r.breaks <= module.passRule.maxBreaks && module.passRule.passFeels.includes(r.feel)
}

const tooEasy = (r: RouteLog) => r.breaks === 0 && r.feel === "easy"

// Applies a session's routes, in the order climbed. Routes after a level up
// is earned (or the module is mastered) don't count. A start check or retest
// also saves its routes as that check's result.
export function logSession(
  p: ModuleProgress,
  module: TechniqueModule,
  routes: RouteLog[],
  today: string,
  kind: ModuleSessionKind = "level",
): ModuleProgress {
  const rule = module.passRule
  let next: ModuleProgress = { ...p, sessions: p.sessions + 1 }
  const check: CheckResult = { on: today, level: sessionLevel(p, kind), routes }
  if (kind === "start_check") next.startCheck = check
  if (kind === "retest") next.retest = check

  for (const r of routes) {
    if (next.pending || next.mastered) break
    if (!routePasses(module, r)) {
      next = { ...next, streak: 0, easyRun: true }
      continue
    }
    const streak = next.streak + 1
    const easyRun = (next.streak === 0 ? true : next.easyRun) && tooEasy(r)
    next = { ...next, streak, easyRun }
    if (streak < rule.routesInARow) continue

    if (easyRun && next.colourStep < rule.maxColourStep) {
      next = { ...next, colourStep: next.colourStep + 1, streak: 0, easyRun: true }
    } else if (next.level < module.levels.length) {
      next = { ...next, pending: { level: next.level + 1, since: today }, streak: 0, easyRun: true }
    } else {
      next = { ...next, mastered: true, streak: 0, easyRun: true }
    }
  }
  return next
}

// ─── The coach ────────────────────────────────────────────────────────────────

export function confirmLevelUp(p: ModuleProgress, module: TechniqueModule, today: string): ModuleProgress {
  return p.pending ? atLevel(p, module, p.pending.level, today, "coach") : p
}

// Hold: they stay at this level and have to earn it again.
export function holdLevelUp(p: ModuleProgress): ModuleProgress {
  return p.pending ? { ...p, pending: null, streak: 0, easyRun: true } : p
}

// The coach sets a level by hand (up or back). Clears any pending level up.
export function setLevel(p: ModuleProgress, module: TechniqueModule, level: number, today: string): ModuleProgress {
  return atLevel(p, module, level, today, "coach_set")
}

// ─── Identify ─────────────────────────────────────────────────────────────────

// The technique cards the athlete's chip answers point to (at most the
// question's maxPicks, unknown chips ignored), which of them are new, and the
// updated found list.
export function revealFor(
  module: TechniqueModule,
  chipIds: string[],
  found: TechniqueId[],
): { cards: TechniqueId[]; fresh: TechniqueId[]; found: TechniqueId[] } {
  const picks = [...new Set(chipIds)].slice(0, module.reflection.maxPicks)
  const cards: TechniqueId[] = []
  for (const id of picks) {
    const t = module.reflection.chips.find((c) => c.id === id)?.technique
    if (t && !cards.includes(t)) cards.push(t)
  }
  const fresh = cards.filter((t) => !found.includes(t))
  return { cards, fresh, found: [...found, ...fresh] }
}

// "Footwork · Level 2 of 3" (coach plan card and athlete Plan page).
export function progressLabel(module: TechniqueModule, p: ModuleProgress): string {
  const base = `${module.name} · Level ${p.level} of ${module.levels.length}`
  if (p.mastered) return `${module.name} · All ${module.levels.length} levels done`
  return p.pending ? `${base} · ready for Level ${p.pending.level}` : base
}

export function levelName(module: TechniqueModule, p: ModuleProgress): string {
  return moduleLevel(module, p.level).name
}
