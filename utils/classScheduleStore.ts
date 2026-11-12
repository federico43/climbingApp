import { useAuth } from "@/components/auth-context"
import * as api from "@/services/classSchedule"
import type { ClassPackage, ClassUser, ClassWeek } from "@/services/classSchedule"
import {
  AddClassProblem, BlockedTime, ClassChange, ClassRequestRow, ExtraClass, GRID_END, GRID_START, GymClass,
  CLASS_HOURS, addClassProblem, athleteView, classDate, classLabel, currentPackage, packageUsage, dateOf, formatTime, mondayOf, packageLocked, sessionsLeft,
  CHANGE_DEADLINE_H, WEEK_DAYS, slotKey, usualFits, weekdayOf, ymd,
} from "@/utils/classSchedule"
import { useEffect, useSyncExternalStore } from "react"
import { Alert } from "react-native"

// The class screens' state (athlete week, Plan card, coach planner), loaded
// from Appwrite and shared so they stay in step. Changes go through the
// server (services/classSchedule.ts) and the state is reloaded after each
// one. The coach's plan for a week is a draft on the phone until they
// publish it: next week, and this week too, published or not (a coach who
// missed Sunday can still publish it, and can add times mid-week). Classes
// already started stay as they are.

// A time on the week grid.
export interface Slot { day: number; start: number }

// A request as the coach sees it.
export interface ClassRequest {
  key: string        // the request's id
  who: string
  text: string
  weekStart: string
  kind: ClassRequestRow["kind"]
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
  nextWeek: AthleteWeek | null     // next week once it's published
  defaults: string[]               // usual classes, "day@start"
  pkg: PackageInfo | null
  // Coach: the week being planned (next week, or this week while it's
  // unpublished; see planWeek) as drafted on the phone
  planning: "this" | "next"
  thisOpen: boolean                // the coach can plan this week (always, for coaches)
  nextWeekStart: string
  nextClasses: GymClass[]          // rosters as names, and as user ids in `ids`
  blocks: BlockedTime[]
  published: boolean               // published and nothing changed since
  packages: ClassPackage[]
  series: Slot[]                     // coach: classes that repeat every week (pre-fill)
  left: Record<string, PackageInfo>  // coach: sessions left per athlete with a package
}

const emptyWeek = (weekStart: string): AthleteWeek => ({
  weekStart, published: false, classes: [], mine: [], changes: {}, extra: null, blocks: [],
})

let state: State = {
  status: "idle", error: null, busy: false, me: "", names: {}, athletes: [], requests: [],
  thisWeek: emptyWeek(""), shown: emptyWeek(""), shownNext: false, nextWeek: null, defaults: [], pkg: null,
  planning: "next", thisOpen: false, nextWeekStart: "", nextClasses: [], blocks: [], published: false, packages: [], left: {}, series: [],
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
// One draft per week, so switching tabs keeps the edits.
let drafts: Record<string, Draft> = {}
let nextId = 1
let server: { this: ClassWeek | null; next: ClassWeek | null } = { this: null, next: null }

// A class (or new time) this week that has already started.
const started = (weekStart: string, c: Slot, now = new Date()) => classDate(weekStart, c).getTime() <= now.getTime()

// Start a week's draft from the week as saved, or, when it's still empty,
// from the coach's recurring series (or else the seed week's times, no
// rosters), leaving out times already gone. A
// changed draft keeps the coach's edits and picks up classes the server added
// (an accepted new time).
function syncDraft(week: ClassWeek, seed: ClassWeek | null) {
  const draft = drafts[week.weekStart]
  if (!draft || !draft.dirty) {
    const fresh = week.classes.length || week.published
    const from: Slot[] = state.series.length ? state.series : seed?.classes ?? []
    const seeded = from.filter((c) => !started(week.weekStart, c))
    drafts[week.weekStart] = {
      weekStart: week.weekStart,
      classes: fresh
        ? week.classes.map(({ id, day, start }) => ({ id, day, start }))
        : seeded.map(({ day, start }) => ({ id: `new${nextId++}`, day, start })),
      blocks: fresh ? week.blocks : (seed?.blocks ?? []).map((b) => ({ ...b })),
      dirty: !fresh && seeded.length > 0,
      removed: new Set(),
    }
    return
  }
  for (const c of week.classes) {
    if (!draft.removed.has(c.id) && !draft.classes.some((d) => d.id === c.id)) draft.classes.push({ id: c.id, day: c.day, start: c.start })
  }
}

const planned = () => (state.planning === "this" && state.thisOpen ? server.this : server.next)
const currentDraft = (): Draft | null => {
  const w = planned()
  return w ? drafts[w.weekStart] ?? null : null
}

function draftPatch(): Partial<State> {
  const draft = currentDraft()
  if (!draft) return {}
  const week = planned()
  const rosters = new Map((week?.classes ?? []).map((c) => [c.id, c.roster]))
  return {
    nextWeekStart: draft.weekStart,
    nextClasses: draft.classes.map((c) => ({
      ...c,
      roster: (rosters.get(c.id) ?? []).map((u) => state.names[u] ?? "athlete"),
      ids: rosters.get(c.id) ?? [],
    })),
    blocks: draft.blocks,
    published: !!week?.published && !draft.dirty,
  }
}

function editDraft(fn: (d: Draft) => void) {
  const draft = currentDraft()
  if (!draft) return
  fn(draft)
  draft.dirty = true
  set(draftPatch())
}

// Which week the coach's planner edits.
export function planWeek(which: "this" | "next") {
  set({ planning: which })
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
  const pkg = currentPackage(await api.loadPackages(me), ymd(now))
  if (!pkg) return null
  const { classes, requests } = await api.loadHistory(me, ymd(mondayOf(dateOf(pkg.startsOn))))
  return packageUsage(pkg, classes, requests, now)
}

// Coach: every athlete's sessions left, in two reads (all classes and
// requests since the oldest current package's week).
async function allPackageInfo(packages: ClassPackage[], athleteIds: string[], now: Date): Promise<Record<string, PackageInfo>> {
  const today = ymd(now)
  const current = athleteIds
    .map((id) => [id, currentPackage(packages.filter((p) => p.athleteId === id), today)] as const)
    .filter((x): x is readonly [string, ClassPackage] => !!x[1])
  if (!current.length) return {}
  const from = current.map(([, p]) => ymd(mondayOf(dateOf(p.startsOn)))).sort()[0]
  const { classes, requests } = await api.loadAllHistory(from)
  const out: Record<string, PackageInfo> = {}
  for (const [id, p] of current) {
    const weekFrom = ymd(mondayOf(dateOf(p.startsOn)))
    out[id] = packageUsage(
      p,
      classes.filter((c) => c.weekStart >= weekFrom && c.roster.includes(id)),
      requests.filter((r) => r.athleteId === id && r.weekStart >= weekFrom),
      now,
    )
  }
  return out
}

async function load() {
  if (!who) return
  const { me, coach } = who
  const now = new Date()
  const thisStart = ymd(mondayOf(now))
  const next = mondayOf(now)
  next.setDate(next.getDate() + 7)
  const nextStart = ymd(next)
  const last = mondayOf(now)
  last.setDate(last.getDate() - 7)
  if (state.status !== "ready") set({ status: "loading" })
  try {
    const [thisWeek, nextWeek, lastWeek, users, requests] = await Promise.all([
      api.loadWeek(thisStart),
      api.loadWeek(nextStart),
      // Seeds this week's plan when the coach didn't publish it in time.
      coach ? api.loadWeek(ymd(last)) : Promise.resolve(null),
      api.loadUsers(),
      api.loadRequests([thisStart, nextStart], coach ? undefined : me),
      // The coach's recurring classes: they pre-fill each new week.
      coach ? api.loadSeries() : Promise.resolve([] as Slot[]),
    ]).then(([a, b, c, d, e, series]) => {
      state.series = series
      return [a, b, c, d, e] as const
    })
    const names = Object.fromEntries(users.map((u) => [u.id, u.name]))
    const meRow = users.find((u) => u.id === me)
    const [pkg, packages] = await Promise.all([
      coach ? Promise.resolve(null) : packageInfo(me, now),
      coach ? api.loadPackages() : Promise.resolve([]),
    ])
    const athletes = users.filter((u) => u.role !== "coach" && u.active !== false)
    const left = coach ? await allPackageInfo(packages, athletes.map((a) => a.id), now) : {}
    server = { this: thisWeek, next: nextWeek }
    const thisOpen = coach
    if (coach) {
      for (const k of Object.keys(drafts)) if (k !== thisStart && k !== nextStart) delete drafts[k]
      syncDraft(thisWeek, lastWeek)
      syncDraft(nextWeek, thisWeek.classes.length ? thisWeek : lastWeek)
    }
    const shownNext = weekdayOf(now) >= 5 && nextWeek.published
    const thisView = weekFor(thisWeek, requests, me, names)
    set({
      status: "ready", error: null, me, names, requests, pkg, packages, left,
      // Deactivated accounts can't be added to classes.
      athletes,
      defaults: meRow?.defaultClasses ?? [],
      thisWeek: thisView,
      shown: shownNext ? weekFor(nextWeek, requests, me, names) : thisView,
      nextWeek: nextWeek.published ? weekFor(nextWeek, requests, me, names) : null,
      shownNext, thisOpen,
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
    drafts = {}
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
    change.status === "skip" || change.status === "cancelAsk" ? { kind: "skip", classId: id }
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

// Join a class with a free spot, right away. With `every`, it also becomes
// one of their usual classes (kept for every new week) when that fits.
export function joinClass(id: string, cls: Slot, every: boolean): Promise<boolean> {
  return run(async () => {
    await api.joinClass(id)
    const key = slotKey(cls)
    if (every && !state.defaults.includes(key) && usualFits(state.defaults, cls)) await api.saveDefaults([...state.defaults, key])
  })
}

// Stop repeating a usual class (this week's class stays as it is).
export function stopUsual(cls: Slot): Promise<boolean> {
  return run(() => api.saveDefaults(state.defaults.filter((k) => k !== slotKey(cls))))
}

// ── Coach ───────────────────────────────────────────────────────────────────

// Requests waiting for the coach, both weeks.
export function pendingRequests(s: State): ClassRequest[] {
  const all = [...(server.this?.classes ?? []), ...(server.next?.classes ?? [])]
  const byId = (id?: string | null) => all.find((c) => c.id === id)
  const out: ClassRequest[] = []
  for (const r of s.requests) {
    if (r.status !== "pending") continue
    const from = byId(r.fromClassId)
    // A late cancel has nowhere to go: it's about the class itself.
    const to = r.kind === "propose" && r.day != null && r.start != null ? { day: r.day, start: r.start } : r.kind === "skip" ? from : byId(r.toClassId)
    if (!to || (r.kind !== "extra" && !from)) continue
    const week = r.weekStart === s.thisWeek.weekStart ? " (this week)" : ""
    const text =
      r.kind === "extra" ? `Extra class: ${classLabel(to)}`
      : r.kind === "skip" ? `Can't make ${classLabel(from!)} (less than ${CHANGE_DEADLINE_H} h before)`
      : r.kind === "propose" ? `${classLabel(from!)} → new time: ${WEEK_DAYS[to.day]} ${formatTime(to.start)}`
      : `${classLabel(from!)} → ${classLabel(to)}`
    out.push({ key: r.$id, kind: r.kind, who: s.names[r.athleteId] ?? "athlete", text: text + week, weekStart: r.weekStart, from, to })
  }
  return out
}

export function answerRequest(req: ClassRequest, accept: boolean): Promise<boolean> {
  return run(() => api.answerRequest(req.key, accept))
}

// Why a time can't take a class in the week being planned: the rules, or
// (this week) it has already gone by.
export type PlanProblem = AddClassProblem | "past"
export function planProblem(classes: GymClass[], day: number, start: number): PlanProblem | null {
  if (classStarted({ day, start })) return "past"
  return addClassProblem(classes, state.blocks, day, start)
}

export function addNextClass(day: number, start: number) {
  editDraft((d) => { d.classes.push({ id: `new${nextId++}`, day, start }) })
}

// Drag a class or a blocked time to another day or time. Returns why it
// can't go there, or null once it's moved.
export function moveNextClass(id: string, day: number, start: number): PlanProblem | null {
  const c = state.nextClasses.find((x) => x.id === id)
  if (c && classStarted(c)) return "past"
  const others = state.nextClasses.filter((c) => c.id !== id)
  const problem = planProblem(others, day, start)
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

// A class in the planned week that has already started (this week): it can't
// be moved or removed any more.
export const classStarted = (c: Slot) => state.planning === "this" && state.thisOpen && started(state.nextWeekStart, c)

export function removeNextClass(id: string) {
  const c = state.nextClasses.find((x) => x.id === id)
  if (c && classStarted(c)) return
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
  const d = currentDraft()
  if (!d) return false
  // This week: a class already gone by isn't published (it would sit empty).
  const classes = d.classes
    .filter((c) => !c.id.startsWith("new") || !started(d.weekStart, c))
    .map((c) => (c.id.startsWith("new") ? { day: c.day, start: c.start } : c))
  const saved = await run(async () => {
    await api.publishWeek(d.weekStart, classes, d.blocks)
    d.dirty = false
    delete drafts[d.weekStart]
  })
  return saved
}

// Coach: make a time repeat every week (pre-fills new weeks), or stop it.
export function setSeriesSlot(slot: Slot, on: boolean): Promise<boolean> {
  const rest = state.series.filter((x) => !(x.day === slot.day && x.start === slot.start))
  const next = on ? [...rest, { day: slot.day, start: slot.start }] : rest
  return run(async () => {
    await api.saveSeries(next)
    set({ series: next })
  })
}

// Coach: put an athlete in a saved class, or take them out.
export function setClassRoster(classId: string, athleteId: string, add: boolean): Promise<boolean> {
  return run(() => api.setRoster(classId, athleteId, add))
}

export function addAthletePackage(athleteId: string, total: number, startsOn: string, useBy: string): Promise<boolean> {
  return run(() => api.addPackage(athleteId, total, startsOn, useBy))
}
