// Tests for the pure constraint-warmup rotation (utils/progression/constraintWarmup.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/constraintWarmup.test.ts

import assert from "node:assert/strict"
import {
  afterWarmup, allowedColours, colourAllowedFor, constraintKey, excludedColours, rotationFor, suggestWarmup, warmupCandidates, warmupPillarFor, warmupUsage,
} from "@/utils/progression/constraintWarmup"

// The coach's library, as BlockRows (one with its own edited settings).
const row = (id: string, name: string, data: any = {}) => ({ $id: id, $createdAt: "", type: "constraint_warmup", name, data: JSON.stringify(data) })
const library = [
  row("gh", "Ghost Holds"), row("dh", "Double Hands"), row("oh", "One hand only"),
  row("fa", "Feet on air"), row("hh", "Hover hands"), row("nr", "No Re-Adjustment"),
  row("sf", "Silent Feet"), row("sl", "Sloth"), row("rh", "Relax the Hand"),
  row("sfnr", "Silent Feet & No Re-Adjustment"), row("fm", "Foot moves"), row("of", "One foot only"),
  row("fp", "Falling Practice"),
  row("new", "Blindfold"),                                                        // not in the table → not in rotation
  { ...row("x", "Some 4x4"), type: "four_by_four" },                              // other block types ignored
]
const candidates = warmupCandidates(library as any)
const noHistory = { last: new Set<string>(), recency: new Map<string, number>() }

// ── settings ──
assert.equal(constraintKey("Silent Feet & No Re-Adjustment"), "silentfeetnoreadjustment")
assert.equal(candidates.length, 13)
assert.deepEqual(rotationFor({ blockName: "Ghost Holds" }), { pillars: ["power"], colours: "below_flash" })
// the coach's own settings win over the default table
assert.deepEqual(rotationFor({ blockName: "Ghost Holds", rotation: { pillars: ["strength_power_endurance"], colours: "any" } }), { pillars: ["strength_power_endurance"], colours: "any" })
// settings saved before the current groups: strength + power endurance read
// as the merged group, the retired "general" as technique
assert.deepEqual(rotationFor({ blockName: "Sloth", rotation: { pillars: ["strength", "power_endurance", "general"] as any, colours: "any" } }), { pillars: ["strength_power_endurance", "technique"], colours: "any" })
assert.equal(warmupPillarFor("strength"), "strength_power_endurance")
assert.equal(warmupPillarFor("power_endurance"), "strength_power_endurance")
assert.equal(warmupPillarFor("power"), "power")
assert.equal(warmupPillarFor("technique"), "technique")
assert.equal(warmupPillarFor("fear_management"), "fear_management")
assert.equal(warmupPillarFor("general"), null)
assert.equal(warmupCandidates([row("b", "Blindfold", { rotation: { pillars: ["power"], colours: "any" } })] as any).length, 1)
// no pillars = the coach took it out, even with a default
assert.equal(rotationFor({ blockName: "Ghost Holds", rotation: { pillars: [], colours: "any" } }), null)
assert.equal(warmupCandidates([row("gh", "Ghost Holds", { rotation: { pillars: [], colours: "any" } })] as any).length, 0)
// colour ranges (flash green)
assert.deepEqual(allowedColours("below_flash", "green"), ["orange", "blue"])
assert.deepEqual(allowedColours("up_to_flash", "green"), ["orange", "blue", "green"])
assert.deepEqual(allowedColours("two_below_flash", "green"), ["orange"])
assert.deepEqual(allowedColours("two_below_flash", "blue"), ["orange"])
assert.equal(allowedColours("any", "green").length, 6)

// ── the coach's mapping (docs/training-plan.md §9.9b) ──
const group = (pillar: string) => candidates.filter((c) => c.rotation.pillars.includes(pillar as any)).map((c) => c.id).sort()
assert.deepEqual(group("technique"), ["fm", "nr", "of", "rh", "sf", "sfnr"])
assert.deepEqual(group("strength_power_endurance"), ["fa", "hh", "sl"])
assert.deepEqual(group("power"), ["dh", "gh", "oh"])
assert.deepEqual(group("fear_management"), ["dh", "fp", "oh"])

// ── no flash level → every constraint on orange ──
let w = suggestWarmup(candidates, "power", noHistory, null)!
assert.equal(w.length, 3)
assert.deepEqual(w.map((p) => p.colour), ["orange", "orange", "orange"])
assert.deepEqual(w.map((p) => p.attempts), [3, 2, 1])

// ── coach's example: flash yellow, power day ──
w = suggestWarmup(candidates, "power", noHistory, "yellow")!
assert.equal(w.length, 3)
assert.deepEqual(w.map((p) => p.attempts), [3, 2, 1])
// only power constraints — no "general" ones mixed in anymore
assert.deepEqual(w.map((p) => p.id).sort(), ["dh", "gh", "oh"])
// ramp blue → green → yellow, each clamped to the constraint's range
for (const p of w) {
  const c = candidates.find((x) => x.id === p.id)!
  assert.ok(allowedColours(c.rotation.colours, "yellow").includes(p.colour), `${p.name} ${p.colour}`)
}
assert.deepEqual(w.map((p) => p.colour).slice(0, 2), ["blue", "green"])

// ── different from last time ──
const sessions = [
  { $id: "s2", $createdAt: "", userId: "a", protocol: JSON.stringify([{ type: "constraint_warmup", blockName: "Silent Feet", libraryBlockId: "sf" }, { type: "constraint_warmup", blockName: "Foot moves" }]), attempts: JSON.stringify([{ blockIndex: 0 }, { blockIndex: 1 }]) },
  { $id: "s1", $createdAt: "", userId: "a", protocol: JSON.stringify([{ type: "constraint_warmup", blockName: "No Re-Adjustment" }, { type: "constraint_warmup", blockName: "One foot only" }]), attempts: JSON.stringify([{ blockIndex: 0 }]) },
]
const usage = warmupUsage(sessions as any, candidates)
assert.deepEqual([...usage.last].sort(), ["fm", "sf"])
assert.equal(usage.recency.get("nr"), 1)
assert.equal(usage.recency.has("of"), false)   // logged without attempts → not used
w = suggestWarmup(candidates, "technique", usage, "yellow")!
assert.ok(!w.some((p) => p.id === "sf" || p.id === "fm"), w.map((p) => p.id).join())
// never-used first (by name): One foot only, Relax the Hand, Silent Feet & No Re-Adjustment
assert.deepEqual(w.map((p) => p.id).sort(), ["of", "rh", "sfnr"])
// Relax the Hand (two below flash) takes the easiest slot
assert.equal(w[0].id, "rh"); assert.equal(w[0].colour, "blue")

// ── chained suggestions: workout 2 avoids workout 1's warm-up ──
// (technique: 6 candidates, enough for two fresh warm-ups)
const w1 = suggestWarmup(candidates, "technique", usage, "yellow")!
const w2 = suggestWarmup(candidates, "technique", afterWarmup(usage, w1), "yellow")!
assert.ok(!w2.some((p) => w1.some((q) => q.id === p.id)), `${w1.map((p) => p.id)} / ${w2.map((p) => p.id)}`)
assert.equal(afterWarmup(usage, w1).recency.get(w1[0].id), 0)
assert.equal(afterWarmup(usage, w1).recency.get("sf"), 1)
// power has exactly 3 candidates: every warm-up reuses the same 3
const pw1 = suggestWarmup(candidates, "power", noHistory, "yellow")!
const pw2 = suggestWarmup(candidates, "power", afterWarmup(noHistory, pw1), "yellow")!
assert.deepEqual(pw2.map((p) => p.id).sort(), pw1.map((p) => p.id).sort())

// ── too few candidates → as many as there are ──
w = suggestWarmup(candidates.filter((c) => ["gh", "fm", "oh"].includes(c.id)), "power", usage, "yellow")!
assert.equal(w.length, 2)
assert.equal(suggestWarmup(candidates.filter((c) => c.id === "fm"), "power", usage, "yellow"), null)

// ── strength / power endurance day (one group) ──
w = suggestWarmup(candidates, "strength_power_endurance", noHistory, "yellow")!
assert.deepEqual(w.map((p) => p.id).sort(), ["fa", "hh", "sl"])
// (on flash green Feet on air would open on orange — see the exclusions below)

// ── fear management: Falling Practice + the two shared with power ──
w = suggestWarmup(candidates, "fear_management", noHistory, "green")!
assert.deepEqual(w.map((p) => p.id).sort(), ["dh", "fp", "oh"])

// ── colour exclusions: Feet on air never on orange (CONSTRAINT_COLOUR_EXCLUSIONS) ──
assert.deepEqual(excludedColours("Feet on air"), ["orange"])
assert.deepEqual(excludedColours("FEET ON AIR!"), ["orange"])   // matched by key, like the rotation table
assert.equal(colourAllowedFor("Feet on air", "blue"), true)
assert.equal(colourAllowedFor("Sloth", "orange"), true)
const noFaOnOrange = (picks: { name: string; colour: string }[]) =>
  assert.ok(!picks.some((p) => p.name === "Feet on air" && p.colour === "orange"), picks.map((p) => `${p.name}:${p.colour}`).join())
// flash blue: the ramp is orange, orange, blue — Feet on air would be first (by name) on orange.
// The strength group has no other constraint left, so one from another group comes in.
w = suggestWarmup(candidates, "strength_power_endurance", noHistory, "blue")!
noFaOnOrange(w)
assert.equal(w.length, 3)
assert.ok(!w.some((p) => p.id === "fa"))
assert.ok(w.some((p) => p.id === "hh") && w.some((p) => p.id === "sl"))
// the stand-in is the least recently used of the other groups, by name: Double Hands
assert.ok(w.some((p) => p.id === "dh"), w.map((p) => p.id).join())
// a 4th strength constraint (coach's own settings) → it replaces Feet on air before any other group
const withFourth = [...candidates, ...warmupCandidates([row("tb", "Tension board", { rotation: { pillars: ["strength_power_endurance"], colours: "up_to_flash" } })] as any)]
w = suggestWarmup(withFourth, "strength_power_endurance", noHistory, "blue")!
assert.deepEqual(w.map((p) => p.id).sort(), ["hh", "sl", "tb"])
// no flash level → everything on orange → Feet on air replaced too
w = suggestWarmup(candidates, "strength_power_endurance", noHistory, null)!
noFaOnOrange(w)
assert.equal(w.length, 3)
// flash green: ramp orange, blue, green — Feet on air (first) lands on orange → replaced
w = suggestWarmup(candidates, "strength_power_endurance", noHistory, "green")!
noFaOnOrange(w)
// flash yellow: ramp blue, green, yellow — Feet on air stays
w = suggestWarmup(candidates, "strength_power_endurance", noHistory, "yellow")!
assert.deepEqual(w.map((p) => p.id).sort(), ["fa", "hh", "sl"])
assert.notEqual(w.find((p) => p.id === "fa")!.colour, "orange")
// Feet on air used last time, fresh ones first: it's the reused one → last slot (blue on flash blue) → kept
const faLast = { last: new Set(["fa"]), recency: new Map([["fa", 0]]) }
w = suggestWarmup(candidates, "strength_power_endurance", faLast, "blue")!
assert.deepEqual(w.map((p) => p.id).sort(), ["fa", "hh", "sl"])
assert.equal(w.find((p) => p.id === "fa")!.colour, "blue")
// nothing else anywhere → the warm-up is one shorter (never Feet on air on orange)
w = suggestWarmup(candidates.filter((c) => c.id === "fa"), "strength_power_endurance", noHistory, "blue")!
assert.equal(w, null)
w = suggestWarmup(candidates.filter((c) => ["fa", "hh"].includes(c.id)), "strength_power_endurance", noHistory, null)!
assert.deepEqual(w.map((p) => p.id), ["hh"])
// other groups are unaffected
w = suggestWarmup(candidates, "power", noHistory, "blue")!
assert.deepEqual(w.map((p) => p.id).sort(), ["dh", "gh", "oh"])

console.log("all constraint-warmup tests passed")
