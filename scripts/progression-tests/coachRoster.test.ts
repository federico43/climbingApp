// Tests for the coach dashboard's roster (utils/coachRoster.ts —
// docs/coach-dashboard.md §4.1–4.3). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/coachRoster.test.ts

import assert from "node:assert/strict"
import {
  filterRoster, lastSessionLabel, normalizeName, planStatusLabel, rosterKpis, summarizeRoster, weekStartOf,
  type RosterHomework, type RosterPlan, type RosterSession,
} from "@/utils/coachRoster"

const TODAY = "2026-10-16" // a Friday
const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).toISOString()
const session = (userId: string, date: string, protocolId: string | null = null): RosterSession => ({
  userId, $createdAt: at(date), attempts: JSON.stringify([{ timestamp: new Date(at(date)).getTime() }]), protocol: "", protocolId,
})
const hw = (id: string, athleteId: string, extra: Partial<RosterHomework> = {}): RosterHomework =>
  ({ $id: id, $createdAt: at("2026-10-12", 9), name: "Density test", dueBy: "2026-10-17", athleteId, ...extra })
const plan = (athleteId: string, windowStart: string, windowEnd: string, $id = `p-${athleteId}`): RosterPlan =>
  ({ $id, athleteId, name: "Plan", windowStart, windowEnd })

// week starts on Monday
assert.equal(weekStartOf("2026-10-16"), "2026-10-12")
assert.equal(weekStartOf("2026-10-12"), "2026-10-12")
assert.equal(weekStartOf("2026-10-18"), "2026-10-12") // Sunday

const athletes = [
  { $id: "ana", username: "Ána" },
  { $id: "bruno", username: "Bruno" },
  { $id: "carla", username: "Carla" },
  { $id: "dani", username: "Dani" },
]
const homework = [
  hw("h1", "ana"),                                         // pending (not scheduled)
  hw("h2", "ana", { dueBy: "2026-10-14" }),                // overdue → urgent
  hw("h3", "carla"),                                       // done by a session
  hw("h4", "bruno", { homeworkStatus: "cant_attend" }),    // urgent
  hw("h5", "dani", { dueBy: "2026-07-01" }),               // long past → ignored
]
const plans = [
  plan("ana", "2026-10-01", "2026-11-11"),
  plan("ana", "2026-09-01", "2026-10-12", "older"),        // older duplicate: ignored (list is newest first)
  plan("carla", "2026-08-01", "2026-09-11"),               // ended
  plan("dani", "2026-10-20", "2026-11-30"),                // upcoming
]
const sessions = [
  session("ana", "2026-10-15"),
  session("carla", "2026-10-13", "h3"),
  session("carla", "2026-10-09"),                          // last week
  session("bruno", "2026-10-01"),
]

const roster = summarizeRoster(athletes, homework, plans, sessions, TODAY)
const by = Object.fromEntries(roster.map((a) => [a.id, a]))

assert.equal(by.ana.pendingHomework, 2)
assert.equal(by.ana.urgentHomework, 1)
assert.equal(by.bruno.pendingHomework, 1)
assert.equal(by.bruno.urgentHomework, 1)
assert.equal(by.carla.pendingHomework, 0)
assert.equal(by.dani.pendingHomework, 0)

assert.equal(by.ana.planStatus, "active")
assert.equal(by.ana.planWeek, 3)
assert.equal(by.ana.plan?.$id, "p-ana")
assert.equal(by.bruno.planStatus, "none")
assert.equal(by.carla.planStatus, "ended")
assert.equal(by.dani.planStatus, "upcoming")
assert.equal(planStatusLabel(by.ana), "Wk 3/6")
assert.equal(planStatusLabel(by.carla), "Plan ended")

assert.equal(by.ana.daysSinceLast, 1)
assert.equal(by.bruno.daysSinceLast, 15)
assert.equal(by.dani.daysSinceLast, null)
assert.equal(lastSessionLabel(by.dani), "60d+")
assert.equal(lastSessionLabel(by.ana), "1d")

// sort: pending homework first (urgent count, then name), then the rest by name
assert.deepEqual(roster.map((a) => a.id), ["ana", "bruno", "carla", "dani"])

const kpis = rosterKpis(roster, sessions, TODAY, 7)
assert.equal(kpis.withHomework, 2)
assert.equal(kpis.withUrgentHomework, 2)
assert.equal(kpis.workoutsThisWeek, 2)   // ana 15th, carla 13th
assert.equal(kpis.withoutPlan, 2)        // bruno (none) + carla (ended)
assert.equal(kpis.inactive, 2)           // bruno 15d, dani none
assert.equal(rosterKpis(roster, sessions, TODAY, 30).inactive, 1)

// search: accent- and case-insensitive
assert.equal(normalizeName("  Ána "), "ana")
assert.deepEqual(filterRoster(roster, "ana", null, 7).map((a) => a.id), ["ana"])
assert.deepEqual(filterRoster(roster, "", "homework", 7).map((a) => a.id), ["ana", "bruno"])
assert.deepEqual(filterRoster(roster, "", "no_plan", 7).map((a) => a.id), ["bruno", "carla"])
assert.deepEqual(filterRoster(roster, "", "inactive", 14).map((a) => a.id), ["bruno", "dani"])
assert.deepEqual(filterRoster(roster, "c", "no_plan", 7).map((a) => a.id), ["carla"])

console.log("coachRoster: all good")
