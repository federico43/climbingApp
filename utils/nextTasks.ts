// "For next time" (2026-11-13): at the end of a workout the athlete writes
// down what to do next session — homework the coach gave them, or their own
// ("Try the crux of the blue project, 5 tries", "3 min of dead hangs"). The
// next workout shows them as a checklist at the start, and they can reopen it
// at any point mid-workout to tick things off. Ticked tasks go when that
// workout ends; the rest carry over.
//
// Separate from the coach's homework workouts (utils/homework.ts): these are
// free-text notes, not blocks. Stored as JSON on users.nextTasks, with a copy
// on the phone (services/nextTasks.ts). Pure — no React, no Appwrite.

export type TaskUnit = "min" | "tries"

export interface NextTask {
  id: string
  text: string
  amount?: number | null   // with `unit`: 5 tries, 3 min
  unit?: TaskUnit | null
  added: string            // "YYYY-MM-DD"
  doneOn?: string | null   // "YYYY-MM-DD" it was ticked, null = still to do
}

export interface NextTaskList {
  tasks: NextTask[]
  updatedAt: number // ms; the newer copy (phone or server) wins
}

export const MAX_TASKS = 12
export const MAX_TEXT = 140
export const MAX_AMOUNT = 999

export const EMPTY_TASKS: NextTaskList = { tasks: [], updatedAt: 0 }

// Anything (JSON string, object, junk) → a clean list. Never throws.
export function parseNextTasks(raw: unknown): NextTaskList {
  let v: any = raw
  if (typeof v === "string") {
    try { v = JSON.parse(v) } catch { return EMPTY_TASKS }
  }
  if (!v || typeof v !== "object" || !Array.isArray(v.tasks)) return EMPTY_TASKS
  const tasks: NextTask[] = []
  for (const t of v.tasks) {
    if (!t || typeof t.id !== "string" || typeof t.text !== "string") continue
    const text = t.text.trim().slice(0, MAX_TEXT)
    if (!text) continue
    const unit: TaskUnit | null = t.unit === "min" || t.unit === "tries" ? t.unit : null
    const amount = unit && Number.isFinite(t.amount) && t.amount > 0 ? Math.min(MAX_AMOUNT, Math.round(t.amount)) : null
    tasks.push({
      id: t.id,
      text,
      amount,
      unit: amount ? unit : null,
      added: typeof t.added === "string" ? t.added : "",
      doneOn: typeof t.doneOn === "string" ? t.doneOn : null,
    })
    if (tasks.length >= MAX_TASKS) break
  }
  return { tasks, updatedAt: Number.isFinite(v.updatedAt) ? v.updatedAt : 0 }
}

export function serializeNextTasks(list: NextTaskList): string {
  return JSON.stringify(list)
}

// The newer of two copies (phone vs server). Ties keep `a`.
export function newerList(a: NextTaskList, b: NextTaskList): NextTaskList {
  return b.updatedAt > a.updatedAt ? b : a
}

// "5 tries", "1 try", "3 min" — null when there's no amount.
export function amountLabel(t: Pick<NextTask, "amount" | "unit">): string | null {
  if (!t.amount || !t.unit) return null
  if (t.unit === "min") return `${t.amount} min`
  return `${t.amount} ${t.amount === 1 ? "try" : "tries"}`
}

export function addTask(
  list: NextTaskList,
  task: { text: string; amount?: number | null; unit?: TaskUnit | null },
  id: string,
  today: string,
  now: number,
): NextTaskList {
  const text = task.text.trim().slice(0, MAX_TEXT)
  if (!text || list.tasks.length >= MAX_TASKS) return list
  const unit = task.unit ?? null
  const amount = unit && task.amount && task.amount > 0 ? Math.min(MAX_AMOUNT, Math.round(task.amount)) : null
  return {
    tasks: [...list.tasks, { id, text, amount, unit: amount ? unit : null, added: today, doneOn: null }],
    updatedAt: now,
  }
}

export function removeTask(list: NextTaskList, id: string, now: number): NextTaskList {
  return { tasks: list.tasks.filter((t) => t.id !== id), updatedAt: now }
}

// Tick / untick.
export function toggleTask(list: NextTaskList, id: string, today: string, now: number): NextTaskList {
  return {
    tasks: list.tasks.map((t) => (t.id === id ? { ...t, doneOn: t.doneOn ? null : today } : t)),
    updatedAt: now,
  }
}

// When a workout ends: the ticked tasks are done and go; the rest carry over.
// Returns the same list when nothing was ticked.
export function dropDone(list: NextTaskList, now: number): NextTaskList {
  if (!list.tasks.some((t) => t.doneOn)) return list
  return { tasks: list.tasks.filter((t) => !t.doneOn), updatedAt: now }
}

// On load: tasks ticked on an earlier day (in a workout that was then
// cancelled, so dropDone never ran) count as done.
export function dropStaleDone(list: NextTaskList, today: string): NextTaskList {
  if (!list.tasks.some((t) => t.doneOn && t.doneOn < today)) return list
  return { tasks: list.tasks.filter((t) => !t.doneOn || t.doneOn >= today), updatedAt: list.updatedAt }
}

export function doneCount(list: NextTaskList): number {
  return list.tasks.filter((t) => t.doneOn).length
}

// Should the "For today" checklist open by itself? Only when the workout has
// just started (not on a resume after the app was closed) and there's
// something to do.
export const AUTO_OPEN_WINDOW_MS = 60_000
export function shouldAutoOpen(list: NextTaskList, workoutStartTime: number | null, now: number): boolean {
  if (workoutStartTime == null || now - workoutStartTime > AUTO_OPEN_WINDOW_MS) return false
  return list.tasks.some((t) => !t.doneOn)
}
