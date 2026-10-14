# Training plan

Last updated 2026-10-04. Branch `v2` (not committed yet). Describes what's
built. How it was built, phase by phase, is in
[`training-plan-implementation.md`](training-plan-implementation.md). The
per-block progression engine (4×4, intervals, sequence, S&C, constraint
warm-up rules) is in [`progression-spec.md`](progression-spec.md).

## 1. What this feature is

A coach gives each athlete a **6-week training plan**: 2 workouts a week, 12
in all. The plan has a **focus** (decides the warm-ups) and, optionally,
**S&C** (4 movement patterns, with or without mobility). The workouts follow a
**fixed rotation** — the app works out what workout *n* is; the coach taps
**Build**, reviews it in the workout builder and saves it. Nothing is saved
until the coach saves the workout.

One active plan per athlete. Plans are periods, not documents: starting a new
one archives the old one. A plan ends at its end date, even if fewer than 12
workouts were built.

There are no adaptation targets anymore — the rotation replaced them
(2026-10-03).

## 2. Files

| File | Role |
| --- | --- |
| `utils/planRotation.ts` | Pure. Plan constants, focuses, main blocks, dates, `workoutSpec` (what workout *n* is), `nextPlanIndex`, `planIsOver` |
| `utils/scPlanBuilder.ts` | Pure. S&C blocks for a workout: pattern order, exercise choice, special cases, mobility, layout |
| `utils/planWorkout.ts` | Pure. Whole workout as blocks (`buildPlanWorkout`), warnings, `withUpcomingWorkouts` |
| `utils/progression/constraintWarmup.ts`, `profiles.ts` | Constraint warm-up rotation + the focus → constraint table |
| `services/BoulderGraphService.tsx` | `training_plans` (create/update/delete/get/list), `listPlanWorkouts`, plan fields on protocols, `ExerciseRow.focuses` |
| `components/TrainingPlanModal.tsx` | Coach: new / edit plan |
| `components/AthleteAnalytics.tsx` | Coach: Training plan card — header, progress, next workout, Build |
| `components/AthleteWorkoutBuilder.tsx` | Saves plan workouts; "Save the S&C as its own workout" |
| `utils/planProgress.ts` | Pure. Athlete progress: workouts done (linked sessions, else block-id match), days, pace |
| `utils/workoutSummary.ts` | Pure. A workout as phases (S&C / warm-up / test / main) with estimated minutes — built or upcoming |
| `app/(tabs)/(buttonTabs)/plan.tsx` | Athlete: Plan page (read-only; the app's home when there's an active plan) |
| `components/SuggestedWarmupCard.tsx` | Builder: constraint warm-up for hand-built workouts (hidden for plan workouts) |
| `components/ExerciseForm.tsx` | Exercise editor: "Used for" focuses; no progression for mobility |
| `components/StrengthConditioningBlock.tsx` | Athlete S&C logging; simple Done card for mobility |
| `scripts/progression-tests/planWorkout.test.ts`, `constraintWarmup.test.ts`, `scHistory.test.ts`, `planProgress.test.ts`, `workoutSummary.test.ts` | Automated checks (run with `node --import ./scripts/progression-tests/alias-hook.mjs <file>`) |
| `scripts/tag-exercises/tag-exercises.mjs` | One-off: tagged the exercise library with movement patterns (2026-10-04) |

## 3. Data model (Appwrite)

**`training_plans`**

| Column | Type | Notes |
| --- | --- | --- |
| `athleteId` | string | |
| `name` | string | Defaults to "`<start> – <end>`" |
| `windowStart`, `windowEnd` | string `YYYY-MM-DD` | End = start + 6 weeks − 1 day, not editable |
| `status` | `"active"` \| `"archived"` | |
| `focus` | string | `strength` \| `power_endurance` \| `power` \| `technique` \| `fear_management`. Null on pre-v2 plans |
| `hasSc`, `hasMobility` | boolean | |
| `scPatterns` | string (JSON) | `[{ movementType, exerciseIds: [id1, id2?] }]` × 4, in pick order. Fingers has `[]` |
| `movementTypeFocus` | string (JSON) | Pre-v2 only — read, never written |
| `startType` | string, optional | Main type of workout 1: `strength` \| `power_endurance` \| `power`. Missing / null = strength. Only written when not strength (or to clear it) |

**`protocol`** (workouts) — plan fields, set only on workouts built from a plan:

| Column | Notes |
| --- | --- |
| `planId` | The plan it was built from |
| `planIndex` | 1–12, its place in the rotation |
| `planPart` | `"sc"` = S&C split off into its own workout. Same `planIndex` as its climbing workout; doesn't move the rotation |

**`workoutsession`** (sessions) — which workout a session was started from (added
2026-10-04, see [`redesign.md`](redesign.md) §7 phase 4): `protocolId`
(string), `planId` (string), `planIndex` (integer), all optional. Set when
the athlete starts a workout from Home, the Plan page or Settings › My
workouts; older
sessions have none. A split-off S&C session has its climbing workout's
`planIndex` — tell them apart through `protocolId` → `planPart`.

**`exercises`** — `movementType` (every S&C exercise must have one), and
`focuses` (JSON `Focus[]`, empty = all three; see §7.4), and `defaultHold`
(mobility that can be held as well as done by reps; see §7.3). Also
`loadStep` (optional Float, the smallest weight jump in kg — **not yet
added in Appwrite**, see [`sc-progression-plan.md`](sc-progression-plan.md) §7),
and `settingHarder` / `settingEasier` (optional String, the coach's hints for
an adjustable setting — **not yet added**, see
[`sc-modifications-plan.md`](sc-modifications-plan.md) §2.1). A missing
optional column only drops that value on save.

The old adaptation-targets table and `exercises.adaptation` values are still
in Appwrite but no longer read.

## 4. Lifecycle

- **Start** (`TrainingPlanModal`, `mode: "new"`): name, start date, focus,
  S&C (§7.1). `createTrainingPlan` saves the new plan, then archives every
  other active plan — so a failure never leaves the athlete without one, and
  stray duplicates get cleaned up.
- **Edit** (`mode: "edit"`): same fields, in place. Only workouts not built
  yet follow the change.
- **Delete**: removes the plan row. Workouts built from it are kept.
- **End**: once today is past `windowEnd`, or 12 workouts are built, the card
  shows "Start a new plan".
- **Pre-v2 plans** (no `focus`) can't be rotated; the card asks the coach to
  edit the plan and set a focus.

## 5. The rotation

`workoutSpec(plan, n, builtWorkouts, today)` in `utils/planRotation.ts`.
Next *n* = highest `planIndex` built + 1 (split-off S&C workouts don't count).
Counting *built* workouts (not completed sessions) means building two in a row
gives two different workouts.

| What | Rule |
| --- | --- |
| Main type | Fixed cycle **Strength → Power endurance → Power** (each 4 times in 12). Starts with Strength unless the coach picks another **first workout** type in the plan screen (`startType`, since 2026-10-14) — e.g. Power endurance → Power → Strength → … |
| Main block | Strength: Project Bouldering ↔ Max bouldering. Power endurance: Power endurance - 4x4 ↔ Base 1 (the `sequence` one). Power: Power boulders. Picked from what earlier workouts of the type **actually used** (see below). **Always twice in the workout** (same library block, back to back) |
| Warm-up | Alternates: odd workouts **3 constraints** for the plan's focus, even workouts **1 on 1 off** |
| Test | **Density test as homework** (since 2026-10-07) on workout 1 and on the first workout built in the plan's last week (week 6): the workout keeps its warm-up, the test is split off into a homework workout (§7.6) |
| S&C focus | Tied to the main type: Strength → **max force**, Power endurance → **hypertrophy**, Power → **explosiveness** |
| S&C exercise | Workout 1 of the week → each pattern's exercise 1, workout 2 → exercise 2 (by index parity) |

**Main block choice** (since 2026-10-06): read from the blocks of the earlier
built workouts of the same main type — their first block matching one of the
type's library blocks by name + type (newest build per slot). Rule: the block
used **fewer times** so far; on a tie, **not the one used last**; at the start,
the first listed. Earlier slots not built yet count with the block this rule
gives them; a built workout with neither block counts as its own slot's pick.
So a swap (⇄ on the coach card) or a block changed by hand in the builder
fixes the rest of the rotation by itself — e.g. workout 1 built with Max
bouldering → workout 4 is Project Bouldering. With no edits it's the plain
alternation in the table below.

**Order of a workout:** S&C → warm-up → main block × 2.

Example — plan with S&C, focus Technique:

| # | Week | S&C | Warm-up | Main block (×2) |
| --- | --- | --- | --- | --- |
| 1 | 1 | Max force (ex 1) | 3 technique constraints + **Density test** homework | Project Bouldering |
| 2 | 1 | Hypertrophy (ex 2) | 1 on 1 off | Power endurance - 4x4 |
| 3 | 2 | Explosiveness (ex 1) | 3 technique constraints | Power boulders |
| 4 | 2 | Max force (ex 2) | 1 on 1 off | Max bouldering |
| 5 | 3 | Hypertrophy (ex 1) | 3 technique constraints | Base 1 |
| … | | | | |
| 11 | 6 | Hypertrophy (ex 1) | 3 technique constraints + **Density test** homework (first in week 6) | Base 1 |
| 12 | 6 | Explosiveness (ex 2) | 1 on 1 off | Power boulders |

Library blocks are found by **name + block type** (constants in
`planRotation.ts`). A missing one is left out and reported as a warning.

## 6. Warm-ups

### 6.1 Constraint warm-ups

3 different `constraint_warmup` blocks per warm-up, picked by the rotation in
`constraintWarmup.ts` (least recently used first, never the same as last
time if avoidable; colours ramp `[flash − 2, flash − 1, flash]` within each
constraint's range; attempts 3 → 2 → 1). **No flash level → all on orange.**

**Colour exclusions** (`CONSTRAINT_COLOUR_EXCLUSIONS` in `profiles.ts`,
since 2026-10-14): a constraint can be barred from some colours whatever its
range says — today only **Feet on air: never on orange**. If the ramp puts
it on an excluded colour (e.g. flash blue or green, or no flash level), the
next constraint in line from the same group takes its place, else the least
recently used one from another group; with none left the warm-up has one
constraint fewer. Applies to plan workouts and the builder's suggestion
card.

Focus → constraints (`DEFAULT_CONSTRAINT_ROTATION` in `profiles.ts`; a
constraint's own settings saved in the block editor override it — none do
today):

| Focus group | Constraints |
| --- | --- |
| Technique | No re-adjustment, Silent feet, Relax the hand, Silent feet & no re-adjustment, Foot moves, One foot only |
| Strength / Power endurance (one shared list) | Feet on air, Hover hands, Sloth |
| Power | Ghost holds, Double hands, One hand only |
| Fear management | Falling Practice, Double hands, One hand only |

Old saved settings are read as: `strength` / `power_endurance` → the shared
group, `general` → technique.

### 6.2 1 on 1 off

The library `intervals` block named exactly "1 on 1 off", inserted with the
warm-up option on (`kind: "warmup"`, 4 rounds) and without its Power
endurance tag.

### 6.3 History

Both the constraint rotation and mobility (§7.3) read the athlete's sessions.
`withUpcomingWorkouts` puts plan workouts **built after the athlete's latest
session** in front of them, as if done, so the next workout doesn't repeat
them. Older sessions don't record which workout they came from (newer ones do —
§3 `workoutsession`), so "done" is judged by date.

## 7. S&C

### 7.1 Setup (plan screen)

1. S&C yes/no. 2. With mobility yes/no. 3. **Exactly 4** movement patterns
(mobility isn't one; patterns with no library exercises are greyed out).
4. **1 or 2 exercises per pattern** (auto-picked when the library has only
one). **Fingers / grip** (`carry_grip`) has no picks — it always uses fixed
exercises (§7.4). Exercises are fixed for the whole plan; history only drives
load/reps/level inside each exercise.

### 7.2 Layout

Every block **3 rounds**. Squat and hinge are never in the same block (the
patterns are swapped between blocks if needed).

| | Blocks | Rest between rounds |
| --- | --- | --- |
| With mobility | S&C 1: mp1 + mp2 + mobility · S&C 2: mp3 + mp4 + mobility | 1 min |
| | Mobility: mobility + mobility | 30 s |
| Without mobility | S&C 1: mp1 + mp2 · S&C 2: mp3 + mp4 | 2 min hypertrophy, else 3 min |

Every exercise is programmed for the day's S&C focus (reps from its range:
3–6 max force / explosiveness, 8–12 hypertrophy).

**Progression is per focus.** An exercise comes back with a different focus
each time (exercise 1: max force → explosiveness → hypertrophy → …), so the
athlete's weight / level prefill only looks at sessions **at the same
focus** (`findScSessions(…, { focus })` in `utils/scHistory.ts`); none → no
prefill. Each logged round now records its focus; older rounds get it from
the session's protocol. The coach's editor flag uses the exercise's focus for
"Next session: …"; its "already progressed to level X" line still looks at
any focus.

**How the weight / level moves** (added / dropped mid-session, deload, the
ladder, the coach's history) is specified in
[`sc-progression-plan.md`](sc-progression-plan.md) §3 and its Phase notes.

**Explosiveness follows max force** (2026-10-05): it never steps up from
reps (speed is up to the athlete). When the exercise's latest max force
session is newer than its last explosiveness one, explosiveness starts at
**half that weight** or **one level easier**. See
[`sc-modifications-plan.md`](sc-modifications-plan.md) §2.4.

**First time at a focus** (2026-10-05): the plan alternates a pattern's
two exercises while cycling the focus, so each exercise meets each focus
about every 3 weeks. When an exercise has no history at today's focus, its
start is borrowed from another focus: the weight is estimated from its
max force / hypertrophy session (e1RM), and a ladder starts one level
easier for hypertrophy or one harder for max force. Deload and "stuck"
count sessions across focuses. See
[`sc-modifications-plan.md`](sc-modifications-plan.md) §2.4b.

### 7.3 Mobility

The app picks the 4 mobility exercises (`movementType: "mobility"`), least
recently used first, no repeats in a workout. **Held = passive, reps =
active:** blocks 1–2 (between strength exercises) get one that can be
**held**, done as a hold; the mobility block 3 gets two that can be done by
**reps**. Short of a kind, any other mobility exercise is used in its own
way. In the exercise editor a mobility exercise is measured by **Reps**,
**Hold (seconds)** or **Both** (a default for each; stored as `unit: "reps"`
+ `defaultReps` + `defaultHold`). Mobility has **no focus or
progression**: its target is the exercise's default reps/seconds; the
exercise editor hides "Used for" and progression; the block editor shows just
a target; the athlete sees the target and **Done** (timer for timed ones), no
weight or RPE.

### 7.4 Which exercise

For each pattern, in order:

1. **Special case** for the day's focus, found by exact name:
   Fingers → Edge Lifts (max force) / repeaters (hypertrophy, 7/3s) / Jumps
   to Catch (explosiveness); Squat on explosiveness → Jumps into box.
   Missing → warning, then the plan's pick.
2. This workout's pick, if its **"Used for"** includes the day's focus.
3. The pattern's other pick, if it does.
4. Any library exercise of that pattern that does (warning).
5. Nothing → left out (warning).

"Used for" is set per exercise in the exercise editor (none = all three).

### 7.5 Split S&C

In the builder, **"Save the S&C as its own workout"** saves two workouts: the
climbing one and "… · S&C" (`planPart: "sc"`). The S&C one is extra — not one
of the 2 a week — and doesn't move the rotation.

### 7.6 Homework

Any block of an athlete's workout can be made **homework** in the builder
("Homework" row → pick blocks + deadline, 5 days by default). On save it goes
into its own workout (`planPart: "homework"`, `dueBy`, the slot's
`planId` / `planIndex` if any) that the athlete schedules themselves. It
never moves the rotation or counts as one of the 12. Status
(`utils/homework.ts`): not scheduled / scheduled / missed / can't attend /
overdue / done (a session started from it).

The coach's save pushes the athlete "You've got homework". The athlete
(Plan page / Home) picks a day and time up to the deadline, gets reminders
the day before and 1 hour before (with **I can't attend** / **Reschedule**),
and can say they can't attend with a message — the coach is pushed either
way. With days left after "can't attend" the athlete picks another; with
none the coach decides. Athlete writes go through the `aiProtocol`
function's `homeworkUpdate` action. Details:
`training-plan-implementation.md` §9–10.

### 7.7 Coached blocks

A block the coach runs in person is **coached** (`coached: true`), set by
the coach in the builder (**Coached** row) or by the athlete mid-workout
("Coach is here?"). It keeps its type, so the rotation is unchanged (a
coached Max bouldering still counts for the alternation). The athlete sees
the title + Done; on sequence blocks they save each sequence the coach set
(Original only, level 1–8) with attempts and sends. Progression skips
coached runs except those sequences, which count like guided sessions on
their route. Details: `training-plan-implementation.md` §12.

## 8. Coach screens

- **Training plan card**: name, dates, focus, S&C patterns (+ mobility),
  "n of 12 workouts built", and the **next workout**: S&C focus, warm-up kind,
  main block × 2, with **Build**. **⇄ Swap** next to the
  main block switches it to the type's other block (Project ↔ Max, 4×4 ↔
  Base 1; hidden for Power) for that workout only; Build uses it, and the
  rotation then balances (§5). On a test workout: "+ Density test as
  homework".
- **Homework section**: each homework's deadline, workout and status, with
  the athlete's message if they can't attend. Tap one to **set a new
  deadline** (the athlete is pushed and picks a day again) or **cancel**
  it.
- **Build**: re-reads sessions, the plan's workouts and the exercise and
  block libraries (so library edits are always picked up), generates the
  workout, shows any warnings ("Check this workout"), then opens the builder
  with the blocks. Saving stores `planId` / `planIndex` and the card moves on.
- The builder's "Suggested warm-up" card is only for hand-built workouts.

## 9. Adaptation tags

Blocks still carry an `adaptation` tag (analytics colours and labels).
Current list: technique, strength, power, power endurance, conditioning,
balance, fear management, general, test.

- **Removed 2026-10-04:** coordination / RFD, tension (and endurance
  earlier). Blocks still tagged with them fall back to their block type's
  default.
- **`general`**: only the fallback for untagged free / exploration sessions;
  can't be picked.
- Technique and fear management are trained through warm-ups; conditioning is
  covered by S&C; balance isn't in the plan yet; test = the Density test.

## 10. Later / open items

- ~~**Plan progress for athletes**~~ — done 2026-10-04: the athlete's Plan
  page (focus + S&C patterns, timeline, workouts done / left by main type,
  latest workout) — the app's home when there's an active plan. See
  [`redesign.md`](redesign.md) §4.
- **More constraints** for Strength/PE, Power and Fear management (3 each →
  every warm-up for those focuses is the same 3; Power and Fear management
  share 2). Free-session candidates in the library: Traverse / Precision Swap
  Traverse, El juego de pies (technique), Lances, potencia: Saltos,
  Coordination boulders (power), Blindfolded Climbing Partner Drill
  (technique or fear management).
- **Balance**: warm-up drill(s) and a slab free-session block (200 mov, Slab
  are candidates).
- **S&C tests** at the start / end of a plan.
- **A second hinge exercise** in the library (only KettleBell Deadlift today,
  so both weekly workouts get it).
- **Tag exercise limits** ("Used for") — until tagged, an exercise counts as
  usable for every focus (e.g. a max-force squat can fall back to Jumps into
  box).
- **Appwrite:** an index on `protocol.planId` if queries complain; delete
  the old targets table whenever convenient.
- **Split S&C** is two writes — if the second fails, the climbing workout is
  saved without its S&C (the error is shown).
- **Not tested on a device yet** — coach screens need a login; checked by
  type-check, automated tests and a web build only.
- **Security (separate task):** `blocks` and `exercises` are readable with
  no login; check sessions / users permissions.
