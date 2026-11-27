// Tests for technique modules (utils/techniqueModules.ts, utils/techniqueProgress.ts —
// docs/technique-modules.md). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/techniqueModules.test.ts

import assert from "node:assert/strict"
import { FOOTWORK, getTechniqueModule, moduleLevel, techniqueCard, TECHNIQUE_MODULE_IDS } from "@/utils/techniqueModules"
import {
  atSessionStart, confirmLevelUp, EMPTY_PROGRESS, freshModuleProgress, getModuleProgress, HISTORY_MAX, holdLevelUp, logSession,
  newerProgress, parseTechniqueProgress, progressLabel, revealFor, routeColour, routePasses, serializeTechniqueProgress,
  sessionKind, sessionLevel, setLevel, withModuleProgress,
  type ModuleProgress, type RouteLog,
} from "@/utils/techniqueProgress"

const M = FOOTWORK
const ok: RouteLog = { breaks: 1, feel: "ok" }
const clean: RouteLog = { breaks: 0, feel: "ok" }
const easy: RouteLog = { breaks: 0, feel: "easy" }
const hard: RouteLog = { breaks: 0, feel: "hard" }
const broke: RouteLog = { breaks: 2, feel: "easy" }
const D1 = "2026-12-01", D2 = "2026-12-03", D3 = "2026-12-08"

// ─── Definition ───────────────────────────────────────────────────────────────

assert.deepEqual(TECHNIQUE_MODULE_IDS, ["footwork"])
assert.equal(getTechniqueModule("footwork"), M)
assert.equal(getTechniqueModule("nope"), null)
assert.equal(getTechniqueModule(null), null)
assert.deepEqual(M.levels.map((l) => l.number), [1, 2, 3])
assert.deepEqual(M.levels.map((l) => l.name), ["Free foot", "Opposite foot", "Same foot"])
assert.equal(moduleLevel(M, 0).number, 1)
assert.equal(moduleLevel(M, 9).number, 3)
assert.ok(M.howItWorks.length <= 4, "How it works: at most 4 steps")
// Experiment before Identify: no rule or cue names a technique
for (const l of M.levels) {
  for (const t of M.techniques) {
    const name = t.name.toLowerCase()
    assert.ok(!l.rule.toLowerCase().includes(name), `${l.name} rule names ${t.name}`)
    assert.ok(!l.cue.toLowerCase().includes(name), `${l.name} cue names ${t.name}`)
  }
}
// every technique a level expects or a chip points to has a card
for (const id of [...M.levels.flatMap((l) => l.expected), ...M.reflection.chips.flatMap((c) => (c.technique ? [c.technique] : []))]) {
  assert.ok(techniqueCard(M, id), `no card for ${id}`)
}
// chip ids are unique
assert.equal(new Set(M.reflection.chips.map((c) => c.id)).size, M.reflection.chips.length)

// ─── Pass rule ────────────────────────────────────────────────────────────────

assert.equal(routePasses(M, ok), true)
assert.equal(routePasses(M, easy), true)
assert.equal(routePasses(M, hard), false)
assert.equal(routePasses(M, broke), false)
assert.equal(routePasses(M, { breaks: 3, feel: "ok" }), false)

// ─── Session kind ─────────────────────────────────────────────────────────────

const fresh = freshModuleProgress()
assert.equal(sessionKind(fresh, { finalWeek: false }), "start_check")
assert.equal(sessionKind(fresh, { finalWeek: true }), "start_check")
const afterStart = logSession(fresh, M, [hard, broke], D1, "start_check")
assert.deepEqual(afterStart.startCheck, { on: D1, level: 1, routes: [hard, broke] })
assert.equal(afterStart.sessions, 1)
assert.equal(sessionKind(afterStart, { finalWeek: false }), "level")
assert.equal(sessionKind(afterStart, { finalWeek: true }), "retest")
const afterRetest = logSession({ ...afterStart, level: 3 }, M, [ok], D3, "retest")
assert.deepEqual(afterRetest.retest, { on: D3, level: 3, routes: [ok] })
assert.equal(sessionKind(afterRetest, { finalWeek: true }), "level")
assert.equal(sessionLevel({ ...fresh, level: 2 }, "start_check"), 1)
assert.equal(sessionLevel({ ...fresh, level: 2 }, "level"), 2)

// ─── Streaks and level ups ────────────────────────────────────────────────────

// 2 passing routes in a row → Level 2 proposed, not given
let p = logSession(afterStart, M, [ok, clean], D2)
assert.deepEqual(p.pending, { level: 2, since: D2 })
assert.equal(p.level, 1)
assert.equal(p.streak, 0)
// a fail resets the run
p = logSession(afterStart, M, [ok, hard, ok], D2)
assert.equal(p.pending, null)
assert.equal(p.streak, 1)
// the run carries across sessions
p = logSession(logSession(afterStart, M, [hard, ok], D1), M, [clean], D2)
assert.deepEqual(p.pending, { level: 2, since: D2 })
// routes after a level up is earned don't count
p = logSession(afterStart, M, [ok, ok, hard, hard], D2)
assert.deepEqual(p.pending, { level: 2, since: D2 })
assert.equal(p.streak, 0)

// too easy: 2 routes with 0 breaks that felt easy → a colour up, not a level up
p = logSession(afterStart, M, [easy, easy], D2)
assert.equal(p.colourStep, 1)
assert.equal(p.pending, null)
// …then passing at the new colour earns the level, even if easy again (max step reached)
p = logSession(p, M, [easy, easy], D3)
assert.equal(p.colourStep, 1)
assert.deepEqual(p.pending, { level: 2, since: D3 })
// one route that isn't "too easy" in the run → level up as usual
p = logSession(afterStart, M, [easy, ok], D2)
assert.equal(p.colourStep, 0)
assert.deepEqual(p.pending, { level: 2, since: D2 })
// a fail in between starts the easy run again
p = logSession(afterStart, M, [ok, hard, easy, easy], D2)
assert.equal(p.colourStep, 1)

// last level passed → mastered, stays on it
p = logSession({ ...afterStart, level: 3 }, M, [ok, ok], D2)
assert.equal(p.mastered, true)
assert.equal(p.level, 3)
assert.equal(p.pending, null)
assert.equal(logSession(p, M, [ok, ok], D3).mastered, true)

// ─── The coach ────────────────────────────────────────────────────────────────

const pending: ModuleProgress = logSession(afterStart, M, [ok, ok], D2)
// confirm
p = confirmLevelUp(pending, M, D2)
assert.equal(p.level, 2)
assert.equal(p.pending, null)
assert.equal(p.colourStep, 0)
assert.deepEqual(p.history.at(-1), { level: 2, on: D2, by: "coach" })
assert.equal(confirmLevelUp(afterStart, M, D2), afterStart)
// hold: stays, has to earn it again
p = holdLevelUp(pending)
assert.equal(p.level, 1)
assert.equal(p.pending, null)
assert.equal(p.streak, 0)
assert.equal(holdLevelUp(afterStart), afterStart)
// set by hand, up or back, clamped, clears pending and mastered
p = setLevel(pending, M, 3, D2)
assert.equal(p.level, 3)
assert.equal(p.pending, null)
assert.deepEqual(p.history.at(-1), { level: 3, on: D2, by: "coach_set" })
assert.equal(setLevel({ ...p, mastered: true }, M, 1, D2).mastered, false)
assert.equal(setLevel(p, M, 9, D2).level, 3)
assert.equal(setLevel(p, M, 0, D2).level, 1)

// no answer by the next module session → unlocks when it starts
assert.equal(atSessionStart(pending, M, D2), pending) // same day: still waiting
p = atSessionStart(pending, M, D3)
assert.equal(p.level, 2)
assert.equal(p.pending, null)
assert.deepEqual(p.history.at(-1), { level: 2, on: D3, by: "auto" })
assert.equal(atSessionStart(afterStart, M, D3), afterStart)

// history is capped
let h = afterStart
for (let i = 0; i < HISTORY_MAX + 5; i++) h = setLevel(h, M, (i % 3) + 1, D1)
assert.equal(h.history.length, HISTORY_MAX)

// ─── Colours ──────────────────────────────────────────────────────────────────

assert.equal(routeColour("green", 0), "blue")
assert.equal(routeColour("blue", 0), "orange")
assert.equal(routeColour("orange", 0), "orange")
assert.equal(routeColour(null, 0), "orange")
assert.equal(routeColour(null, 1), "blue")
assert.equal(routeColour("green", 1), "green")
assert.equal(routeColour("black", 1), "black")

// ─── Identify ─────────────────────────────────────────────────────────────────

let r = revealFor(M, ["side", "wall"], [])
assert.deepEqual(r.cards, ["flag", "smear"])
assert.deepEqual(r.fresh, ["flag", "smear"])
assert.deepEqual(r.found, ["flag", "smear"])
r = revealFor(M, ["wall", "push"], ["smear"])
assert.deepEqual(r.cards, ["smear", "leg_tension"])
assert.deepEqual(r.fresh, ["leg_tension"])
assert.deepEqual(r.found, ["smear", "leg_tension"])
// at most maxPicks, "Not sure" and unknown chips give no card
assert.deepEqual(revealFor(M, ["wall", "side", "swing"], []).cards, ["smear", "flag"])
assert.deepEqual(revealFor(M, ["unsure"], []).cards, [])
assert.deepEqual(revealFor(M, ["zzz"], []).cards, [])

// ─── Labels ───────────────────────────────────────────────────────────────────

assert.equal(progressLabel(M, afterStart), "Footwork · Level 1 of 3")
assert.equal(progressLabel(M, pending), "Footwork · Level 1 of 3 · ready for Level 2")
assert.equal(progressLabel(M, { ...afterStart, level: 3, mastered: true }), "Footwork · All 3 levels done")

// ─── Storage ──────────────────────────────────────────────────────────────────

const all = withModuleProgress(EMPTY_PROGRESS, "footwork", { ...pending, found: ["smear"] }, 42)
assert.deepEqual(parseTechniqueProgress(serializeTechniqueProgress(all)), all)
assert.deepEqual(parseTechniqueProgress(all), all)
assert.deepEqual(getModuleProgress(EMPTY_PROGRESS, "footwork"), freshModuleProgress())
assert.deepEqual(parseTechniqueProgress("not json"), EMPTY_PROGRESS)
assert.deepEqual(parseTechniqueProgress(null), EMPTY_PROGRESS)
assert.deepEqual(parseTechniqueProgress({ modules: { other: {} } }).modules, {})
// junk inside a module falls back field by field
const junk = parseTechniqueProgress({
  updatedAt: 5,
  modules: { footwork: { level: "x", found: ["smear", "smear", "nope"], pending: { since: "bad" }, history: [{ level: 2, on: D1, by: "hacker" }, { level: 2, on: D1, by: "coach" }], startCheck: { on: D1, routes: [ok, { feel: "meh" }] } } },
})
const jm = getModuleProgress(junk, "footwork")
assert.equal(jm.level, 1)
assert.deepEqual(jm.found, ["smear"])
assert.equal(jm.pending, null)
assert.deepEqual(jm.history, [{ level: 2, on: D1, by: "coach" }])
assert.deepEqual(jm.startCheck?.routes, [ok])
// breaks clamped to the tap's range
assert.deepEqual(parseTechniqueProgress({ modules: { footwork: { startCheck: { on: D1, routes: [{ breaks: 7, feel: "ok" }] } } } }).modules.footwork?.startCheck?.routes, [{ breaks: 3, feel: "ok" }])
// newer copy wins, ties keep the first
const older = withModuleProgress(EMPTY_PROGRESS, "footwork", afterStart, 1)
assert.equal(newerProgress(older, all), all)
assert.equal(newerProgress(all, older), all)
assert.equal(newerProgress(all, { ...all }), all)
// a full module fits easily in a text column
const big = withModuleProgress(EMPTY_PROGRESS, "footwork", { ...h, found: ["smear", "flag", "leg_tension", "pogo"], startCheck: afterStart.startCheck, retest: afterRetest.retest }, 1)
assert.ok(serializeTechniqueProgress(big).length < 4000, `progress JSON too long: ${serializeTechniqueProgress(big).length}`)

console.log("techniqueModules: all tests passed")
