// Tests for the training-plan rotation and workout generator
// (utils/planRotation.ts, utils/scPlanBuilder.ts, utils/planWorkout.ts —
// docs/training-plan.md §9). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/planWorkout.test.ts

import assert from "node:assert/strict"
import {
  alternateMainBlock, builtMainBlock, builtMainType, coreFocusFor, localDateStr, mainTypeFor, MAIN_BLOCKS, nextPlanIndex, planEndFor, planIsOver, planWeek, workoutSpec, type BuiltPlanWorkout, type PlanShape,
} from "@/utils/planRotation"
import { buildScBlocks, mobilityByRecency, orderPatterns } from "@/utils/scPlanBuilder"
import { buildPlanWorkout, withUpcomingWorkouts } from "@/utils/planWorkout"
import { focusesFor } from "@/utils/scProgression"
import { planFromHistory } from "@/utils/scPrefill"

// ── dates ──
const start = "2026-10-05"
assert.equal(planEndFor(start), "2026-11-15")                 // 6 full weeks, inclusive
assert.equal(planWeek(start, start), 1)
assert.equal(planWeek(start, "2026-10-11"), 1)
assert.equal(planWeek(start, "2026-10-12"), 2)
assert.equal(planWeek(start, "2026-11-15"), 6)
assert.equal(localDateStr(new Date(2026, 0, 9, 23, 30)), "2026-01-09") // local day, not UTC

const plan: PlanShape = {
  windowStart: start,
  windowEnd: planEndFor(start),
  focus: "technique",
  hasSc: true,
  hasMobility: true,
  scPatterns: [
    { movementType: "squat", exerciseIds: ["sq1", "sq2"] },
    { movementType: "hinge", exerciseIds: ["h1"] },
    { movementType: "push", exerciseIds: ["p1", "p2"] },
    { movementType: "carry_grip", exerciseIds: [] },
  ],
}

// ── rotation (the §9.6 example) ──
const spec = (i: number, today = start, built: BuiltPlanWorkout[] = []) => workoutSpec(plan, i, built, today)
const mains = Array.from({ length: 12 }, (_, i) => spec(i + 1).mainBlock.name)
assert.deepEqual(mains, [
  "Project Bouldering", "Power endurance - 4x4", "Power boulders",
  "Max bouldering", "Base 1", "Power boulders",
  "Project Bouldering", "Power endurance - 4x4", "Power boulders",
  "Max bouldering", "Base 1", "Power boulders",
])
assert.equal(spec(5).mainBlock.type, "sequence")             // the sequence Base 1, not the free session
assert.deepEqual([1, 2, 3, 4].map((i) => spec(i).warmup), ["constraints", "one_on_one_off", "constraints", "one_on_one_off"])
assert.deepEqual([1, 2, 3].map((i) => spec(i).scFocus), ["max_force", "hypertrophy", "explosiveness"])
assert.deepEqual([1, 2, 3, 4].map((i) => spec(i).exerciseSlot), [0, 1, 0, 1])
assert.equal(workoutSpec({ ...plan, hasSc: false }, 1, [], start).scFocus, null)

// ── start type: the cycle starts with the coach's pick; none / null = strength ──
assert.deepEqual([1, 2, 3, 4].map((i) => mainTypeFor(i)), ["strength", "power_endurance", "power", "strength"])
assert.deepEqual([1, 2, 3, 4].map((i) => mainTypeFor(i, null)), ["strength", "power_endurance", "power", "strength"])
assert.deepEqual([1, 2, 3, 4].map((i) => mainTypeFor(i, "power")), ["power", "strength", "power_endurance", "power"])
const pePlan: PlanShape = { ...plan, startType: "power_endurance" }
const peMains = Array.from({ length: 12 }, (_, i) => workoutSpec(pePlan, i + 1, [], start).mainBlock.name)
assert.deepEqual(peMains, [
  "Power endurance - 4x4", "Power boulders", "Project Bouldering",
  "Base 1", "Power boulders", "Max bouldering",
  "Power endurance - 4x4", "Power boulders", "Project Bouldering",
  "Base 1", "Power boulders", "Max bouldering",
])
assert.deepEqual([1, 2, 3].map((i) => workoutSpec(pePlan, i, [], start).scFocus), ["hypertrophy", "explosiveness", "max_force"])
assert.equal(workoutSpec(pePlan, 1, [], start).withTest, true)
assert.equal(workoutSpec(pePlan, 1, [], start).warmup, "constraints")
// built slots still steer the alternation with a shifted start (workout 1 swapped to Base 1 → 4 is the 4x4)
const base1 = { blockName: "Base 1", type: "sequence" }
assert.equal(workoutSpec(pePlan, 4, [{ planIndex: 1, createdAt: "2026-10-05T10:00:00Z", blocks: JSON.stringify([base1]) }], start).mainBlock.name, "Power endurance - 4x4")
// a built workout's type is read from its main block (its plan may not start with strength)
assert.equal(builtMainType(1, JSON.stringify([base1])), "power_endurance")
assert.equal(builtMainType(2, "[]"), "power_endurance") // nothing recognised → default cycle

// ── main block follows what was built, not the slot (swap / hand edits) ──
const builtWith = (planIndex: number, blocks: { blockName: string; type: string }[], createdAt = "2026-10-05T10:00:00Z") =>
  ({ planIndex, createdAt, blocks: JSON.stringify(blocks) })
const max = { blockName: "Max bouldering", type: "sequence" }
const project = { blockName: "Project Bouldering", type: "project_bouldering" }
// workout 1 swapped to Max → workout 4 comes up as Project, then Max, Project
let b = [builtWith(1, [{ blockName: "Density test", type: "exploration_session" }, max, max])]
assert.deepEqual([4, 7, 10].map((i) => spec(i, start, b).mainBlock.name), ["Project Bouldering", "Max bouldering", "Project Bouldering"])
// a hand edit: workouts 1 and 4 both Project → 7 and 10 are Max (2 each by the end)
b = [builtWith(1, [project, project]), builtWith(4, [project])]
assert.deepEqual([7, 10].map((i) => spec(i, start, b).mainBlock.name), ["Max bouldering", "Max bouldering"])
// the "Base 1" free session isn't the sequence Base 1; an unrecognised block keeps the slot's own pick
b = [builtWith(2, [{ blockName: "Base 1", type: "free_session" }])]
assert.deepEqual([5, 8].map((i) => spec(i, start, b).mainBlock.name), ["Base 1", "Power endurance - 4x4"])
// a rebuilt slot: the newest build counts
b = [builtWith(1, [project], "2026-10-05T10:00:00Z"), builtWith(1, [max], "2026-10-06T10:00:00Z")]
assert.equal(spec(4, start, b).mainBlock.name, "Project Bouldering")
// rows without blocks (or bad JSON) → same as the fixed alternation
assert.deepEqual([4, 7].map((i) => spec(i, start, [{ planIndex: 1, createdAt: "", blocks: "{" }]).mainBlock.name), ["Max bouldering", "Project Bouldering"])
assert.deepEqual(builtMainBlock("strength", JSON.stringify([max])), MAIN_BLOCKS.strength[1])
assert.equal(builtMainBlock("power", JSON.stringify([max])), null)
// swap targets
assert.equal(alternateMainBlock("strength", MAIN_BLOCKS.strength[0])?.name, "Max bouldering")
assert.equal(alternateMainBlock("power_endurance", MAIN_BLOCKS.power_endurance[1])?.name, "Power endurance - 4x4")
assert.equal(alternateMainBlock("power", MAIN_BLOCKS.power[0]), null)

// ── Density test: workout 1, and the first workout built in week 6 ──
assert.equal(spec(1).withTest, true)
assert.equal(spec(5, "2026-10-19").withTest, false)
const week6 = "2026-11-10"
assert.equal(spec(11, week6, [{ planIndex: 10, createdAt: "2026-11-04T10:00:00Z" }]).withTest, true)
assert.equal(spec(12, week6, [{ planIndex: 11, createdAt: "2026-11-09T10:00:00Z" }]).withTest, false)
// a slow athlete still gets the end test in week 6, even on workout 8
assert.equal(spec(8, week6, [{ planIndex: 7, createdAt: "2026-10-30T10:00:00Z" }]).withTest, true)

// ── progress / end ──
assert.equal(nextPlanIndex([]), 1)
assert.equal(nextPlanIndex([{ planIndex: 3, createdAt: "" }, { planIndex: 1, createdAt: "" }]), 4)
assert.equal(planIsOver(plan, [], "2026-11-15"), false)
assert.equal(planIsOver(plan, [], "2026-11-16"), true)       // ends at the date, even with workouts left
assert.equal(planIsOver(plan, [{ planIndex: 12, createdAt: "" }], start), true)

// ── S&C ──
const ex = (id: string, name: string, movementType: string, extra: any = {}) =>
  ({ $id: id, $createdAt: "", name, type: "reps", movementType, ...extra })
const exercises: any[] = [
  ex("sq1", "Pistol Squat", "squat", { type: "both_sides" }), ex("sq2", "Split Squat", "squat"),
  ex("h1", "KettleBell Deadlift", "hinge"),
  ex("p1", "Push-ups", "push"), ex("p2", "Bench press", "push"),
  ex("el", "Edge Lifts", "carry_grip", { type: "both_sides" }),
  ex("rp", "repeaters", "carry_grip", { type: "7/3s" }),
  ex("jc", "Jumps to Catch", "carry_grip"),
  ex("bj", "Jumps into box", "squat"),
  ex("m1", "Frogs", "mobility"), ex("m2", "pancake", "mobility"), ex("m3", "Deep Squat", "mobility"),
  ex("m4", "Cosack Squat", "mobility"), ex("m5", "kneeling lunge stretch", "mobility", { type: "both_sides" }),
]
const names = (b: any) => b.exercises.map((e: any) => e.name)

// squat and hinge never share a block
assert.deepEqual(orderPatterns(plan.scPatterns).map((p) => p.movementType), ["squat", "push", "hinge", "carry_grip"])
// push, fingers, squat, hinge → hinge moves to the first block
assert.deepEqual(orderPatterns([plan.scPatterns[2], plan.scPatterns[3], plan.scPatterns[0], plan.scPatterns[1]]).map((p) => p.movementType), ["hinge", "carry_grip", "squat", "push"])
// already apart → unchanged
assert.deepEqual(orderPatterns([plan.scPatterns[0], plan.scPatterns[2], plan.scPatterns[1], plan.scPatterns[3]]).map((p) => p.movementType), ["squat", "push", "hinge", "carry_grip"])

// workout 1: strength day → max force, exercise 1 of each pattern, with mobility
let sc = buildScBlocks(plan, spec(1), exercises, [])
assert.deepEqual(sc.warnings, [])
assert.deepEqual(sc.blocks.map((b) => b.blockName), ["S&C 1", "S&C 2", "Mobility"])
assert.deepEqual(names(sc.blocks[0]), ["Pistol Squat", "Push-ups", "Cosack Squat"])
// Edge Lifts (max force) go first in their block — their warm-up runs before round 1
assert.deepEqual(names(sc.blocks[1]), ["Edge Lifts", "KettleBell Deadlift", "Deep Squat"])
assert.deepEqual(names(sc.blocks[2]), ["Frogs", "kneeling lunge stretch"])
assert.deepEqual(sc.blocks.map((b) => b.restBetweenRounds), [60, 60, 30])
assert.ok(sc.blocks.every((b) => b.rounds === 3))
assert.equal(sc.blocks[0].exercises[0].focus, "max_force")
assert.equal(sc.blocks[0].exercises[0].reps, "3-6")
assert.equal(sc.blocks[0].exercises[2].focus, undefined)     // mobility isn't programmed for a focus

// workout 2: PE day → hypertrophy, exercise 2 (hinge has only one → keeps it), fingers = 7/3s
sc = buildScBlocks(plan, spec(2), exercises, [])
assert.deepEqual(names(sc.blocks[0]).slice(0, 2), ["Split Squat", "Bench press"])
assert.deepEqual(names(sc.blocks[1]).slice(0, 2), ["KettleBell Deadlift", "repeaters"])
assert.equal(sc.blocks[0].exercises[0].reps, "8-12")
assert.equal(sc.blocks[1].exercises[1].focus, "hypertrophy")
assert.equal(sc.blocks[1].exercises[1].edge, "20mm")         // 7/3s keeps its own targets

// workout 3: power day → box jumps replace the squat pick, Jumps to Catch for fingers
sc = buildScBlocks(plan, spec(3), exercises, [])
assert.deepEqual(names(sc.blocks[0]).slice(0, 2), ["Jumps into box", "Push-ups"])
assert.equal(names(sc.blocks[1])[1], "Jumps to Catch")

// no mobility: 2 blocks, rest by focus
const noMob = { ...plan, hasMobility: false }
sc = buildScBlocks(noMob, workoutSpec(noMob, 1, [], start), exercises, [])
assert.deepEqual(sc.blocks.map((b) => [b.blockName, b.restBetweenRounds]), [["S&C 1", 180], ["S&C 2", 180]])
assert.deepEqual(names(sc.blocks[0]), ["Pistol Squat", "Push-ups"])
sc = buildScBlocks(noMob, workoutSpec(noMob, 2, [], start), exercises, [])
assert.deepEqual(sc.blocks.map((b) => b.restBetweenRounds), [120, 120])

// core never does explosiveness: max force ↔ hypertrophy, flipping every
// week, so each of its two exercises alternates on its own
assert.deepEqual(Array.from({ length: 8 }, (_, i) => coreFocusFor(i + 1)),
  ["max_force", "max_force", "hypertrophy", "hypertrophy", "max_force", "max_force", "hypertrophy", "hypertrophy"])
const corePlan: PlanShape = { ...plan, scPatterns: [...plan.scPatterns.slice(0, 3), { movementType: "core", exerciseIds: ["c1", "c2"] }] }
const coreLib = [...exercises, ex("c1", "Hanging leg raise", "core"), ex("c2", "Ab wheel", "core")]
const coreOf = (i: number) => buildScBlocks(corePlan, workoutSpec(corePlan, i, [], start), coreLib, []).blocks
  .flatMap((b) => b.exercises).find((e) => e.movementType === "core")!
const cores = Array.from({ length: 6 }, (_, i) => coreOf(i + 1))
assert.deepEqual(cores.map((e) => [e.name, e.focus]), [
  ["Hanging leg raise", "max_force"], ["Ab wheel", "max_force"],
  ["Hanging leg raise", "hypertrophy"], ["Ab wheel", "hypertrophy"],
  ["Hanging leg raise", "max_force"], ["Ab wheel", "max_force"],
])
assert.equal(cores[2].reps, "8-12")
// the rest of the workout keeps the day's focus (workout 3: power → explosiveness)
assert.equal(buildScBlocks(corePlan, workoutSpec(corePlan, 3, [], start), coreLib, []).blocks[0].exercises[1].focus, "explosiveness")
// a core exercise only "Used for" hypertrophy is passed over on a max force week
assert.equal(buildScBlocks(corePlan, workoutSpec(corePlan, 1, [], start), coreLib.map((e) => e.$id === "c1" ? { ...e, focuses: ["hypertrophy"] } : e), []).blocks
  .flatMap((b) => b.exercises).find((e) => e.movementType === "core")!.name, "Ab wheel")
assert.deepEqual(focusesFor("core"), ["max_force", "hypertrophy"])
assert.deepEqual(focusesFor("push"), ["max_force", "hypertrophy", "explosiveness"])

// no S&C
assert.deepEqual(buildScBlocks({ ...plan, hasSc: false }, spec(1), exercises, []).blocks, [])

// a special-case exercise missing from the library → warning, fingers left out
sc = buildScBlocks(plan, spec(1), exercises.filter((e) => e.name !== "Edge Lifts"), [])
assert.equal(sc.warnings.length, 1)
assert.deepEqual(names(sc.blocks[1]), ["KettleBell Deadlift", "Deep Squat"])
// box jumps missing → falls back to the plan's squat pick
sc = buildScBlocks(plan, spec(3), exercises.filter((e) => e.name !== "Jumps into box"), [])
assert.equal(names(sc.blocks[0])[0], "Pistol Squat")
// too few mobility exercises → warning, empty mobility block dropped
sc = buildScBlocks(plan, spec(1), exercises.filter((e) => !["m1", "m2", "m3", "m4"].includes(e.$id)), [])
assert.equal(sc.blocks.length, 2)
assert.ok(sc.warnings.some((w) => w.includes("mobility")))

// ── exercises limited to some S&C focuses ──
const limited = exercises.map((e) => e.$id === "sq1" ? { ...e, focuses: ["hypertrophy"] } : e)
// workout 1 (max force, slot 0): Pistol Squat is hypertrophy-only → the other pick, Split Squat
sc = buildScBlocks(plan, spec(1), limited, [])
assert.equal(names(sc.blocks[0])[0], "Split Squat")
assert.deepEqual(sc.warnings, [])
// workout 2 (hypertrophy, slot 1): Split Squat fits, so it's used as planned
assert.equal(names(buildScBlocks(plan, spec(2), limited, []).blocks[0])[0], "Split Squat")
// neither pick fits → another library squat that does, with a warning
const bothLimited = exercises.map((e) => ["sq1", "sq2"].includes(e.$id) ? { ...e, focuses: ["hypertrophy"] } : e)
sc = buildScBlocks(plan, spec(1), bothLimited, [])
assert.equal(names(sc.blocks[0])[0], "Jumps into box")
assert.equal(sc.warnings.length, 1)
// nothing fits → left out, with a warning
sc = buildScBlocks(plan, spec(1), bothLimited.map((e) => e.$id === "bj" ? { ...e, focuses: ["explosiveness"] } : e), [])
assert.deepEqual(names(sc.blocks[0]), ["Push-ups", "Cosack Squat"])
assert.equal(sc.warnings.length, 1)
// mobility keeps the library's default target and gets no focus
const mobDefault = exercises.map((e) => e.$id === "m4" ? { ...e, defaultReps: "10" } : e)
const cosack = buildScBlocks(plan, spec(1), mobDefault, []).blocks[0].exercises[2]
assert.equal(cosack.name, "Cosack Squat"); assert.equal(cosack.reps, "10"); assert.equal(cosack.focus, undefined)

// held (passive) mobility in blocks 1–2, reps (active) in block 3
const holdLib = exercises.map((e) =>
  e.$id === "m3" ? { ...e, defaultReps: "8", defaultHold: "30" }           // Deep Squat: reps or hold
  : e.$id === "m2" || e.$id === "m5" ? { ...e, unit: "seconds", defaultReps: "45" } // held only
  : e)
sc = buildScBlocks(plan, spec(1), holdLib, [])
const mobOf = (b: any) => b.exercises.filter((e: any) => e.movementType === "mobility")
  .map((e: any) => `${e.name} ${e.reps}${e.unit === "seconds" ? "s" : ""}`)
assert.deepEqual(mobOf(sc.blocks[0]), ["Deep Squat 30s"])                    // can be held → held here
assert.deepEqual(mobOf(sc.blocks[1]), ["kneeling lunge stretch 45s"])
assert.deepEqual(mobOf(sc.blocks[2]), ["Cosack Squat ", "Frogs "])           // by reps (no default reps set)
assert.deepEqual(sc.warnings, [])
// no holdable ones left → falls back to a reps one in its own way
sc = buildScBlocks(plan, spec(1), exercises, [])
assert.equal(mobOf(sc.blocks[0])[0], "Cosack Squat ")

// mobility rotates: least recently used first
const scSession = (ids: string[]) => ({
  $id: "", $createdAt: "", userId: "a", attempts: "[]",
  protocol: JSON.stringify([{ type: "strength_conditioning", exercises: ids.map((exerciseId) => ({ exerciseId })) }]),
})
const order = mobilityByRecency(exercises, [scSession(["m4"]), scSession(["m3", "m4"])] as any).map((e) => e.$id)
assert.deepEqual(order, ["m1", "m5", "m2", "m3", "m4"])

// ── whole workout ──
const row = (id: string, type: string, name: string, data: any = {}) => ({ $id: id, $createdAt: "", type, name, data: JSON.stringify({ type, blockName: name, ...data }) })
const library: any[] = [
  row("pb", "project_bouldering", "Project Bouldering"),
  row("mb", "sequence", "Max bouldering"),
  row("44", "four_by_four", "Power endurance - 4x4"),
  row("b1", "sequence", "Base 1"),
  row("b1f", "free_session", "Base 1"),
  row("pw", "free_session", "Power boulders"),
  row("dt", "exploration_session", "Density test"),
  row("io", "intervals", "1 on 1 off ", { series: 8, workTime: 30, restTime: 60, adaptation: "power_endurance" }),
  row("sf", "constraint_warmup", "Silent Feet"), row("fm", "constraint_warmup", "foot moves"),
  row("of", "constraint_warmup", "One foot only"), row("gh", "constraint_warmup", "Ghost Holds "),
]
const types = (w: any) => w.blocks.map((b: any) => b.type)

// workout 1 is a test day: normal warm-up, the Density test comes back as homework
let w = buildPlanWorkout(plan, spec(1), library, exercises, [], null)
assert.deepEqual(w.warnings, [])
assert.deepEqual(types(w), [
  "strength_conditioning", "strength_conditioning", "strength_conditioning",
  "constraint_warmup", "constraint_warmup", "constraint_warmup", "project_bouldering", "project_bouldering",
])
assert.deepEqual(w.homework.map((b: any) => b.libraryBlockId), ["dt"])
assert.equal((w.blocks[6] as any).libraryBlockId, "pb")
assert.equal((w.blocks[7] as any).libraryBlockId, "pb")                         // main block twice

// workout 3, no flash level: S&C → 3 constraints on orange → main
w = buildPlanWorkout(plan, spec(3), library, exercises, [], null)
assert.deepEqual(types(w).slice(3), ["constraint_warmup", "constraint_warmup", "constraint_warmup", "free_session", "free_session"])
const warm = w.blocks.filter((b: any) => b.type === "constraint_warmup") as any[]
assert.deepEqual(warm.map((b) => b.libraryBlockId).sort(), ["fm", "of", "sf"])    // technique focus
assert.ok(warm.every((b) => b.level === "orange"))

// first workout of week 6 (here workout 11, a constraints day): warm-up kept, test as homework
w = buildPlanWorkout(plan, spec(11, "2026-11-10", [{ planIndex: 10, createdAt: "2026-11-04T10:00:00Z" }]), library, exercises, [], "green")
assert.deepEqual(types(w).slice(3), ["constraint_warmup", "constraint_warmup", "constraint_warmup", "sequence", "sequence"])
assert.deepEqual(w.homework.map((b: any) => b.type), ["exploration_session"])

// workout 2: 1 on 1 off as a warm-up (warm-up kind and rounds, no PE tag)
w = buildPlanWorkout(plan, spec(2), library, exercises, [], "green")
assert.deepEqual(types(w).slice(3), ["intervals", "four_by_four", "four_by_four"])
assert.deepEqual(w.homework, [])                                                // not a test day
const io = w.blocks[3] as any
assert.equal(io.kind, "warmup"); assert.equal(io.series, 4); assert.equal(io.adaptation, undefined)
assert.equal(io.workTime, 30)

// workout 5: Base 1 is the sequence one
w = buildPlanWorkout(plan, spec(5), library, exercises, [], "green")
assert.equal((w.blocks[w.blocks.length - 1] as any).libraryBlockId, "b1")

// missing library block → left out with a warning
w = buildPlanWorkout({ ...plan, hasSc: false }, spec(3), library.filter((r) => r.name !== "Power boulders"), exercises, [], "green")
assert.deepEqual(types(w), ["constraint_warmup", "constraint_warmup", "constraint_warmup"])
assert.equal(w.warnings.length, 1)

// ── built-but-not-done workouts count as "last time" ──
const done = { $id: "s1", $createdAt: "2026-10-06T18:00:00Z", userId: "a", attempts: "[]",
  protocol: JSON.stringify([{ type: "constraint_warmup", blockName: "Silent Feet", libraryBlockId: "sf" }]) }
const builtW1 = { $id: "w1", $createdAt: "2026-10-05T09:00:00Z", blocks: "[]" }                  // done since
const builtW3 = { $id: "w3", $createdAt: "2026-10-07T09:00:00Z", blocks: JSON.stringify([
  { type: "constraint_warmup", blockName: "foot moves", libraryBlockId: "fm" },
  { type: "constraint_warmup", blockName: "One foot only", libraryBlockId: "of" },
  { type: "constraint_warmup", blockName: "Silent Feet", libraryBlockId: "sf" },
]) }
const merged = withUpcomingWorkouts([done] as any, [builtW1, builtW3])
assert.deepEqual(merged.map((s) => s.$id), ["upcoming-w3", "s1"])
// the next constraints workout avoids w3's three, even though w3 isn't done yet
const lib2 = [...library, row("nr", "constraint_warmup", "No Re-Adjustment"), row("rh", "constraint_warmup", "Relax the Hand"),
  row("sfnr", "constraint_warmup", "Silent Feet & No Re-Adjustment")]
w = buildPlanWorkout(plan, spec(5), lib2, exercises, merged, "green")
const next = w.blocks.filter((b: any) => b.type === "constraint_warmup").map((b: any) => b.libraryBlockId).sort()
assert.deepEqual(next, ["nr", "rh", "sfnr"])

// ── ladder exercises: the plan prescribes the step the workout will suggest ──
// Knee push-up → Push-ups → Archer push-up; the plan's pick is Push-ups.
const ladderLib: any[] = exercises.map((e) => e.$id === "p1"
  ? { ...e, loadMode: "level", levels: [{ exerciseId: "ap", name: "Archer push-up" }] }
  : e)
ladderLib.push(
  ex("kp", "Knee push-up", "push", { loadMode: "level", levels: [{ exerciseId: "p1", name: "Push-ups" }, { exerciseId: "ap", name: "Archer push-up" }] }),
  ex("ap", "Archer push-up", "push", { loadMode: "level" }),
)
// One max force session with `rounds` logged at `level` (exercise id, name).
const pushSession = (id: string, date: string, level: [string, string], reps: string[], rpe: string) => ({
  $id: id, $createdAt: date, userId: "a",
  protocol: JSON.stringify([{ type: "strength_conditioning", exercises: [{ name: "Push-ups", exerciseId: "p1", focus: "max_force", reps: "4-6" }] }]),
  attempts: JSON.stringify(reps.map((r, i) => ({
    type: "strength_conditioning", blockIndex: 0,
    scData: { exerciseId: level[0], exerciseName: level[1], round: i + 1, rpe, repsCompleted: r, focus: "max_force" },
  }))),
})
const pushOf = (sessions: any[]) => buildScBlocks(plan, spec(1), ladderLib, sessions).blocks
  .flatMap((b) => b.exercises).find((e) => e.movementType === "push")!
// no history → the plan's pick
assert.equal(pushOf([]).name, "Push-ups")
// the athlete is on Archer push-ups and holding there → the plan says Archer push-up
const onArcher = [pushSession("s1", "2026-10-01T10:00:00Z", ["ap", "Archer push-up"], ["5", "5", "4"], "8")]
assert.equal(pushOf(onArcher).exerciseId, "ap")
// …and it's what the workout suggests for that block exercise (same rule)
for (const sessions of [[], onArcher, [pushSession("s1", "2026-10-01T10:00:00Z", ["p1", "Push-ups"], ["6", "6", "6"], "6")],
  [pushSession("s1", "2026-10-01T10:00:00Z", ["kp", "Knee push-up"], ["2", "1", "1"], "10")]]) {
  const prescribed = pushOf(sessions)
  const suggested = planFromHistory(prescribed, sessions as any, ladderLib, "kg").next?.level?.exerciseId
  assert.ok(!suggested || suggested === prescribed.exerciseId, `workout suggests ${suggested}, plan says ${prescribed.exerciseId}`)
}

console.log("all plan-workout tests passed")
