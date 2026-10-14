# S&C progression engine — audit + plan

Branch `v2`. Status: **Phase 0 skipped; Phases 1–5 built (uncommitted) — plan complete, waiting for on-device testing** (2026-10-04). Open items: §8. This covers the
rules that pick the athlete's weight or level for S&C exercises. The
in-workout screen redesign is in `docs/sc-block-ux.md`. Its Phase 3.4
("stop logging un-entered reps") and Phase 4 ("smart in-session
adjustment") **move here**. That doc will be updated to point to this one.

## 1. What existed before this work (audit, 2026-10-04)

| Piece | File | What it does |
| --- | --- | --- |
| Focus tables | `utils/scProgression.ts` | Max force 3–6 reps @ RPE 8–9.5 · Hypertrophy 8–12 @ 7–8.5 · Explosiveness 3–6 @ 4–6 |
| Weight rule (next session) | `suggestDirection` | Reps missed or RPE above the band → ▼. RPE below the band → ▲. Otherwise hold. The step is ±5 %, rounded to 0.5 |
| Level rule (next session) | `suggestLevelDirection` | Judged on reps only: under the range floor → ▼ one level. At the ceiling → ▲ one level |
| Live rule (same session) | `StrengthConditioningBlock.tsx:300-328` | Only the **ceiling** triggers anything: a popup saying "Add weight next time?" or "Ready for the next level!". Missing the floor does nothing |
| History | `utils/scHistory.ts` | Finds the newest session that logged this exercise family at today's focus, then reads **only its last round** |
| Level chains | `utils/levelChain.ts`, `ExerciseForm.tsx` | Each library row stores its "harder than me" tail (`levels`). The full chain is rebuilt from those edges, but only in the exercise form |
| Coach flag | `workoutBlocks.tsx:2268` | Shows the coach "athlete is already on level X" while they edit a block |
| Tests | `scripts/progression-tests/scHistory.test.ts` | Covers focus filtering in history. **The decision rules have no tests** |

## 2. Gaps and bugs

### Your three reported issues

**A. Missing the rep floor does nothing in the session.** `handleExerciseDone`
only checks the ceiling. The next round starts with the same weight or
level.

**B. Level chains are fragile.** Root cause: when an exercise is added to
a block, the block keeps a **copy** of `levels`, and that copy holds only
the exercises *harder* than the one added (`exerciseDraftFromLibrary`,
`scPlanBuilder.ts:39`). Consequences:
1. **The athlete can't step down below the prescribed exercise.** In the
   chain Knee push-up → Push-up → Elevated push-up, a block holding
   "Push-up" never knows Knee push-up exists. Fixing A for level mode
   depends on fixing this.
2. **History breaks across the chain.** The history search only looks at
   the prescribed exercise and the levels above it. Logs of an easier
   member aren't found. If next month's block prescribes Elevated
   push-up, rounds logged as Push-up aren't found either, so the athlete
   looks like they have no history.
3. **Stale copies.** Chain edits in the library never reach saved
   templates, plans or workouts that already hold a copy.
4. **The level resets inside a session** (`StrengthConditioningBlock.tsx:265`).
   Say round 1 is on a level and round 2 the athlete steps back to the
   base exercise. `lastLevels` keeps round 1's level, so round 3 starts on
   the harder level again.
5. **Two meanings of "null".** `nextLevel` uses `null` to mean the base
   exercise. It also returns `null` for an unknown id, which it treats as
   "at the base", so an off-chain log quietly turns into "start from the
   bottom".
6. **Known limitation, unchanged:** linking an exercise that already
   starts its own chain cuts that chain off instead of merging it.

**C. "Add weight next time" shows on level exercises.** The popup chooses
between "add weight" and "next level" using the block's **copied**
`loadMode`. Likely triggers (Phase 0 confirms which one you hit):
1. The copy is out of date. The exercise was added, or the template or
   plan was saved, before it joined a chain. It still says `weight`.
2. AI-generated protocols (`services/aiProtocol.ts`) never set `loadMode`,
   so it defaults to `weight`.
3. **Timed exercises with a focus.** The plan builder sets `focus` on
   timed holds too (`scPlanBuilder.ts` `withFocus`). The popup then
   compares *seconds* to the *rep* range: a 20 s hold is "≥ 6 reps", so
   "Add weight" fires on every hold.
4. Bodyweight exercises in weight mode with 0 kg also get "add weight",
   which is usually the wrong advice.
5. At the hardest level nothing shows at all, not even "top of the
   chain — add reps or a weight vest".

### Other problems the audit found

| # | Problem | Where |
| --- | --- | --- |
| D | **Weight mode treats reps inside the range as a miss.** `repsTarget = targetNumber(ex.reps)` takes the **largest** number, so for "3-6" the target is 6. Doing 5 reps (in range) counts as "reps missed", so the weight goes ▼. Level mode uses the floor, so the two modes disagree | `StrengthConditioningBlock.tsx:197`, `scProgression.ts:68` |
| E | **The live rule and the next-session rule contradict each other.** Reach the ceiling at RPE 8: the popup says "add weight", but the next session holds the weight because RPE is inside the band | `:308` vs `suggestDirection` |
| F | **Weight mode needs RPE, and RPE is hidden** behind "▸ Weight & RPE". If it isn't filled in, there's no progression at all; the old weight is just carried forward | prefill `:181-195` |
| G | **The reps stepper starts at the top of the range.** Tapping Done logs the ceiling, which triggers false "add weight" popups and ▲ suggestions (flagged 2026-09-12) | `:1104` |
| H | **Only the last round is judged.** That's the most fatigued set. Industry practice judges every working set: all sets at the top → add load; any set under the floor → reduce | `scHistory.ts:75` |
| I | **Small weights never move.** 5 % of 4 kg is 0.2, which rounds back to 4. Dumbbells and kettlebells get stuck forever | `nextWeight` |
| J | **kg/lb mixing.** The unit resets to kg each block, and logged weights are never converted, so switching to lb mislabels history | `:131` (also in sc-block-ux #1) |
| K | **Both sides are judged two ways.** History averages L and R; the live rule uses the weaker side. The weaker side should drive both | `scHistory.ts:80` vs `:307` |
| L | **No safety rails.** No deload after repeated misses, no "stalled for 3 sessions" signal for the coach, no cap on how far a suggestion can jump | — |
| M | **Timed (seconds) exercises have no progression model.** They're either ignored or wrongly judged against rep ranges (see C3) | — |
| N | **The coach can't see why.** The athlete gets a banner; the coach sees only the current level. There's no record of "suggested X, athlete did Y" | — |

## 3. Target rules ("industry grade")

One pure function, `decideNext()` in `utils/scProgression.ts`, used in
three places: inside the session, for the next session, and in the
coach's editor flag. No rule logic lives in components.

**Inputs:** focus, load mode, the full chain and the athlete's position in
it, the target range, and the working sets (reps per set, weaker side for
both-sides, optional effort, weight).

### 3.1 Weight mode — double progression
The standard model: add reps until the top of the range, then add load
and drop back to the floor.

| Session result | Next session |
| --- | --- |
| Every set reached the **top** of the range, effort not "Max" | ▲ load |
| Every set inside the range | Hold the weight and aim for +1 rep |
| Any set **under the floor** | ▼ load |
| Effort above the band on most sets, even with reps in range | ▼ load |
| Effort not logged | Judged on reps alone. RPE only refines the call |

**Step size:** `max(5 % of current, smallest increment)`. The smallest
increment defaults to 1 kg / 2.5 lb (rounded to 0.5), with an optional
per-exercise override in the library (e.g. 2 kg for kettlebells).

> **Updated 2026-10-06 (coach):** every weight change, whether in-round,
> next session or a deload, is **at least 0.5 kg and at most 2.5 kg**
> (1–5 lb), in whole weight jumps. The default jump is now 0.5 kg / 1 lb.
> A coach-set jump bigger than 2.5 kg (kettlebells, 4 kg) still wins.
> `MAX_WEIGHT_CHANGE` / `DEFAULT_LOAD_STEP` in `scProgression.ts`.

### 3.2 Level mode
The same table, with "load" replaced by "one level along the **full**
chain". At the top of the chain, ▲ changes nothing: the athlete only sees a
note, "Top level reached", and never "add weight". At the bottom, ▼
changes nothing next session ("Easiest level — stay on this level").
Inside the session, a miss on the easiest level offers **Pick an easier
exercise** (Phase 3, revised).

### 3.3 Inside the session (your issue A)

> **Superseded 2026-10-06 (coach):** **weight** exercises no longer change
> automatically mid-session. Both directions are suggestions: under the
> floor, "Lower the weight a little: try 18 kg"; above the top, "Add a
> little weight: try 21 kg". Ladders keep the automatic level change with
> Undo. Exercises with an exercise setup get "Make it easier / harder this
> round: <hint>". The full current table is in
> [`sc-modifications-plan.md`](sc-modifications-plan.md) §2.3b.

After each logged round:

| Round result | Next round |
| --- | --- |
| Under the floor | Weight −10 % (at least one smallest increment) **or** one level easier |
| At or over the ceiling | No change mid-session. Shows "▲ next session" on the rest screen and the review |

The change shows up as a banner on the next round, on its own screen
("Easier next round: 22.5 → 20 kg — you got 2 of 3–6 reps") with an
**Undo** button. This replaces today's `Alert` popups. The next session
starts from where the session **ended**, and the history also records
that an in-session drop happened (so "▲" isn't suggested straight back).

### 3.4 Timed holds
Seconds get their own target, taken from the prescribed range
(e.g. "20-30"). Under the low end → easier or less load. Reached the
high end on every set → ▲. Seconds are never compared to rep ranges.

### 3.5 Safety rails
- **Deload:** two sessions in a row judged ▼ → −10 % and a coach flag.

> **Changed 2026-10-06 (coach): deload is coach-only.** When the last two
> sessions (any focus) both went ▼, the coach sees it: a red "Down 2×"
> badge in the athlete's S&C list, a warning on the exercise's progress
> card, and a line in the workout editor ("consider backing off"). The
> athlete gets **nothing**: no note, no extra drop. Their next session
> follows the normal rules. `flags.deload` is only read by coach screens.
- **Stall:** three sessions held at the same weight or level → coach
  flag "stalled".
- One step per session. Suggestions never skip levels across sessions.

## 4. Phases

Each phase ends with a type-check, tests and a report. I stop for your
approval before starting the next one.

### Phase 0 — Reproduce C (small)
Find which exercise showed "Add weight" for you, and why (stale copy, AI
protocol, timed hold or bodyweight). Add a test for each case before
fixing.

### Phase 1 — Level chains, done properly (fixes B, C1–C2) — **built 2026-10-04**

What changed:
- `utils/levelChain.ts`: `resolveExerciseChain` (live library first,
  matched by id then by name; falls back to the block's copy when
  offline), plus `chainIds` and `chainIndexOf`.
- `utils/scProgression.ts`: `nextLevel` replaced by
  `stepLevel(chain, fromIdx, dir) → { index, step, atTop, atBottom }`.
- `utils/exerciseLibraryCache.ts`: one cached library fetch (5 min).
  `ExerciseForm` save and library delete invalidate it.
- `StrengthConditioningBlock.tsx`: chains are resolved on mount. Start
  waits for history + library (up to 6 s each). The picker shows the
  full chain with "Prescribed" / "Suggested" tags. The athlete's pick
  (the prescribed step included) carries to the next round. The ceiling
  popup chooses level vs weight from the resolved chain. At the top or
  bottom of a chain the note says so, with no move.
- `workoutBlocks.tsx` coach flag: uses the full chain and now also says
  when the athlete is *behind* (on an easier level).
- Tests: `scripts/progression-tests/levelChain.test.ts`.

Not done here: B6 (merging two chains). The editor's "Level progression"
tag still reads the block's copy.

The original plan for this phase:
1. **Resolve the chain from the live library when the workout runs.** Use
   `resolveFullChain(exerciseId, library)` and the library's `loadMode`.
   The block's copy is only a fallback when offline. One shared, cached
   library fetch per workout.
2. Track position as an **index in the full chain**, including easier
   members. The level picker shows the whole chain; the prescribed
   exercise is marked.
3. History "family" = every member of the full chain (`scHistory.ts`
   and the coach flag).
4. Fix the in-session level reset (B4). The athlete's choice, including
   the base exercise, is always remembered for the next round.
5. Replace `nextLevel`'s `null` return with an explicit result:
   `{ step, atTop, atBottom }`.
6. Tests: chain resolution from any member, stepping across the base
   exercise, off-chain history, a stale copy vs the live library.

### Phase 2 — One rule engine (fixes C3–C5, D, E, H, I, K, M) — **built 2026-10-04**

What changed:
- `utils/scProgression.ts`: `targetFor` (focus rep range, or the
  prescribed amount; seconds for timed holds), `decideNext` (double
  progression, §3.1), `nextWeight(current, dir, loadStep, unit)` (±5 %,
  at least one `loadStep`, lands on a multiple of it), `describeWeight` /
  `describeLevel` (never "add weight" for level or bodyweight; at either
  end of a chain: a note, no move). Removed: `suggestDirection`,
  `suggestProgression`, `suggestLevel*`, `repsAtCeiling`.
- `utils/scHistory.ts`: `readRound` (both sides: the weaker side's reps
  and the harder side's RPE), `setsAtFinalLoad` (only rounds at the
  level/weight the session ended on), `findLastScSets`.
- `StrengthConditioningBlock.tsx`: `planNext` runs the rule for the
  prefill and for a new **"Next time"** card on the review screen. The
  per-round "Add weight next time?" / "Ready for the next level!" popups
  are gone.
- `loadStep`: `ExerciseRow` + `OPTIONAL_EXERCISE_FIELDS`, a "Smallest
  weight jump (kg)" field in `ExerciseForm` (weight mode), copied into
  blocks; the live library's value wins at workout time. **Appwrite:**
  add a Float column `loadStep` (optional) to `exercises`.
- Tests: `scripts/progression-tests/scProgression.test.ts`.

Moved to Phase 5: the coach's editor flag showing the next suggestion
(it still shows only where the athlete is in the chain).

The original plan for this phase:
1. `decideNext()` as in §3.1–3.4, with mode-aware wording (never "add
   weight" for level mode, timed holds or bodyweight).
2. History returns **every working set** of the last session, not just
   the last round.
3. Fix the range: use the floor and ceiling, not `targetNumber`.
4. Smallest weight increment, plus the optional library field
   `loadStep` (a new Appwrite column — **you add it in the console**; I'll
   ask before relying on it).
5. Both-sides: the weaker side drives the call everywhere.
6. The prefill, the live popup and the coach flag all call `decideNext`.
7. Full test file: `scripts/progression-tests/scProgression.test.ts`.

### Phase 3 — In-session regression (fixes A) — **built 2026-10-04**

What changed:
- `utils/scProgression.ts`: `planRoundDrop(target, amount, load)`. Under
  the floor → −10 % weight (at least one `loadStep`) or one level down.
  Always one step. Bodyweight, or already the easiest level → *(first
  version: a "do fewer reps or use assistance" note; replaced, see
  "Revised" below)*. At or over the ceiling → nothing mid-session.
  `decideNext(..., { droppedInSession })`: topping out on the easier load
  holds next time (`dropped_in_session`) instead of stepping straight
  back up.
- `utils/scHistory.ts`: `readRound` reads `adjustedFrom`;
  `setsAtFinalLoad` returns `droppedInSession`.
- `StrengthConditioningBlock.tsx`: `roundDrops` state is set in
  `handleExerciseDone` (only when the exercise has another round). The
  easier load is applied to the next round's prefill. A yellow
  `RoundDropBanner` with **Undo** sits at the top of the exercise, and
  the rest screen lists the drops. A kept drop is logged as
  `adjustedFrom` on the round. The start-of-session suggestion banner
  now shows in round 1 only.
- Tests: added to `scProgression.test.ts`.

**Revised 2026-10-04 (user feedback):** when nothing can be lowered
(bodyweight with no ladder, or already the easiest level) the banner no
longer says "do fewer reps or use assistance". It says "You got 7 of 8–12
reps — pick an easier exercise for this round" with a **Pick an easier
exercise** button. It opens `EasierExercisePicker`: library exercises of
the same movement pattern first, then the rest; never mobility or 7/3s.
The pick replaces the exercise for the rest of the block (same target,
picked exercise's photo/notes, weight mode), and a green banner offers
Undo. Swapped rounds are logged under the picked exercise with
`swappedFrom` (the prescribed exercise), and they're left out of the
original's "Next time" judgement. The review card says the exercise needs
an easier version on its ladder. Coach-side surfacing of `swappedFrom`
is Phase 5.

Needs a target to judge against: a focus (rep-counted) or a prescribed
range/number. An exercise with neither never triggers it.

The original plan for this phase:
§3.3: the next round adjusts automatically, with a banner and Undo.
Uses Phase 2's engine. It's logged as `adjustedFrom` on the round, so
history and the coach can see it. The popups are removed.

### Phase 4 — Honest logging (fixes F, G, J) — **built 2026-10-04**

Decided: **Done is locked until reps are picked** (no `repsEntered`
flag). This session built the UI too, so `sc-block-ux.md` Phase 3 is done
here.

What changed:
- `utils/scProgression.ts`: `Effort` + `effortToRpe` (Easy = band.low − 1,
  Solid = mid-band, Max = band.high + 0.5; with no focus, a 7–9 band),
  `repChoices` (floor − 1 … top + 1), `convertWeight` (kg ↔ lb, to 0.5).
- `utils/scHistory.ts`: `readRound(d, unit)` / `findLastScSets(..., unit)`
  convert logged weights to the athlete's unit (logs without a unit = kg).
- `StrengthConditioningBlock.tsx`:
  - `AmountInput`: rep buttons, nothing preselected, plus "Other" for a
    counter. Timed: hold timer, or "Enter seconds instead".
  - `EffortChips`: Easy / Solid / Max, optional. Not shown for level
    mode; also used on the 7/3s done screen.
  - `LoadControl`: weight as a line ("20 kg" / "Bodyweight") that opens
    the stepper + kg/lb switch; level mode shows the ladder.
  - The Done / "Next: right side" button reads "Pick your reps first"
    until picked. Both sides: right starts on the left's pick.
  - RPE is no longer prefilled; `lastRpe` was removed.
  - Switching kg ↔ lb converts the weights on screen and the remembered
    ones. The round logs `effort` next to `rpe`.
- Tests: added to `scProgression.test.ts`.
- Checked on the web build with a mock block: the lock, buttons, Other,
  effort, kg → lb (16 kg → 35.5 lb), both sides, and weight carried into
  round 2.

The original plan for this phase:
1. Reps aren't prefilled. If the athlete doesn't pick a value, the round
   is logged with `repsEntered: false` and the engine ignores it.
2. Effort is optional and quick: Easy / Solid / Max, mapped to RPE values
   inside the focus band (stored as RPE).
3. The weight unit is saved per athlete and converted on read.

This overlaps `sc-block-ux.md` Phase 3. The UI work stays there; the
data side is done here.

### Phase 5 — Safety rails + coach visibility (fixes L, N) — **built 2026-10-04**

What changed:
- `utils/scHistory.ts`: `findScSessions` (each recent session on the
  family, judged at its final load, with focus, prescribed reps/unit and
  effort) and `findScSwaps` (rounds swapped away from this exercise).
- `utils/scNext.ts` (new): `planNext`, moved out of the workout screen
  and shared.
  - **Deload:** ▼ two sessions in a row → −10 % (level mode is still one
    level) and `flags.deload`.
  - **Stalled:** the same exercise and weight three sessions running
    without earning ▲ → `flags.stalled`.
- `StrengthConditioningBlock.tsx`: the prefill reads the last 3 sessions
  (`findScSessions`). The "Next time" card judges today on top of them.
- `utils/scCoach.ts` (new): `coachExerciseView` gives the last 5 sessions
  as suggested → did → result, plus flags and swaps.
  - `components/ScProgressionCard.tsx` renders it at the top of
    `exerciseProgress.tsx`.
  - `AthleteAnalytics.tsx` shows Deload / Stuck / Swapped badges in the
    S&C list.
- `workoutBlocks.tsx` editor flag: now for every non-mobility exercise
  with history, not only ladders. It shows "Next session: …", the
  deload/stalled warnings and the ladder position as before.
- Tests: `scripts/progression-tests/scNext.test.ts`.
- Checked on the web build with mock sessions (deload + swap).

The original plan for this phase:
1. Deload and stall detection (§3.5).
2. Coach side: per exercise in `AthleteAnalytics`, show the last 5
   sessions as "suggested → did → result", plus stall/deload flags.
   The editor flag shows the next suggestion, not just the current level.
3. Docs: rules go into `docs/progression-spec.md` §S&C, and
   `docs/training-plan.md` is kept in sync.

## 5. Open questions

- **Q1 — decided 2026-10-04:** in-session regression changes the next
  round **automatically**, with a banner and Undo.
- **Q2 — decided 2026-10-04:** always one step (−10 % or one level), however many reps short.
- **Q3 — decided 2026-10-04:** weight mode uses **double progression on
  reps**. RPE is optional and only refines the call.
- **Q4 — decided 2026-10-04:** the coach sets the smallest weight jump
  **per exercise** (`loadStep` in the library). It falls back to 1 kg /
  2.5 lb when not set. This needs a new Appwrite column.
- **Q5 — decided 2026-10-04:** at the hardest level, show a note only. No change is suggested.
- **Q6 — decided 2026-10-04:** phases run in order, 0 → 5.

## 6. Files (as built)

| File | What it holds | Phases |
| --- | --- | --- |
| `utils/scProgression.ts` | Pure rules: `targetFor`, `decideNext`, `nextWeight`, `stepLevel`, `planRoundDrop`, `effortToRpe`, `repChoices`, `convertWeight`, wording | 1–4 |
| `utils/scHistory.ts` | Reading logs: `readRound`, `setsAtFinalLoad`, `findScSessions`, `findScSwaps` (+ older `findLastScLog` / `findLastScSession`) | 1–5 |
| `utils/scNext.ts` (new) | `planNext`: next session's load + deload / stalled flags | 5 |
| `utils/scCoach.ts` (new) | `coachExerciseView`: the coach's "suggested → did → result" rows | 5 |
| `utils/levelChain.ts` | `resolveExerciseChain`, `chainIds`, `chainIndexOf`, `findLibraryRow` | 1 |
| `utils/exerciseLibraryCache.ts` (new) | One cached library fetch, invalidated on exercise save / delete | 1 |
| `components/StrengthConditioningBlock.tsx` | Prefill, in-session drop + Undo, easier-exercise picker, logging controls, "Next time" card | 1–5 |
| `components/ScProgressionCard.tsx` (new) | Coach progression card | 5 |
| `app/(tabs)/(buttonTabs)/exerciseProgress.tsx` | Shows the card above the charts | 5 |
| `components/AthleteAnalytics.tsx` | Deload / Stuck / Swapped badges in the S&C list | 5 |
| `components/workoutBlocks.tsx` | Editor flag: full ladder, "Next session: …", warnings; `Exercise.loadStep` | 1, 2, 5 |
| `components/ExerciseForm.tsx` | "Smallest weight jump", the progression-ladder editor (§7) | 2, §7 |
| `app/(tabs)/(buttonTabs)/exercises.tsx` | Invalidates the library cache on delete | 1 |
| `services/BoulderGraphService.tsx` | `ExerciseRow.loadStep`, `OPTIONAL_EXERCISE_FIELDS` | 2 |
| `utils/scPlanBuilder.ts` | Copies `loadStep` into plan-built blocks | 2 |
| `scripts/progression-tests/levelChain.test.ts`, `scProgression.test.ts`, `scNext.test.ts` | Tests (run: `node --import ./scripts/progression-tests/alias-hook.mjs <file>`) | 1–5 |

`services/aiProtocol.ts` was not changed: AI-made exercises have no
`loadMode`, but the chain is now found in the library by name (Phase 1).

## 7. Other changes made alongside (2026-10-04)

**Exercise form: progression ladder redesign** (`ExerciseForm.tsx`).
- The coach found picking variations confusing (two lists split around a
  grey row, with arrows that only moved within each half).
- "Progresses by: Weight / Level" became "How does it get harder? **Add
  weight** / **Harder version**", with a one-line example.
- The level editor is now one numbered **Progression ladder**, easiest at
  the top. This exercise is highlighted ("This exercise"), the ends are
  tagged Easiest / Hardest, "+ Add an easier version" sits above and
  "+ Add a harder version" below, and ↑/↓ move a step anywhere in the
  ladder. Moving one past this exercise turns it from harder into easier,
  or the other way round.
- The ladder is split back into easier / harder on save, so the stored
  shape and `syncChainWithLibrary` didn't change. Checked on the web build.

**Ladders are always one line (2026-10-05).**
- **Bug the coach hit:** they created *Band Assisted Pull-Ups* and linked
  *Negative pull-ups* as its harder version. The form didn't bring in
  Negative's easier side (*chin-up isometric*), so both were stored as "the
  step right below Negative" — a fork. The old resolver kept only one
  branch, so each exercise showed a different ladder.
- **Rule (coach):** no two exercises on the same step.
- **Changes in `utils/levelChain.ts`:**
  - `resolveFullChain` now orders everything connected (a topological
    sort; ties broken by library order). Every member sees the same full
    ladder, even from forked data, and a loop can't hang or drop anyone.
  - `ladderHasFork` detects forked data.
  - `mergeIntoLadder` joins two ladders. The picked exercise goes right
    next to this one, and its old ladder keeps its order around it.
- **Changes in `ExerciseForm.tsx`:**
  - Adding a version that's already in a ladder merges it in, with a green
    note naming what came along.
  - Opening a forked ladder shows a yellow warning ("check the order and
    save").
  - `syncChainWithLibrary` rewrites **everything that was connected** to
    any member. An exercise removed with ✕, or left on an old branch, is
    reset, so it can't recreate the fork.
- Tests: added to `levelChain.test.ts`, using the real pull-up data.
- Checked on the web build against the real library (read-only, nothing
  saved).
- Data note: the coach relinked the pull-ups by hand at 11:11 on
  2026-10-05, so the stored data is one line again. *Band Assisted
  Pull-Ups* still has no movement pattern.

**Shared screen with the other session.** `sc-block-ux.md` (UI redesign)
was built in parallel on the same file. Its Phase 3 (logging controls) was
built here as Phase 4.

## 8. Open items

1. **Appwrite `loadStep` column — decision pending.** Add an optional
   **Float** column `loadStep` to `exercises`.
   - **Risk until it exists:** if a coach types a weight jump, the save is
     rejected and `createExercise` / `updateExercise` retry **without
     every optional field** (photo, notes, ladder, focuses, movement type
     — not just `loadStep`). The form looks saved, but those changes are
     lost.
   - **Options:** (a) add the column, (b) remove the field and always use
     1 kg / 2.5 lb, (c) also make the retry drop only the missing column.
     Recommended: (a) + (c).
   - **Update 2026-10-06:** (c) is done (`writeExercise`, see
     `sc-modifications-plan.md` Phase 2). A missing column now only loses
     that one value. (a) is still yours to do.
2. **Not tried on a device.** Everything was type-checked, unit-tested,
   and checked on the web build with mock data. The real flow (workout →
   coach progress screen / editor) still needs a run on a phone with
   real history.
3. **The easier-exercise picker lists every exercise of the same pattern,**
   including harder ones (e.g. Pistol Squat for Assisted Pistol Squat).
   The athlete has to choose sensibly.
4. **The coach isn't notified** (no push) about deloads, stalls or swaps. They're
   visible in the badges, the progress card and the editor flag only.
5. **Coach screens show weights in the coach's device unit** (kg/lb).
   Logged weights are converted.
6. B6 (merging chains) is fixed — see §7, "Ladders are always one line".
   Still open: the editor's "Level progression" tag reads the block's copy.
7. *Band Assisted Pull-Ups* has no movement pattern (set it in the
   library).
