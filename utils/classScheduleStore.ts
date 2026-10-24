import { useSyncExternalStore } from "react"
import {
  AddClassProblem, BlockedTime, ClassChange, addClassProblem, EXAMPLE_CLASSES, EXAMPLE_MINE, ExtraClass, GRID_END, GRID_START, GymClass,
  CLASS_HOURS, classLabel, formatTime, WEEK_DAYS,
} from "@/utils/classSchedule"

// In-memory state for the class screens (athlete week, coach planner), shared
// so the Plan card and the week stay in step. UI only: starts from example
// data and resets when the app restarts.

export interface ClassRequest {
  key: string
  who: string
  text: string
}

interface State {
  classes: GymClass[]                    // this week
  mine: string[]                         // the athlete's default classes
  changes: Record<string, ClassChange>   // this week's changes, by class id
  extra: ExtraClass | null
  sessionsLeft: number
  sessionsTotal: number
  useBy: string
  nextClasses: GymClass[]                // next week, as the coach plans it
  blocks: BlockedTime[]                  // next week's times the coach can't teach
  published: boolean
  othersRequests: ClassRequest[]         // other athletes' requests (example)
}

let state: State = {
  classes: EXAMPLE_CLASSES,
  mine: EXAMPLE_MINE,
  changes: {},
  extra: null,
  sessionsLeft: 6,
  sessionsTotal: 8,
  useBy: "Nov 30",
  nextClasses: EXAMPLE_CLASSES.map((c) => ({ ...c, id: `n${c.id}` })),
  blocks: [{ day: 4, start: 12.5, end: GRID_END }],
  published: false,
  othersRequests: [{ key: "sofi_k", who: "sofi_k", text: "New time: Wed 12:30" }],
}
const listeners = new Set<() => void>()
let nextId = 1

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const get = () => state

export function useClassSchedule(): State {
  return useSyncExternalStore(subscribe, get, get)
}

// ── Athlete ─────────────────────────────────────────────────────────────────

export function changeClass(id: string, change: ClassChange | null) {
  const changes = { ...state.changes }
  if (change) changes[id] = change
  else delete changes[id]
  set({ changes })
}

export function requestExtra(to: string) {
  set({ extra: { to, approved: false } })
}

export function cancelExtra() {
  set({ extra: null })
}

// Requests waiting for the coach: the athlete's own, then the others'.
export function pendingRequests(s: State, me: string): ClassRequest[] {
  const byId = (id: string) => s.classes.find((c) => c.id === id)
  const out: ClassRequest[] = []
  for (const [id, ch] of Object.entries(s.changes)) {
    const from = byId(id)
    if (!from) continue
    if (ch.status === "move") {
      const to = byId(ch.to)
      if (to) out.push({ key: id, who: me, text: `${classLabel(from)} → ${classLabel(to)}` })
    }
    if (ch.status === "propose") {
      out.push({ key: id, who: me, text: `New time: ${WEEK_DAYS[ch.day]} ${formatTime(ch.start)}` })
    }
  }
  if (s.extra && !s.extra.approved) {
    const to = byId(s.extra.to)
    if (to) out.push({ key: "extra", who: me, text: `Extra class: ${classLabel(to)}` })
  }
  return [...out, ...s.othersRequests]
}

// ── Coach ───────────────────────────────────────────────────────────────────

export function answerRequest(key: string, accept: boolean) {
  if (state.othersRequests.some((r) => r.key === key)) {
    set({ othersRequests: state.othersRequests.filter((r) => r.key !== key) })
    return
  }
  if (key === "extra") {
    set({ extra: accept && state.extra ? { ...state.extra, approved: true } : null })
    return
  }
  const ch = state.changes[key]
  const changes = { ...state.changes }
  delete changes[key]
  if (!accept || !ch || ch.status === "skip") return set({ changes })
  let to = ch.status === "move" ? ch.to : ""
  let classes = state.classes
  if (ch.status === "propose") {
    to = `new${nextId++}`
    classes = [...classes, { id: to, day: ch.day, start: ch.start, roster: [] }]
  }
  set({ changes, classes, mine: state.mine.map((m) => (m === key ? to : m)) })
}

export function addNextClass(day: number, start: number) {
  set({ nextClasses: [...state.nextClasses, { id: `new${nextId++}`, day, start, roster: [] }], published: false })
}

// Drag a class or a blocked time to another day or time. Returns why it
// can't go there, or null once it's moved.
export function moveNextClass(id: string, day: number, start: number): AddClassProblem | null {
  const others = state.nextClasses.filter((c) => c.id !== id)
  const problem = addClassProblem(others, state.blocks, day, start)
  if (problem) return problem
  set({ nextClasses: state.nextClasses.map((c) => (c.id === id ? { ...c, day, start } : c)), published: false })
  return null
}

export function moveBlock(block: BlockedTime, day: number, start: number): "class" | "blocked" | null {
  const end = start + (block.end - block.start)
  const others = state.blocks.filter((b) => b !== block)
  if (state.nextClasses.some((c) => c.day === day && c.start < end && start < c.start + CLASS_HOURS)) return "class"
  if (others.some((b) => b.day === day && b.all)) return "blocked"
  set({ blocks: [...others, { day, start, end }], published: false })
  return null
}

export function removeNextClass(id: string) {
  set({ nextClasses: state.nextClasses.filter((c) => c.id !== id), published: false })
}

export function blockTime(day: number, start: number) {
  const end = Math.min(start + CLASS_HOURS, GRID_END)
  set({ blocks: [...state.blocks, { day, start, end }], published: false })
}

export function blockDay(day: number) {
  set({ blocks: [...state.blocks, { day, start: GRID_START, end: GRID_END, all: true }], published: false })
}

export function unblock(block: BlockedTime) {
  set({ blocks: state.blocks.filter((b) => b !== block), published: false })
}

export function unblockDay(day: number) {
  set({ blocks: state.blocks.filter((b) => !(b.day === day && b.all)), published: false })
}

export function publishWeek() {
  set({ published: true })
}
