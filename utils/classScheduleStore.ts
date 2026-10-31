import { useAuth } from "@/components/auth-context"
import * as api from "@/services/classSchedule"
import type { ClassPackage, ClassUser, ClassWeek } from "@/services/classSchedule"
import {
  AddClassProblem, BlockedTime, ClassChange, ClassRequestRow, ExtraClass, GRID_END, GRID_START, GymClass,
  CLASS_HOURS, addClassProblem, athleteView, classDate, classLabel, currentPackage, dateOf, formatTime, mondayOf, packageLocked, sessionsLeft,
  WEEK_DAYS, weekdayOf, ymd,
} from "@/utils/classSchedule"
import { useEffect, useSyncExternalStore } from "react"
import { Alert } from "react-native"

// The class screens' state (athlete week, Plan card, coach planner), loaded
// from Appwrite and shared so they stay in step. Changes go through the
// server (services/classSchedule.ts) and the state is reloaded after each
// one. The coach's plan for next week is a draft on the phone until they
// publish it.

// A time on the week grid.
export interface Slot { day: number; start: number }

// A request as the coach sees it.
export interface ClassRequest {
  key: string        // the request's id
  who: string
  text: string
  weekStart: string
  from?: Slot  // the class they'd leave (none for an extra class)
  to: Slot     // where they want to go: another class or a new time
}

// One week as the athlete sees it (rosters as names, without them).
export interface AthleteWeek {
  weekStart: string
  published: boolean
  classes: GymClass[]
  mine: string[]
  changes: Record<string, ClassChange>
  extra: ExtraClass | null
  blocks: BlockedTime[]
}

// `locked`: used up or past its use-by date; the app is locked until the coach renews.
export interface PackageInfo { total: number; left: number; useBy: string; locked: boolean }

interface State {
  status: "idle" | "loading" | "ready" | "error"
  error: string | null
  busy: boolean
  me: string
  names: Record<string, string>
  athletes: ClassUser[]
  requests: ClassRequestRow[]
  // Athlete
  thisWeek: AthleteWeek            // the Plan card
  shown: AthleteWeek               // the week screen: next week from Saturday once it's published
  shownNext: boolean
  defaults: string[]               // usual classes, "day@start"
  pkg: PackageInfo | null
  // Coach: next week as drafted on the phone
  nextWeekStart: string
  nextClasses: GymClass[]          // rosters as names
  blocks: BlockedTime[]
  published: boolean               // published and nothing changed since
  packages: ClassPackage[]
}

const emptyWeek = (weekStart: string): AthleteWeek => ({
  weekStart, published: false, classes: [], mine: [], changes: {}, extra: null, blocks: [],
})

let state: State = {
  status: "idle", error: null, busy: false, me: "", names: {}, athletes: [], requests: [],
  thisWeek: emptyWeek(""), shown: emptyWeek(""), shownNext: false, defaults: [], pkg: null,
  nextWeekStart: "", nextClasses: [], blocks: [], published: false, packages: [],
}
const listeners = new Set<() => void>()

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const get = () => state

// ── Coach draft ─────────────────────────────────────────────────────────────

interface Draft {
  weekStart: string
  classes: { id: string; day: number; start: number }[]  // server ids, or "new…" for ones not saved yet
  blocks: BlockedTime[]
  dirty: boolean
  removed: Set<string>
}
let draft: Draft | null = null
let nextId = 1
let server: { next: ClassWeek | null } = { next: null }

// Start the draft from next week as saved, or from this week's times (no
// rosters) when next week is still empty. A changed draft keeps the coach's
// edits and picks up classes the server added (an accepted new time).
function syncDraft(thisWeek: ClassWeek, nextWeek: ClassWeek) {
  if (!draft || draft.weekStart !== nextWeek.weekStart || !draft.dirty) {
    const fresh = nextWeek.classes.length || nextWeek.published
    draft = {
      weekStart: nextWeek.weekStart,
      classes: fresh
        ? nextWeek.classes.map(({ id, day, start }) => ({ id, day, start }))
        : thisWeek.classes.map(({ day, start }) => ({ id: `new${nextId++}`, day, start })),
      blocks: fresh ? nextWeek.blocks : thisWeek.blocks.map((b) => ({ ...b })),
      dirty: !fresh && thisWeek.classes.length > 0,
      removed: new Set(),
    }
    return
  }
  for (const c of nextWeek.classes) {
    if (!draft.removed.has(c.id) && !draft.classes.some((d) => d.id === c.id)) draft.classes.push({ id: c.id, day: c.day, start: c.start })
  }
}

function draftPatch(): Partial<State> {
  if (!draft) return {}
  const rosters = new Map((server.next?.classes ?? []).map((c) => [c.id, c.roster]))
  return {
    nextWeekStart: draft.weekStart,
    nextClasses: draft.classes.map((c) => ({ ...c, roster: (rosters.get(c.id) ?? []).map((u) => state.names[u] ?? "athlete") })),
    blocks: draft.blocks,
    published: !!server.next?.published && !draft.dirty,
  }
}

function editDraft(fn: (d: Draft) => void) {
  if (!draft) return
  fn(draft)
  draft.dirty = true
  set(draftPatch())
}

// ── Loading ─────────────────────────────────────────────────────────────────

let who: { me: string; coach: boolean } | null = null
let loading: Promise<void> | null = null

function weekFor(w: ClassWeek, requests: ClassRequestRow[], me: string, names: Record<string, string>): AthleteWeek {
  const view = athleteView(w.classes, requests.filter((r) => r.weekStart === w.weekStart), me, names)
  return { weekStart: w.weekStart, published: w.published, blocks: w.blocks, ...view }
}

// Same count as the server (athletePackage in functions/aiProtocol/src/classes.js):
// classes count from when the package was added.
async function packageInfo(me: string, now: Date): Promise<PackageInfo | null> {
  const today = ymd(now)
  const pkg = currentPackage(await api.loadPackages(me), today)
  if (!pkg) return null
  const since = pkg.$createdAt ? new Date(pkg.$createdAt).getTime() : 0
  const { classes, requests } = await api.loadHistory(me, ymd(mondayOf(dateOf(pkg.startsOn))))
  const done = classes.filter((c) => {
    const at = classDate(c.weekStart, c)
    const end = at.getTime() + CLASS_HOURS * 3600000
    return ymd(at) >= pkg.startsOn && end > since && end <= now.getTime()
  }).length
  const skips = requests.filter((r) =>
    r.kind === "skip" && r.status === "accepted" && (!pkg.$createdAt || (r.$createdAt ?? "") >= pkg.$createdAt)).length
  const left = sessionsLeft(pkg.total, done, skips)
  return { total: pkg.total, left, useBy: pkg.useBy, locked: packageLocked(pkg, left, today) }
}

async function load() {
  if (!who) return
  const { me, coach } = who
  const now = new Date()
  const thisStart = ymd(mondayOf(now))
  const next = mondayOf(now)
  next.setDate(next.getDate() + 7)
  const nextStart = ymd(next)
  if (state.status !== "ready") set({ status: "loading" })
  try {
    const [thisWeek, nextWeek, users, requests] = await Promise.all([
      api.loadWeek(thisStart),
      api.loadWeek(nextStart),
      api.loadUsers(),
      api.loadRequests([thisStart, nextStart], coach ? undefined : me),
    ])
    const names = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const meRow = users.find((u) => u.id === me)
    const [pkg, packages] = await Promise.all([
      coach ? Promise.resolve(null) : packageInfo(me, now),
      coach ? api.loadPackages() : Promise.resolve([]),
    ])
    server = { next: nextWeek }
    if (coach) syncDraft(thisWeek, nextWeek)
    const shownNext = weekdayOf(now) >= 5 && nextWeek.published
    const thisView = weekFor(thisWeek, requests, me, names)
    set({
      status: "ready", error: null, me, names, requests, pkg, packages,
      athletes: users.filter((u) => u.role !== "coach"),
      defaults: meRow?.defaultClasses ?? [],
      thisWeek: thisView,
      shown: shownNext ? weekFor(nextWeek, requests, me, names) : thisView,
      shownNext,
    })
    set(draftPatch())
  } catch (e: any) {
    console.log("Class schedule load failed", e)
    set({ status: "error", error: e?.message ?? "Couldn't load the classes." })
  }
}

export function refreshClassSchedule(): Promise<void> {
  loading ??= load().finally(() => { loading = null })
  return loading
}

export function useClassSchedule(): State {
  const { User, role } = useAuth()
  const me = User?.$id ?? ""
  useEffect(() => {
    if (!me) return
    const coach = role === "coach"
    if (who?.me === me && who.coach === coach) return
    who = { me, coach }
    draft = null
    refreshClassSchedule()
  }, [me, role])
  return useSyncExternalStore(subscribe, get, get)
}

// Run a server change, then reload. Returns false (after telling the user) if it failed.
async function run(fn: () => Promise<unknown>): Promise<boolean> {
  set({ busy: true })
  try {
    await fn()
    return true
  } catch (e: any) {
    Alert.alert("Couldn't save", e?.message ?? "Try again.")
    return false
  } finally {
    await refreshClassSchedule()
    set({ busy: false })
  }
}

// ── Athlete ─────────────────────────────────────────────────────────────────

const myRequests = () => state.requests.filter((r) => r.athleteId === state.me)

// A change to one of the athlete's classes, or null to take it back.
export function changeClass(id: string, change: ClassChange | null): Promise<boolean> {
  if (!change) {
    const r = myRequests().find((x) => x.fromClassId === id && (x.status === "pending" || x.kind === "skip"))
    return r ? run(() => api.cancelRequest(r.$id)) : Promise.resolve(true)
  }
  return run(() => api.sendRequest(
    change.status === "skip" ? { kind: "skip", classId: id }
    : change.status === "move" ? { kind: "move", classId: id, toClassId: change.to }
    : { kind: "propose", classId: id, day: change.day, start: change.start },
  ))
}

export function requestExtra(to: string): Promise<boolean> {
  return run(() => api.sendRequest({ kind: "extra", toClassId: to }))
}

export function cancelExtra(): Promise<boolean> {
  const r = myRequests().find((x) => x.kind === "extra" && x.status === "pending")
  return r ? run(() => api.cancelRequest(r.$id)) : Promise.resolve(true)
}

export function saveUsualClasses(slots: string[]): Promise<boolean> {
  return run(() => api.saveDefaults(slots))
}

// ── Coach ───────────────────────────────────────────────────────────────────

// Requests waiting for the coach, both weeks.
export function pendingRequests(s: State): ClassRequest[] {
  const all = [...s.thisWeek.classes, ...(server.next?.classes ?? [])]
  const byId = (id?: string | null) => all.find((c) => c.id === id)
  const out: ClassRequest[] = []
  for (const r of s.requests) {
    if (r.status !== "pending") continue
    const from = byId(r.fromClassId)
    const to = r.kind === "propose" && r.day != null && r.start != null ? { day: r.day, start: r.start } : byId(r.toClassId)
    if (!to || (r.kind !== "extra" && !from)) continue
    const week = r.weekStart === s.thisWeek.weekStart ? " (this week)" : ""
    const text =
      r.kind === "extra" ? `Extra class: ${classLabel(to)}`
      : r.kind === "propose" ? `${classLabel(from!)} → new time: ${WEEK_DAYS[to.day]} ${formatTime(to.start)}`
      : `${classLabel(from!)} → ${classLabel(to)}`
    out.push({ key: r.$id, who: s.names[r.athleteId] ?? "athlete", text: text + week, weekStart: r.weekStart, from, to })
  }
  return out
}

export function answerRequest(req: ClassRequest, accept: boolean): Promise<boolean> {
  return run(() => api.answerRequest(req.key, accept))
}

export function addNextClass(day: number, start: number) {
  editDraft((d) => { d.classes.push({ id: `new${nextId++}`, day, start }) })
}

// Drag a class or a blocked time to another day or time. Returns why it
// can't go there, or null once it's moved.
export function moveNextClass(id: string, day: number, start: number): AddClassProblem | null {
  const others = state.nextClasses.filter((c) => c.id !== id)
  const problem = addClassProblem(others, state.blocks, day, start)
  if (problem) return problem
  editDraft((d) => { d.classes = d.classes.map((c) => (c.id === id ? { ...c, day, start } : c)) })
  return null
}

const coversClass = (day: number, start: number, end: number) =>
  state.nextClasses.some((c) => c.day === day && c.start < end && start < c.start + CLASS_HOURS)

export function moveBlock(block: BlockedTime, day: number, start: number): "class" | "blocked" | null {
  const end = start + (block.end - block.start)
  const others = state.blocks.filter((b) => b !== block)
  if (coversClass(day, start, end)) return "class"
  if (others.some((b) => b.day === day && b.all)) return "blocked"
  editDraft((d) => { d.blocks = [...others, { day, start, end }] })
  return null
}

// Make a blocked time longer or shorter. Returns "class" when it would cover one.
export function resizeBlock(block: BlockedTime, start: number, end: number): "class" | null {
  if (coversClass(block.day, start, end)) return "class"
  editDraft((d) => { d.blocks = d.blocks.map((b) => (b === block ? { ...b, start, end } : b)) })
  return null
}

export function removeNextClass(id: string) {
  editDraft((d) => {
    d.classes = d.classes.filter((c) => c.id !== id)
    d.removed.add(id)
  })
}

export function blockTime(day: number, start: number) {
  const end = Math.min(start + CLASS_HOURS, GRID_END)
  editDraft((d) => { d.blocks = [...d.blocks, { day, start, end }] })
}

export function blockDay(day: number) {
  editDraft((d) => { d.blocks = [...d.blocks, { day, start: GRID_START, end: GRID_END, all: true }] })
}

export function unblock(block: BlockedTime) {
  editDraft((d) => { d.blocks = d.blocks.filter((b) => b !== block) })
}

export function unblockDay(day: number) {
  editDraft((d) => { d.blocks = d.blocks.filter((b) => !(b.day === day && b.all)) })
}

export async function publishWeek(): Promise<boolean> {
  const d = draft
  if (!d) return false
  const classes = d.classes.map((c) => (c.id.startsWith("new") ? { day: c.day, start: c.start } : c))
  const saved = await run(async () => {
    await api.publishWeek(d.weekStart, classes, d.blocks)
    d.dirty = false
    draft = null
  })
  return saved
}

export function addAthletePackage(athleteId: string, total: number, startsOn: string, useBy: string): Promise<boolean> {
  return run(() => api.addPackage(athleteId, total, startsOn, useBy))
}
