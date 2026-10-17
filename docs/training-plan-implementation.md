# Training plan v2 — implementation plan

**All phases done 2026-10-04; phases 7–10 (swap + homework) 2026-10-07.** Not committed. Not yet tried on a device. Implemented
what was then [`training-plan.md`](training-plan.md) §8 (remove `Method`)
and §9 (new plan structure) — that doc now describes the result; section
numbers below refer to its old layout. Each phase leaves the app working; phases 2–5 are code and
each needs a go-ahead.

## 0. Library data prep (coach, in the app — no code)

Checked against the live library on 2026-10-03.

**Exercises** — the generator picks S&C exercises by movement pattern, but
41 of 50 library exercises have **no pattern**:

- Tag every S&C exercise with its pattern in the exercise editor.
- `Inverted Row` is tagged `pull`, which isn't a valid pattern anymore —
  re-tag as `pull_horizontal`.
- `kneeling lunge stretch` is tagged `squat` — should be `mobility`.
- **No exercise is tagged `mobility`** (Shoulder mobility, pancake, Frogs,
  shoulder stretch, Standing Hamstring stretch, Lunge stretch with knew,
  wrist rotations, roller… need it). Without these, "with mobility" plans
  get no mobility exercises.
- Duplicates: `Edge Lifts` / `edge lifts`. Keep one.
- Special cases need these exact exercises (§9.5):
  - Fingers (`carry_grip`): `Edge Lifts` (max force), `repeaters` — the
    only 7/3s-type exercise (hypertrophy), `Jumps to Catch` (power, already
    tagged).
  - Squat power: `Jumps into box` (= box jumps), tag it `squat`.

**Blocks**

- Main blocks found: `Project Bouldering` (project_bouldering),
  `Max bouldering` (sequence), `Power endurance - 4x4` (four_by_four),
  `Base 1`, `Power boulders` (free_session), `Density test`
  (exploration_session), `1 on 1 off` (intervals). ✅
- **`Base 1` exists twice** — a `sequence` and a `free_session`. The plan
  uses the `sequence` one; delete or rename the other.
- All 12 constraint warm-ups exist. ✅
- **Create** a `Falling practice` block of type `constraint_warmup`.

## 1. Appwrite schema (you, in the console)

| Table | Column | Type | Notes |
| --- | --- | --- | --- |
| `training_plans` | `focus` | string | `strength` \| `power_endurance` \| `power` \| `technique` \| `fear_management` |
| `training_plans` | `hasSc` | boolean | |
| `training_plans` | `hasMobility` | boolean | |
| `training_plans` | `scPatterns` | string (JSON) | `[{ movementType, exerciseIds: [id1, id2?] }]` × 4 |
| `protocol` (workouts) | `planId` | string, optional | workout was generated from this plan |
| `protocol` (workouts) | `planIndex` | integer, optional | 1–12, position in the plan |
| `protocol` (workouts) | `planPart` | string, optional | `"sc"` for a split-off S&C workout |

`movementTypeFocus` on `training_plans` becomes unused (replaced by
`scPatterns`); leave the column, stop writing it.

**Why `planIndex` on workouts:** the rotation needs to know "which of the
12 is next". Completed sessions don't record which workout they came from,
so the position is tracked on the workouts the coach builds: next index =
highest `planIndex` built for this plan + 1. This also fixes "suggestions
ignore already-built workouts" (review item 1.5).

## 2. Pure logic + tests

All pure (no React, no Appwrite), tested like the existing
`scripts/progression-tests/*.test.ts`.

### 2a. `utils/planRotation.ts` (new)

`workoutSpec(plan, index) → WorkoutSpec` — everything about workout *n*
that follows from the plan alone:

```ts
interface WorkoutSpec {
  index: number                 // 1–12
  week: number                  // 1–6
  mainType: "strength" | "power_endurance" | "power"   // (index-1) % 3
  mainBlock: { name: string; type: BlockType }         // alternates within the type
  warmup: "constraints" | "one_on_one_off"             // odd → constraints
  scFocus: Focus | null                                // matched to mainType; null if !hasSc
  exerciseSlot: 0 | 1                                  // 1st / 2nd workout of the week
  withTest: boolean                                    // see below
}
```

`withTest` = workout 1, or the **first workout built in the plan's last
week** (week 6 by calendar, from `windowStart`). The plan ends at its end
date even if fewer than 12 were built (Q3), so the end test can't wait for
workout 12. Needs the plan's already-built workouts (`$createdAt`) to know
whether week 6 has one yet.

Main blocks are referenced by **name + type** (`Base 1` exists twice).
Tests: the §9.6 example table, block alternation, test on workout 1 and
on the first week-6 workout only.

### 2b. Warm-up focuses — `utils/progression/profiles.ts`, `constraintWarmup.ts`

- `WarmupPillar` → the 5 focuses. `DEFAULT_CONSTRAINT_ROTATION` rewritten
  to §9.9b (incl. Falling practice).
- `normalizePillars` maps settings saved on library blocks the old way:
  `strength_power_endurance` → strength + power_endurance, `power` →
  power, `general` → technique. A block's own saved settings override the
  default table, so if Double hands / One hand only were edited in the
  block editor, fear_management must be added to them there.
- Block editor's rotation picker shows the 5 focuses.
- `suggestWarmup(…, flash)`: no flash → all 3 constraints on **orange**
  (today it returns null).
- Remove the `general` fallback from the pool filter.
- Update `constraintWarmup.test.ts`.

### 2c. S&C builder — `utils/scPlanBuilder.ts` (new)

`buildScBlocks(plan, spec, exercises, sessions) → StrengthConditioningBlock[]`

1. Order the 4 patterns so **squat and hinge land in different blocks**
   (swap mp2 ↔ mp3 if needed).
2. Exercise per pattern = `exerciseIds[spec.exerciseSlot]`, falling back to
   `exerciseIds[0]` when there's only one.
3. Special cases override the pick: `carry_grip` (fingers) → Edge Lifts /
   repeaters / Jumps to Catch by focus; `squat` + power → Jumps into box.
   Found by **exact name**; if one is missing, fall back to the chosen
   exercise (fingers has none — skip it) and return a warning.
4. Every exercise gets `focus = spec.scFocus`; load/reps/level come from
   history as today (`scHistory.ts`, `scProgression.ts`).
5. Layout, **every block 3 rounds**:

   | | Blocks | Rest between rounds |
   | --- | --- | --- |
   | With mobility | 1: mp1+mp2+mobility, 2: mp3+mp4+mobility | 1 min |
   | | 3: mobility+mobility | 30 s |
   | Without mobility | 1: mp1+mp2, 2: mp3+mp4 | 2 min if hypertrophy, else 3 min |
6. Mobility: the app picks from `mobility`-tagged exercises, least recently
   used first, no repeats within the workout. Passive/active ignored for
   now (§9.10).

Tests: squat/hinge split, single-exercise fallback, special cases per
focus, mobility layout, exercise slot alternation.

### 2d. `utils/planWorkout.ts` (new) — replaces `methodSelection.ts`

`buildPlanWorkout(spec, plan, library, exercises, sessions, flash) → Block[]`
= S&C blocks → warm-up → main block × 2 (`MAIN_BLOCK_COPIES`, same library
block twice). When `withTest`, the Density test replaces the warm-up:
S&C blocks → Density test → main block × 2.

- Constraint warm-up: `suggestWarmup` for `plan.focus`, as 3
  `constraint_warmup` blocks (existing `warmupBlocks`).
- 1 on 1 off: clone `1 on 1 off` with `kind: "warmup"` and no adaptation
  tag.
- Main block / Density test: clone the library block by name + type. If
  missing → blank default of that type named after it, and a warning
  returned to the UI.
- Returns `{ blocks, warnings }` so the card can show "No mobility
  exercises in the library", "Falling practice block missing", etc.

### Phase 2 status — done 2026-10-03

Built: `utils/planRotation.ts`, `utils/scPlanBuilder.ts`,
`utils/planWorkout.ts`; warm-up groups and default table in
`utils/progression/profiles.ts` + `constraintWarmup.ts`; tests in
`scripts/progression-tests/planWorkout.test.ts` and an updated
`constraintWarmup.test.ts`. Not wired into any screen yet (phase 4).

Differences from the plan above:
- Warm-up groups are 4, not 5: `strength_power_endurance`, `power`,
  `technique`, `fear_management` — strength and power endurance share one
  list, so they keep one key (no migration). `warmupPillarFor(plan.focus)`
  maps the plan focus to its group.
- Falling Practice's colour range: `two_below_flash` (my pick — change in
  the block editor or the default table).
- A missing main/test library block is **left out with a warning**, not
  replaced by a blank block — the builder lets the coach add it.
- `SuggestedWarmupCard` (builder) already shows the 4 groups and works with
  no flash level (orange), since its old "no flash → nothing" rule no longer
  exists in the engine.
- `exerciseFromLibrary` (workoutBlocks) now shares its body with the
  generator (`exerciseDraftFromLibrary`).
- Known limit: warm-up rotation only sees **completed** sessions, so two
  plan workouts built back to back before either is done can get the same
  constraints. Can be fixed in phase 4 by feeding the built-but-not-done
  workouts into the usage history.

## 3. Plan creation — `components/TrainingPlanModal.tsx`

New flow (`mode: "new"`):

1. Name + start date. End date = start + 6 weeks, shown, not editable.
2. **Focus** — single choice of 5.
3. **S&C?** — if yes: **mobility?**, then **4 patterns** (exactly 4,
   required), then **2 exercises per pattern** from that pattern's library
   exercises (auto-selected when only one exists). **Fingers
   (`carry_grip`) skips this step** — it always uses the fixed exercises.
4. Save → `createTrainingPlan`.

Service changes (`BoulderGraphService.tsx`):
- `TrainingPlanRow` + create/update: new columns; parse `scPatterns`.
- `createTrainingPlan`: **stop creating default targets**; archive *every*
  active plan, not just the first (fixes the two-active-plans bug); create
  the new plan **before** archiving the old ones, so a failure doesn't
  leave the athlete with none.
- `updateTrainingPlan`: drop the target-moving code.
- `deleteTrainingPlan`: drop target deletion.
- Disable the save button while saving (double-tap → two plans).

`mode: "edit"`: same fields. Changing S&C/patterns affects only workouts
not built yet.

### Phase 3 status — done 2026-10-04

Built: new `TrainingPlanModal` (name, start date → end shown as start + 6
weeks, single focus, S&C toggle, mobility toggle, exactly 4 patterns in
pick order, 1–2 exercises each — at least 1 required, auto-picked when the
library has only one, none for fingers), and the service changes above.

Notes:
- Patterns with no library exercises are greyed out ("· none").
- `carry_grip` is now labelled **"Fingers / grip"** everywhere.
- `createTrainingPlan(athleteId, input)` no longer creates targets and
  archives *every* other active plan after creating the new one.
  `updateTrainingPlan` / `deleteTrainingPlan` no longer touch targets
  (existing target rows stay in Appwrite, untouched).
- The "review the previous plan's targets" box in the modal is gone.
- Until phase 4, the coach card still shows the old targets/"Suggest
  next 3"; a new plan has no targets, so its suggestions are empty.
- Not checked on a device: the web build bundles and loads, but the coach
  screen needs a login.

## 4. Coach card + builder — `AthleteAnalytics.tsx`, `AthleteWorkoutBuilder.tsx`

> Since 2026-10-16 the coach card lives in `components/coach/PlanCard.tsx`
> (`AthleteAnalytics.tsx` is gone — docs/coach-dashboard.md).

**Card:** replace targets + "Suggest next 3" with:
- Plan header: name, focus, dates, "Workout *n* of 12".
- **Next workout** preview from `workoutSpec` (main block, warm-up kind, S&C
  focus, test) + any warnings.
- **Build** → `buildPlanWorkout` → opens `AthleteWorkoutBuilder` with the
  blocks, `planId`, `planIndex`.
- The plan **ends at its end date** (even if fewer than 12 were built), or
  after 12 built → "Review & start new plan".

**Builder:**
- Saves `planId` / `planIndex` on the workout (`createProtocol`).
- **"Split S&C into its own workout"** toggle (only when built from a plan
  with S&C): saves two workouts — climbing (`planIndex` n) and S&C
  (`planIndex` n, `planPart: "sc"`). The rotation counts climbing workouts
  only.
- `SuggestedWarmupCard`: switch its pillar chips to the 5 focuses
  (default = active plan's focus).

### Phase 4 status — done 2026-10-04

Built:
- **Coach card** (`AthleteAnalytics.tsx`): plan name, dates, focus, S&C
  patterns, "n of 12 workouts built", and a **Next workout** preview (S&C
  focus, warm-up kind or Density test, main block) with **Build**. Targets,
  "+ Add" and "Suggest next 3" are gone from the card. Plans made before v2
  (no focus) show "edit it to set a focus".
- **Build** re-reads sessions and the plan's workouts, generates the
  workout, shows any warnings ("Check this workout"), then opens the builder.
- **Builder** (`AthleteWorkoutBuilder.tsx`): saves `planId` / `planIndex`;
  **"Save the S&C as its own workout"** switch → two workouts, the S&C one
  with `planPart: "sc"` (doesn't move the rotation). The manual "Suggested
  warm-up" card is hidden for plan workouts.
- `listPlanWorkouts(planId)`; `createProtocol` takes the plan fields.
- `withUpcomingWorkouts`: plan workouts built after the athlete's latest
  session count as "last time" for the warm-up and mobility rotation (fixes
  the phase 2 known limit). Tested.

Notes:
- Queries `planId` on the protocol table — if Appwrite complains about a
  missing index, add one on `planId`.
- Split save is two writes: if the second fails, the climbing workout is
  saved without its S&C (the error is shown).
- Editing a saved plan workout keeps its plan fields (they aren't touched).

### S&C exercise limits + mobility — done 2026-10-04

- **Appwrite:** add a `focuses` column (string, ~64 chars) to `exercises`.
  Until it exists, saving an exercise silently drops the field (existing
  optional-column fallback), so limits won't stick.
- `ExerciseRow.focuses` (JSON `Focus[]`, empty = all); exercise editor
  "Used for" chips; plan screen shows limits on exercise chips.
- Generator (`scPlanBuilder.exerciseForPattern`): this workout's pick → the
  other pick → any fitting library exercise of the pattern (warning) →
  left out (warning). Tested.
- Mobility: hidden progression/focus in exercise and block editors;
  `MobilityExerciseUI` in the athlete's S&C logging (target + Done, timer
  for timed ones); progression seeding skips mobility; mobility exercises
  get the library's default reps as their target.
- Tag the restricted exercises in the library (e.g. Jumps into box,
  Jumps to Catch → Explosiveness only), otherwise they count as usable for
  all three.

## 5. Removal

- Drop `ExerciseRow.adaptation` (its picker was removed from the exercise
  editor 2026-10-04; only `methodSelection.ts` still read it).
- Delete `utils/methods.ts`, `utils/methodSelection.ts`,
  `components/AdaptationTargetModal.tsx`.
- Remove targets from `AthleteAnalytics.tsx`, the athlete home "My
  adaptations" card (`app/(tabs)/(buttonTabs)/index.tsx`) and
  `adaptationProgress` in `athleteAnalytics.ts`. Service functions for
  targets go too; **the Appwrite table and its rows are left alone** (you
  decide later, §9.10).
- `utils/adaptations.ts`: remove `coordination_rfd` and `tension`; hide
  `general` from the picker (keep it as the fallback label, §9.7);
  drop `ADAPTATION_TIER`. Blocks already tagged with removed adaptations
  fall back to their type's default — check the analytics pie still reads
  sensibly.

### Phase 5 status — done 2026-10-04

Removed:
- `utils/methods.ts`, `utils/methodSelection.ts`,
  `components/AdaptationTargetModal.tsx`.
- Target service code (`AdaptationTargetRow`, `getAdaptationTargets`,
  `saveAdaptationTarget`, `deleteAdaptationTarget`, the table id) and
  `adaptationProgress`. **The Appwrite targets table and its rows are
  untouched** — delete them in the console whenever you like.
- Athlete home "My adaptations" card (and its target/plan fetch).
- `coordination_rfd` and `tension` adaptations, and `ADAPTATION_TIER`.
  Blocks still tagged with them fall back to their block type's default
  colour/label. `general` stays only as the fallback (already not
  pickable in the block editor).
- `ExerciseRow.adaptation` (existing values stay in Appwrite, unread).
- Unused coach-card styles.

Kept: the builder's "Suggested warm-up" card (for hand-built workouts) —
now uses `constraintWarmupDrafts` from `utils/planWorkout.ts`.

## 6. Docs

Rewrite `training-plan.md` §1–§7 to describe what was built, fold §8–§9 in,
and keep §9.10 as the "later" list.

### Mobility reps / hold — done 2026-10-04

- **Appwrite:** add a `defaultHold` column (string, ~16 chars) to
  `exercises`. Until then "Both" won't save its hold default (the existing
  optional-column fallback drops it).
- Exercise editor: mobility measured by Reps / Hold (seconds) / Both.
- Generator: held (passive) mobility in blocks 1–2, reps (active) in block
  3; fallback to any mobility exercise. Tested. Replaces the parked
  "passive/active" item.

### Phase 6 status — done 2026-10-04

`training-plan.md` rewritten to describe what's built (old §8–§9 folded in;
"later" list in its §10). Short "superseded" notes added to
`progression-spec.md` (§3.5, §4) and `progression-handoff.md` (§4.6, §5.4).

## 7–10. Main-block swap + homework (planned 2026-10-06)

### 7. Swap + rotation fix — done 2026-10-06

- `planRotation.ts`: `BuiltPlanWorkout.blocks` (the row's blocks JSON);
  `mainTypeFor`, `builtMainBlock`, `alternateMainBlock`; the main block now
  comes from what earlier workouts of the type used (rule in
  `training-plan.md` §5), not `occurrence % 2`.
- Callers pass `blocks`: `AthleteAnalytics.tsx` (coach card),
  `plan.tsx` (athlete Plan page — future slots now follow a swap too).
- Coach card: **⇄ Swap** on the next workout's main-block line (state keyed
  to that workout's index, so it drops once it's built).
- Tests in `planWorkout.test.ts`: swap on workout 1, hand edits, rebuilt
  slot, the free-session Base 1, rows without blocks, swap targets.
- Not checked on a device (coach screen needs a login). No Appwrite change.

### Homework flow (coach 2026-10-07)

Coach marks a block (or blocks) of a workout as homework → the athlete gets
"You've got homework" → places it on a day in the plan calendar, like an
event in Google Calendar → gets reminders (day before + day of) → from the
reminder: **Can't attend** (short message, coach is notified) or
**Reschedule** (back to the calendar).

### 8. Homework — coach side — done 2026-10-07

- `utils/homework.ts` (new, pure): `HOMEWORK_DAYS` = 5, `defaultDueBy`,
  `dueByOf`, `homeworkStatus` → not scheduled / scheduled / missed (day
  passed, deadline not) / can't attend / overdue (deadline passed) / done
  (a session with its `protocolId`, wins over everything). Tested in
  `homework.test.ts`.
- **Deadline** (coach 2026-10-07): 5 days from today by default; the coach
  moves it with −/+ in the builder. (Replaces "same plan week".)
- **Builder** (`AthleteWorkoutBuilder.tsx`, athlete workouts only): a
  "Homework" row → picker of the workout's blocks + deadline. On save the
  marked blocks go into their own workout (`planPart: "homework"`,
  `dueBy`, the slot's `planId` / `planIndex` when it has one; named after
  its block if it's just one). The whole workout can be homework when new;
  editing must leave a block. Save order (fixed 2026-10-10): homework
  first — if it fails nothing is saved and the builder stays open with the
  blocks still marked; if the workout then fails, the homework is deleted
  again. The athlete push goes out only once both are saved.
- **Density test always homework:** `buildPlanWorkout` returns it in
  `homework`; the workout keeps its warm-up. Build opens the builder with the
  test pre-marked as homework. `summarizeSpec` lost `withTest` (the Plan
  page no longer shows the test in place of the warm-up).
- **Filters:** `planPart !== "sc"` → `!planPart` everywhere (plan progress,
  coach card, Plan page, latest-workout card) so homework never counts as a
  plan workout or takes the week-6 test slot. `sessionLinkFor` no longer
  copies `planId` / `planIndex` onto sessions of S&C / homework workouts.
- **Coach card:** "+ Density test as homework" on test workouts; a Homework
  section with each one's deadline, workout and status (+ the athlete's
  message when they can't attend). Done ones drop off after 3 weeks.
- `listAthleteHomework(athleteId)` in the service.
- Checked: all tests, type-check, web build. **Not checked on a device /
  logged in.**
- **Appwrite (you):** `protocol.dueBy` — string, optional, size ~10. Until
  it exists, saving homework fails with "Homework not saved" and nothing is
  saved. Phases 9–10 also need `scheduledFor` (string, ~30),
  `homeworkStatus` (string, ~20) and `homeworkNote` (string, 300) — see
  "Before testing" below.

### 9. Server — `aiProtocol` function — done 2026-10-07

Two new actions (free tier: 2 functions), ahead of the Anthropic key check:

- `homeworkAssigned` `{ homeworkId, dueLabel }` — caller must be a coach;
  pushes the homework's athlete "You've got homework: <name> … Pick a day
  before <due>" (`data.type: "homework_assigned"`). Called fire-and-forget
  by the builder after it saves homework.
- `homeworkUpdate` — caller must be the homework's athlete:
  `{ homeworkId, scheduledFor, day, whenLabel }` (day ≤ `dueBy`, else 400)
  or `{ homeworkId, cantAttend: true, note }`. Writes the row with the
  server key, then pushes every coach ("Ana scheduled Density test for Sat
  10 Oct, 6:00 PM" / "Ana can't do Density test: \"sick\"").
- If the function call fails, the app tries writing the row directly
  (works only if athletes can write it; no coach push then).
- Tested locally against a mocked Appwrite + Expo (roles, ownership,
  deadline, writes, push text). **Not deployed.**
- **You:** redeploy `functions/aiProtocol`; give its `APPWRITE_API_KEY`
  **write** access to the database (rows.write / documents.write — it only
  had read).

### 10. Homework — athlete side — done 2026-10-07

- `components/HomeworkSection.tsx` on the Plan page (between "Up next" and
  the plan) and on Home (no plan). Per open homework: status line, **Pick a
  day / Move**, **I can't attend** (when scheduled or missed), **Start**
  (any time; done = a session from it). Overdue ones stay 7 days.
- **"You've got homework"** sheet: once per homework (remembered in
  AsyncStorage) for ones without a day.
- **Day + time picker:** day strip today…deadline, time in ±15 min / ±1 h
  steps (default 6:00 PM); a time already past is refused.
- **Can't attend:** optional message → "Your coach will be notified". Days
  left (not counting the day they just dropped) → "Pick another day";
  none → "your coach will decide what's next".
- **Timeline:** a picked day shows as a pink-ringed cell with a dot
  ("Homework" in the legend).
- **Reminders** (`services/homework.ts`, rules in `utils/homework.ts`
  `homeworkReminders`, tested): the day before at the same time and 1 h
  before (with **I can't attend / Reschedule** buttons); the morning after
  a picked day (9:00) in case it didn't happen; 2 days after it was given
  (10:00) if no day is picked. Cancelled and rebuilt from the rows every
  time the card loads (app open, pull-to-refresh, after a workout).
  Nothing on web; nothing without notification permission.
- **Tapping a notification** (`HomeworkNotificationRouter` in the tabs
  layout): goes home and opens the picker / can't-attend sheet for that
  homework (cold start too).
- Checked: tests, type-check, and the card + all three sheets rendered in
  the browser with fake data (phone width). **Not on a device:** real
  notifications, their buttons, and the push round-trip need a phone build.

### 11. Coach: extend / cancel — done 2026-10-10

- Tap a homework on the coach's Homework list (not done ones) →
  `HomeworkCoachSheet`: **Set deadline** (−/+, starts 2 days past the later
  of the current deadline and today) writes `dueBy`, clears a "can't
  attend" + its message, and pushes the athlete "More time for your
  homework … now due <day>" (`homeworkAssigned` with `extended: true`).
  **Cancel homework** (confirm) deletes the homework workout; sessions
  already done from it stay.
- Athlete updates keep going to every coach (coach 2026-10-10).
- Known gap: a cancelled homework's reminders already on the athlete's
  phone stay until they next open the app (then they're cleared); tapping
  one in between just opens the app.
- Checked: type-check, function test (extended push), the sheet rendered in
  the browser with fake data.

### Before testing homework (you)

1. Appwrite `protocol` table: add `dueBy` (string, 10), `scheduledFor`
   (string, 30), `homeworkStatus` (string, 20), `homeworkNote` (string,
   300) — all optional.
2. `aiProtocol` function: give `APPWRITE_API_KEY` write access to the
   database, then redeploy `functions/aiProtocol`.
3. Ship it to a phone. No new native modules (expo-notifications is
   already in the build), so an update should do; reminders and pushes
   don't work in the web build.

### Answered 2026-10-07

- Day + time. Reminders: the day before (same time) and 1 hour before.
- Any day up to the deadline: 5 days by default, the coach can change it
  (replaces "same plan week").
- Density test: always homework (no plan setting — §11 dropped).

- After "Can't attend": depends on the days left — days left before the
  deadline → the athlete reschedules; none → the coach decides.

## 12. Coached blocks — done 2026-10-10

The plan's blocks are built for when the coach isn't there. When the coach
is, they run the block live (attempts and rest on project bouldering, the
sequences for Max bouldering / Base 1, the warm-up on the fly), so the app
mustn't make the athlete log it as if alone.

Decided (coach 2026-10-10):
- **Per block.** A block is either **guided** (the app runs it, as today)
  or **coached** (the coach runs it).
- **Who sets it:** the coach in the builder, before the workout is built,
  or the athlete during the workout ("coach is here").
- **Sequence blocks** (Max bouldering, Base 1): the athlete saves the
  sequence the coach made up — as a spray-wall route with its difficulty —
  so it can be used later.
- No change to the Density test (homework).

- **Coached sequences** (coach 2026-10-10): Original only (no Easier /
  Harder); the athlete logs **attempts and sends**; they **count for
  progression**; **several sequences** per block.

**Unchanged:** the rotation (main type, main block, S&C focus, test) — a
coached block is still that workout's block, the workout still counts as
one of the 12, and a coached Max bouldering still counts for the
Project ↔ Max alternation.

### 12a. The flag + setting it

- `coached?: boolean` on every block (`BaseBlock` in `workoutBlocks.tsx`),
  saved with the workout and copied into the session's protocol.
- **Coach, builder:** a "Coached" row like the Homework one → pick the
  blocks the coach will run. Shown on the block cards as a "Coached" tag.
- **Athlete, in the workout:** each block's intro gets **"Coach is here"**
  (and back to "On my own" before anything is logged). Only changes this
  session's copy, not the workout.

### 12b. Running a coached block (athlete)

A coached block **keeps its own type** (sequence, project_bouldering,
constraint_warmup …) and only gets `coached: true`; the workout screen
**runs it with the free-session screen** instead of its own (coach
2026-10-10: "basically a free session"). Not converted to a real
`free_session`, because the type + name + library id are what the rotation
(Project ↔ Max alternation), progression history and adaptation tags
match on.

- **Every coached block:** the free-session screen in a coached mode —
  the block's **title** and **Done**. No timer, no note, no data. Logs one
  `{ coached: true }` marker.
- **Coached sequence blocks** (Max bouldering, Base 1): the same screen
  plus **+ Add sequence** → the existing spray-wall route builder, type
  preset from the block, Original only, the athlete sets the level (1–8).
  Saved as the athlete's own route. Then **attempts** and **sends** for it.
  Repeat for more; **Done** ends the block. Logged as attempts on each route
  (`routeId`, `variation: "original"`, `success` = sends of them,
  `coached: true`).

### 12c. Algorithm

- `findBlockRuns` (`utils/blockHistory.ts`, the one place progression reads
  history): drops coached runs — so project, 4×4, intervals, S&C and
  warm-up progression continue from the last guided run, never from a
  "zero" coached one.
- **Except sequences:** a coached sequence block becomes one run per route,
  in the order logged, so each counts like a guided session on that route:
  ≥ 80 % sends = passed; passes count toward the 4 needed to level up; the
  next guided Max bouldering / Base 1 is picked from the last one (and can
  pick the coach's saved routes later — they're the athlete's own).
- Constraint warm-up rotation: a coached warm-up has no constraints, so it
  doesn't use the rotation up (already true — verify).
- Duration estimates (Plan page timings) ignore coached runs.

### 12d. Coach view

- Session detail: "Coached" tag on those blocks; for sequences, each route
  with level and sends / attempts.

### Status — done 2026-10-10

- **12a** `coached?: boolean` on `BaseBlock` / the runtime `Block` /
  `Attempt`. Builder: a **Coached** row (next to Homework) → pick blocks;
  the flag lives on the block, so it saves with the workout (stripped from
  homework blocks — homework is done alone). Workout: a **"Coach is
  here?"** pill under the header (green "Coach is here · switch to on my
  own" when on) until anything's logged on the block —
  `WorkoutContext.setBlockCoached`, this session's copy only.
- **12b** `components/CoachedBlock.tsx`, used for any coached block by
  `blockRenderer.tsx`: free-session look, "Coached" badge, title, Done (logs
  `{ success: true, coached: true }` if nothing else). Sequence blocks add
  "Your coach's sequences" + **Add sequence** → wall picker (if several) →
  `SprayWallBuilder` with the new `originalOnly` prop and the type preset
  (the assigned route's type, else "Max…" in the name → Max bouldering,
  else Base); level defaults to 4, the athlete sets it → saved as the
  athlete's route → **attempts / sends** sheet → logged as attempts.
- **12c** `findBlockRuns` skips coached runs, except sequences (one run per
  route); `warmupUsage` ignores coached warm-ups; duration history ignores
  coached blocks. Builder's "recent sessions" summary doesn't count the
  Done marker as an attempt. Tested in `coached.test.ts` (incl. 4 coached
  passes → level up).
- **12d** Session detail: "Coached" pill; coached sequences listed with
  name, level and sends / attempts; other coached blocks "Run by the coach".
- Checked: tests, type-check, web build; the coached screen (sequence and
  plain) and the Original-only builder rendered in the browser with fake
  data. **Not checked:** saving a sequence + the attempts / sends sheet
  (needs a login), the header switch inside a real workout, on a device.
- Not done: a "Coached" tag on the builder's block cards (the Coached row
  lists them instead).

### Answered 2026-10-10

- Coached non-sequence blocks record nothing: title + Done.
- The athlete can switch a coached block back to "on my own" (before
  anything is logged).
- The athlete sets a coached sequence's level.

## Decisions (2026-10-03)

- **S&C rounds:** 3 per block, always. Rest: 1 min in blocks 1–2 with
  mobility, 30 s in the mobility block; without mobility 2 min for
  hypertrophy, 3 min otherwise.
- **Fingers:** no exercise picking — always Edge Lifts / repeaters (7/3s) /
  Jumps to Catch.
- **Plan end:** at the end date. End Density test goes on the first
  workout built in week 6.
- **Special-case exercises:** exact name + warning when missing.

## Out of scope (separate tasks)

- **Public read access:** `blocks` and `exercises` are readable with no
  login. Check sessions/users permissions.
- Review items that disappear with this redesign: targets linked by window,
  urgency bugs (1.2, 1.3), unreachable methods (1.6), merged S&C credit
  (1.1). UTC day boundaries (1.4) still apply to plan dates — fix while
  touching the plan modal.
