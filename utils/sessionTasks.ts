// Next-session tasks (docs/session-tasks.md, 2026-11-22): at the end of a
// workout the athlete sets up to two tasks — their project, or a movement
// they haven't figured out — each with a number of tries or a time limit.
// Every following workout with climbing in it runs them as their own blocks
// right after the warm-up, until the athlete closes them.
//
// Stored as JSON on users.nextTasks, with a copy on the phone
// (services/sessionTasks.ts). Pure — no React, no Appwrite.

import { isBenchmark } from "@/utils/benchmark"

export type TaskMode = "tries" | "time"

export interface SessionTask {
  id: string
  text: string
  mode: TaskMode
  amount: number   // tries, or minutes
  added: string    // "YYYY-MM-DD"
}

export interface SessionTaskList {
  tasks: SessionTask[]
  updatedAt: number // ms; the newer copy (phone or server) wins
}

export const MAX_TASKS = 2
export const MAX_TEXT = 80
export const TRIES_RANGE = { min: 1, max: 20, start: 5 }
export const TIME_RANGE = { min: 5, max: 60, start: 10 }
export const TASK_REST_S = 180

export const EMPTY_TASKS: SessionTaskList = { tasks: [], updatedAt: 0 }

const range = (mode: TaskMode) => (mode === "time" ? TIME_RANGE : TRIES_RANGE)

export function clampAmount(mode: TaskMode, amount: unknown): number {
  const r = range(mode)
  const n = typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount) : r.start
  return Math.min(r.max, Math.max(r.min, n))
}

// Anything (JSON string, object, junk, a PR #101 "For next time" list) → a
// clean list. Never throws.
export function parseSessionTasks(raw: unknown): SessionTaskList {
  let v: any = raw
  if (typeof v === "string") {
    try { v = JSON.parse(v) } catch { return EMPTY_TASKS }
  }
  if (!v || typeof v !== "object" || !Array.isArray(v.tasks)) return EMPTY_TASKS
  const tasks: SessionTask[] = []
  for (const t of v.tasks) {
    if (!t || typeof t.id !== "string" || typeof t.text !== "string") continue
    const text = t.text.trim().slice(0, MAX_TEXT)
    if (!text) continue
    // PR #101 lists: unit "min" / "tries" / none, and ticked ones (doneOn) were done.
    if (typeof t.doneOn === "string" && t.doneOn) continue
    const mode: TaskMode = t.mode === "time" || t.unit === "min" ? "time" : "tries"
    tasks.push({
      id: t.id,
      text,
      mode,
      amount: clampAmount(mode, t.amount),
      added: typeof t.added === "string" ? t.added : "",
    })
    if (tasks.length >= MAX_TASKS) break
  }
  return { tasks, updatedAt: Number.isFinite(v.updatedAt) ? v.updatedAt : 0 }
}

export function serializeSessionTasks(list: SessionTaskList): string {
  return JSON.stringify(list)
}

// The newer of two copies (phone vs server). Ties keep `a`.
export function newerList(a: SessionTaskList, b: SessionTaskList): SessionTaskList {
  return b.updatedAt > a.updatedAt ? b : a
}

// "5 tries", "1 try", "10 min".
export function amountLabel(t: Pick<SessionTask, "mode" | "amount">): string {
  if (t.mode === "time") return `${t.amount} min`
  return `${t.amount} ${t.amount === 1 ? "try" : "tries"}`
}

export function canAdd(list: SessionTaskList): boolean {
  return list.tasks.length < MAX_TASKS
}

// Unchanged list when it's full or the text is empty.
export function addTask(
  list: SessionTaskList,
  task: { text: string; mode: TaskMode; amount: number },
  id: string,
  today: string,
  now: number,
): SessionTaskList {
  const text = task.text.trim().slice(0, MAX_TEXT)
  if (!text || !canAdd(list)) return list
  return {
    tasks: [...list.tasks, { id, text, mode: task.mode, amount: clampAmount(task.mode, task.amount), added: today }],
    updatedAt: now,
  }
}

export function removeTasks(list: SessionTaskList, ids: Iterable<string>, now: number): SessionTaskList {
  const drop = new Set(ids)
  if (!list.tasks.some((t) => drop.has(t.id))) return list
  return { tasks: list.tasks.filter((t) => !drop.has(t.id)), updatedAt: now }
}

// ─── In the workout ───────────────────────────────────────────────────────────

// What a task block carries (block.focusTask). `closed`: the athlete chose
// "Close it" at the end of the block — applied when the workout is saved.
export interface FocusTaskNote {
  id: string
  text: string
  mode: TaskMode
  amount: number
  closed?: boolean
}

export function isTaskBlock(b: any): boolean {
  return typeof b?.focusTask?.id === "string"
}

// A task as a Project bouldering block (components/ProjectBoulderingBlock.tsx
// runs it in task mode): no grade (the athlete may be working a movement), no
// review-clip prompt, the time limit only in time mode.
export function taskBlock(task: SessionTask): any {
  const focusTask: FocusTaskNote = { id: task.id, text: task.text, mode: task.mode, amount: task.amount }
  return {
    id: `task-${task.id}`,
    type: "project_bouldering",
    blockName: task.text,
    description: "",
    grade: "",
    restTime: TASK_REST_S,
    reviewPrompts: false,
    ...(task.mode === "time" ? { timeLimit: task.amount } : {}),
    focusTask,
  }
}

// Block types you climb in. A workout with none of them (S&C, cardio, a
// stretching break) gets no task blocks — nobody can try a boulder there.
const CLIMBING_TYPES = new Set([
  "constraint_warmup", "project_bouldering", "four_by_four", "sequence", "exploration_session", "route_exploration",
])

// Does a workout started from this row get the task blocks? Plan workouts,
// the athlete's own and extra solo sessions — with climbing in them. Not the
// coach's homework, "Leave as homework" leftovers, plan S&C split-offs or
// the plan's Benchmark (an extra block would stop it counting as one).
export function tasksAllowedFor(row: { planPart?: string | null; blocks?: string | null }): boolean {
  if (row.planPart === "sc") return false
  let blocks: any[] = []
  try {
    const parsed = JSON.parse(row.blocks ?? "[]")
    if (Array.isArray(parsed)) blocks = parsed
  } catch { return false }
  if (blocks.some((b) => b?.leftAsHomework?.on) || isBenchmark(blocks)) return false
  if (row.planPart === "homework" && !blocks.some((b) => b?.extraSession?.to)) return false
  return blocks.some((b) => CLIMBING_TYPES.has(b?.type) && !isTaskBlock(b))
}

// Where the task blocks go: right after the warm-up run at the start (the
// last constraint warm-up before the first other climbing block), else before
// the first climbing block, else at the end.
export function taskInsertIndex(blocks: any[]): number {
  let afterWarmup = -1
  for (let i = 0; i < blocks.length; i++) {
    const type = blocks[i]?.type
    if (type === "constraint_warmup") afterWarmup = i + 1
    else if (CLIMBING_TYPES.has(type)) return afterWarmup >= 0 ? afterWarmup : i
  }
  return afterWarmup >= 0 ? afterWarmup : blocks.length
}

// The workout with a block per open task. Unchanged when there are none, or
// when it already has task blocks (never added twice).
export function withTaskBlocks(blocks: any[], list: SessionTaskList): any[] {
  if (list.tasks.length === 0 || blocks.some(isTaskBlock)) return blocks
  const at = taskInsertIndex(blocks)
  return [...blocks.slice(0, at), ...list.tasks.map(taskBlock), ...blocks.slice(at)]
}

// The tasks closed in a saved workout: task blocks marked closed that weren't
// skipped ("Not today").
export function closedTaskIds(blocks: any[], skipped: Set<number>): string[] {
  const ids: string[] = []
  blocks.forEach((b, i) => {
    if (isTaskBlock(b) && b.focusTask.closed && !skipped.has(i)) ids.push(b.focusTask.id)
  })
  return ids
}

// Task mode, tries: the block is over once this many tries are logged.
export function triesLeft(note: FocusTaskNote | null | undefined, logged: number): number | null {
  if (!note || note.mode !== "tries") return null
  return Math.max(0, note.amount - logged)
}
