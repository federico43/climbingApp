# Per-block progression engine — spec (v3, approved by coach 2026-10-01)

Branch `v2`. Phase 1 output. Phase 2: flash level + shared pieces + sequence built (2026-10-01, coach-checked 2026-10-02); 4×4 built 2026-10-02 (coach OK 2026-10-03); intervals built + coach OK 2026-10-03; constraint warmup built 2026-10-03, awaiting coach check. Everything below comes
from the coach interview (2026-09-28 → 2026-10-01) unless marked
**ASSUMPTION** (my reading, needs a yes/no) or **OPEN** (needs coach input
before that part can be built).

Reference implementation being copied: `utils/scProgression.ts` (pure rules)
+ `utils/scHistory.ts` (shared history lookup) + the persistent,
overridable suggestion banner in `StrengthConditioningBlock.tsx`.

---

## 1. Engine-wide decisions

| # | Question | Decision |
|---|---|---|
| 1 | One variable per session, or several? | **One.** Each profile has a single lever per step. |
| 2 | Suggest or auto-apply? | **Suggest only**, same as S&C: persistent banner for the athlete, flag in the coach editor. The athlete's only override is choosing their own (route / colour / time). Exceptions that act live during the session, since there's no one else to accept them mid-block: sequence step-down (3.2b), 4×4 boulder drop after a fall in sets 1–2 (3.3), warm-up intervals' 10 s cut after a fall (3.4). The training plan's suggested workouts include the constraint warm-up directly (3.5). |
| 3 | Phases across the ~7-month plan? | **Session-to-session only** for v1. No build/peak/deload. |
| 4 | Completion vs RPE disagree? | **Moot.** No climbing block reads RPE; completion is the only signal. S&C keeps its existing RPE logic. |
| 5 | Fixed per block type, or configurable per template? | **Fixed per block type.** Thresholds/limits are still named constants on each profile, not inline in logic. Two later exceptions from the coach: intervals have two kinds picked per block (3.4), and each constraint's warm-up pillars/colours are editable (3.5). |
| — | No history yet? | **Whatever the coach authored.** No suggestion until one logged session exists. Exception: a 4×4 block with no coach colours starts at flash − 1 (3.3). |

---

## 2. Shared shape

```ts
type ProgressionKind = "progress" | "rotate" | "test" | "none"
type Direction = "increase" | "hold" | "decrease"   // reused from scProgression.ts

interface ProgressionProfile {
  blockType: BlockType
  kind: ProgressionKind
  signals: string[]                         // what the rule reads
  lever: string                             // what it changes
  limits: Record<string, number | string>   // named constants, see per block
}

const PROGRESSION_PROFILES: Record<BlockType, ProgressionProfile>  // every type present
```

One pure module per `progress`/`rotate` block (`utils/progression/<block>.ts`),
and **one** shared history reader (`utils/blockHistory.ts`, same pattern as
`scHistory.ts`) used by both the athlete runtime and the coach editor.

### History matching (all blocks)
Sessions store `protocol` (JSON blocks) + `attempts` keyed by `blockIndex`.
Today "the same block" can only be matched by `type + blockName`, which breaks
on rename. **Change:** when a block is cloned from the library, keep
`libraryBlockId: row.$id` on it (inside the `protocol` JSON, so no column
change). Match by `libraryBlockId`, fall back to `type + blockName`.
Verified: `serializeSession` remaps `blockIndex` when blocks are skipped, so
indices line up with the saved `protocol`.

### Colour scale (4×4, constraint warmups, flash level)
`BoulderLevelOptions`: orange → blue → green → yellow → red → black.
Floor orange, ceiling black.

### Athlete flash level (BUILT 2026-10-01)
One flash colour per athlete, **set by the coach** (approved). `AppUser.flashLevel`
(nullable String, a `BoulderLevelOptions` value) on the `users` table: the
column has to be added by hand in the Appwrite console. `setFlashLevel` in
`BoulderGraphService.tsx`; colour picker card in `AthleteAnalytics.tsx`.

---

## 3. Profiles

### 3.1 strength_conditioning — `progress` (rebuilt 2026-10-04)

> **Rebuilt 2026-10-04:** the full rules and build notes are in
> [`sc-progression-plan.md`](sc-progression-plan.md). In short:
>
> - **Double progression.** Every set at the top of the range → step up
>   next session. Any set under the floor → step down. Otherwise hold. RPE
>   (Easy / Solid / Max) is optional.
> - **Inside the session.** A round under the floor makes the next round
>   one step easier (−10 % or one level), with Undo. When nothing can be
>   lowered, the athlete picks an easier exercise.
> - **Ladders** come from the live library, so the easier levels are
>   included.
> - **Safety rails.** Two sessions down in a row → a 10 % deload. Same
>   load three sessions → "stuck". Both are shown to the coach.

> **Updated 2026-10-04:** history is matched **per focus** — the prefill
> uses the last session where the exercise was done at today's focus (the
> training plan rotates focus every time an exercise comes back). See
> [`training-plan.md`](training-plan.md) §7.2.

### 3.2 sequence — `progress` (built, coach OK)
Same rule for every sequence template (Base 1, Max bouldering, Slab made-up…).
Route difficulty: `level` 1–8 + `type` (both already on the route row) + up to
three variations (easy / original / hard).

#### 3.2a Between sessions (suggestion for next time)
From the last session on this block, using only attempts on the route the
athlete **ended** on:

- `sendRate = round(sends / attempts × 10) / 10`, i.e. rounded to the nearest
  10 %: 76 % → 80 %, 74 % → 70 %. **Confirmed:** exactly 75 % rounds up to 80 %.
- `finalVariation` = variation of the last attempt.
- **Passed** = `sendRate ≥ 80 %` and `finalVariation ∈ {original, hard}`.

| Condition | Next session |
|---|---|
| Passed, and this makes **4 passed routes** at this level (same type) | Suggest a route of the same type at **level + 1**, start Original. |
| Passed, fewer than 4 passed at this level | Suggest a **different** route of the same type at the **same level**, start Original. Prefer one not passed yet. |
| Sends > 0 but only on Easier | Same route, start on **Easier**. |
| Sends > 0, under 80 %, on Original/Harder | Same route. **Confirmed:** start on the variation they finished on. |
| 0 sends, didn't start on Easier | Same route, start on **Easier**. |
| 0 sends, already started on Easier (or route has no Easier) | Route of same type at **level − 1**. |

Counting the 4 passes: distinct `routeId`s of this type at this level passed
by this athlete. **Confirmed:** count since they last arrived at this level,
so dropping a level and coming back starts the count again.

Edges (**Confirmed**): level 8 → never suggests 9, keeps suggesting level-8
routes. No saved route available at the target level/type → banner says
"ready for level N, no route saved at that level". `athleteChoosesRoute`
blocks: same rule, the athlete picks among routes at the suggested level/type.

**Confirmed 2026-10-02:** suggested routes are limited to the **same wall**;
`athleteChoosesRoute` blocks get the suggested route preloaded with a
"Choose my own sequence" link; after resuming a half-done sequence the
early-fall rule no longer applies; no route at the target level → banner says
so and nothing changes. Route ranking (never passed / least recently climbed)
stays on **this block's** history only.

**Changed 2026-10-03 (coach):** the athlete's override is only **"Choose my
own sequence"** (opens the route picker; closing it brings the suggestion
back). No "Use the planned sequence instead" — the coach approves/adjusts the
suggestion in the editor. Same for 4×4 and intervals.

Display (coach feedback 2026-10-02): the banner/flag reads in two plain
sentences — "Last time: sent X of Y attempts (Z %) — passed." / "Next: a
different level 4 sequence. Complete 4 level 4 sequences to move up to level 5
(1 of 4 done)." (wording per coach 2026-10-03). The coach editor flag has a **Preview** action that opens the
suggested route full-screen on its wall (starting variation), with "Use this
sequence" at the bottom.

#### 3.2b In-session (live, replaces the blind calibration prompt)
The "too hard / felt right / too easy" prompt after attempt 1 is **removed**.

1. Attempt 1 on the starting variation: a fall in the **first third** of the
   sequence (`highPoint ≤ floor(totalMoves / 3)`, min 1) → switch to
   **Easier**.
2. First attempt on Easier: fall in the first third again → swap to a route of
   the same type at **level − 1** and **restart the attempt count**.
3. Anything else → keep going on the current variation.

**Confirmed:** if the route has no Easier variation, step 1 goes straight to
step 2's level-down. Earlier attempts stay logged against the old route
(attempts already carry `routeId`).
Data/UI: the runtime needs to load a different route mid-block (the
`athleteChoosesRoute` path already loads routes dynamically, so reuse that).

### 3.3 four_by_four — `progress` (built, coach OK)
A "boulder" is abstract: an attempt slot with a colour. The block holds one
colour per slot, e.g. `[yellow, yellow, yellow, yellow]`.

- **Signals:** tops per set (logged). Fall in set N = `tops < bouldersPerSet` in set N.
- **Lever:** one slot one colour up, **always first → last**. Once all slots
  match, start again from slot 1 to the next colour. Cap black.

**In session (live, coach 2026-10-03):** a fall on any boulder in **set 1 or
2** lowers one boulder one colour for the remaining sets. Drops are
**horizontal, last → first** (coach 2026-10-03): the last boulder holding the
highest colour goes down — the mirror of upgrades. `[Y,Y,Y,Y]` → `[Y,Y,Y,G]`
→ `[Y,Y,G,G]`. A second fall in set 2 lowers another boulder the same way.
All orange → nothing changes. A fall in
the final set has no set left to lower, so it's carried to next session.

| Condition | Next session (from the colours they **finished** on) |
|---|---|
| No fall in any set | Next slot in order goes up one colour. |
| Fall in set 1 or 2 | **The colours they finished on** (already lowered live). A drop owed but not applied live (fall in the final set, older logs) is applied now, same way. |
| Falls only in set 3+ | Same boulders. |

The earlier "undo the last swap" rule (confirmed 2026-10-02) is **superseded**
by the live rule: the coach chose "last boulder" for the drop and "start next
time on the colours finished on", so there's no swap left to undo.


**Confirmed 2026-10-02:**
- **Starting colours** = the athlete's **flash level − 1** on every slot
  (floor orange) for the first session on a block.
- **Which slot goes up:** the first slot holding the lowest colour
  (`[G,G,G,G]→[Y,G,G,G]`, `[Y,Y,Y,G]→[Y,Y,Y,Y]` after a last-slot drop).
- **All black, no falls** → same boulders, banner says it's the top colour.

**Confirmed 2026-10-03:**
- If the coach set colours on the block (editor), those win for the first
  session (no suggestion) — "no history → what the coach authored". Flash − 1
  only applies when the block has no colours.
- No flash level and no colours on the block → the athlete picks one colour
  for every boulder (today's behaviour).
- A block whose size changed since last time: extra slots copy the last
  colour, surplus slots are dropped.

- Athlete override is all-or-nothing: "Choose my own colour" (one colour,
  all boulders). They can't recolour single slots. **Changed 2026-10-03:** no
  "Use the planned colours" option any more — the coach approves/adjusts the
  suggestion in the editor, so the athlete's alternative is their own choice.

**Data change (built):**
- Block: optional `boulderGrades: string[]` (length `bouldersPerSet`) inside
  the block JSON. Coach editor: numbered slot circles + colour chips (first
  pick colours every slot; "Clear colours" resets).
- Log: per set `scData: { tops, set, grades }` (the colours climbed in that
  set, so live drops show in the log); `level` = the hardest slot. Sessions
  logged before this have one `level` → expanded to all slots.
- Athlete preview: slot colour pills + banner instead of "pick one grade".
- Numbers: `FOUR_BY_FOUR_RULES` in `profiles.ts` (`earlyFallSets: 2`,
  `startBelowFlash: 1`, `colourStep: 1`).

### 3.4 intervals — `progress` (revised by coach 2026-10-03, built, coach OK)
The earlier single rule (work ±10 s, sets never change) is **superseded**.
The coach split intervals into two kinds, picked **on the block in the
editor** (`IntervalsBlock.kind`: Warm-up / Power endurance). No kind → no
suggestion. No RPE: falls + one yes/no question at the end.

- **Lever:** work time ±10 s, limits **30–90 s**; rest fixed. Power
  endurance only: at 90 s, **+1 round** instead (coach 2026-10-03).
- **Fall:** an "I fell" button records the round. A fall right at the end of
  a round leaves no time to tap, so the button stays available during the
  rest after it ("I fell in round N") and on the done screen after the last
  round ("I fell in the last round").
- **Description** is generated from the settings (`intervalsDescription`:
  kind, rounds, work, rest + one line per kind), so it always matches what's
  run, including a suggested time. The coach's own text shows under it as
  **Notes**. Picking **Warm-up** sets rounds to **4** (coach 2026-10-03).
- **Timer:** Pause / Resume on every countdown.
- **Athlete override:** "Choose my own time" (30–90 s chips). There's no
  "use the planned time" — the coach already approves/adjusts the suggestion
  in the editor (coach 2026-10-03).
- **Question** (only when they didn't fall): warm-up → "Did you feel very
  pumped in the last two rounds?"; power endurance → "Did it feel very easy?"

**Warm-up intervals** (4 sets): athletes shouldn't fall or find it too hard.

**Live (coach 2026-10-03):** each fall cuts **10 s off the following rounds**
(floor 30 s).

| Last time | Next session |
|---|---|
| Fell, cut applied live | the work time they **finished** on (same as 4×4) |
| Fell in the last round (no round left to cut) | finished work time − 10 s |
| No fall, very pumped | work − 10 s |
| No fall, not very pumped | work + 10 s |

**Power endurance intervals** (8 sets, potentially more).

| Last time | Next session |
|---|---|
| Fell in the first two thirds of the rounds (8 → rounds 1–5) | work − 10 s (too much time on the wall) |
| Fell later | same |
| No fall, felt very easy | work + 10 s |
| No fall, not very easy | same |
| At 90 s, no fall, felt very easy | **+1 round**, work stays 90 s, no max rounds |

The early-fall limit moves with the rounds: floor(rounds × 2/3) (9 → 1–6).

**Confirmed 2026-10-03:** warm-up next session starts on the finished work
time (no second cut); power endurance keeps 90 s when adding a round, no
max rounds. PE changes apply next session only; "Choose my own time" keeps
the block's rounds as authored. **"I fell" during work ends the round and
starts the rest timer immediately** (last round → end screen). PE: first fall
counts; warm-up: every fall cuts 10 s.
- A logged work time outside 30–90 s is moved into the range first, then
  the ±10 s applies (20 s, not pumped → 30 → 40 s; 120 s, pumped → 90 → 80 s).
- Warm-up at 90 s and not pumped → stays 90 s.

Data: logged on the block's one attempt, `scData: { kind, series, workTime
(last round's), startWorkTime, restTime, fellInRound?, falls?, pumped?,
veryEasy? }`. Sessions logged before this
have no fall/answer → no suggestion until a new one is logged. Numbers:
`INTERVALS_RULES` in `profiles.ts`.

### 3.5 constraint_warmup — `rotate` (built, awaiting coach check)

> **Updated 2026-10-04 (training plan v2):** groups are now the plan focuses
> (strength/power endurance shared, power, technique, fear management — no
> `general`), and **no flash level → all constraints on orange**. Current
> table and rules: [`training-plan.md`](training-plan.md) §6.1.
Never harder across sessions. Each warmup the app suggests **3 constraints**,
chosen by the **day's main pillar** (decided by the training-plan algorithm;
strength and power endurance share one group), different from last time, run as a
ramp **from easiest colour to hardest** and **from 3 attempts down to 1**:

| Slot | Colour | Attempts |
|---|---|---|
| 1 | easiest | 3 |
| 2 | one colour harder | 2 |
| 3 | one colour harder again | 1 |

Colours are relative to the athlete's **flash level** (coach-set, see §2):

| Constraint | Pillar | Colours |
|---|---|---|
| Ghost Holds | power | below flash |
| Double Hands | power | below flash |
| One hand only | power | two below flash (floor orange) |
| Feet on air | strength + power endurance | up to flash |
| Hover hands | strength + power endurance | up to flash |
| No Re-Adjustment | strength + power endurance | any |
| Silent Feet | strength + power endurance | below flash |
| Sloth | strength + power endurance | up to flash |
| Relax the Hand | strength + power endurance (was strength only) | two below flash (floor orange) |
| Silent Feet & No Re-Adjustment | strength + power endurance (was strength only) | below flash |
| Foot moves | general | below flash |
| One foot only | general | any |

**Strength and power endurance are one group** (coach 2026-10-03: they share
their constraints, so one chip in the editor and one in the builder card).
Relax the Hand and Silent Feet & No Re-Adjustment, strength-only in the
original table, therefore also warm up power endurance days. Settings saved
earlier as "strength" / "power_endurance" are read as the merged group.

"Below flash" = colours < flash. "Up to flash" = ≤ flash. "Two below flash" =
flash − 2, floor orange. "Any" = all colours.
Example: flash = green → below flash = orange, blue.

**Confirmed 2026-10-03:**
- Candidates = constraints tagged with the day's pillar, plus general ones,
  minus those used in the **last** warm-up. Tie-break: least recently used.
  If fewer than 3 fresh ones exist, last time's are reused, least recent
  first (confirmed).
- Colour ramp = `[flash − 2, flash − 1, flash]`, each slot clamped to that
  constraint's own range (floor orange); lower-ceiling constraints go in
  earlier slots. Attempts 3 → 2 → 1.
- Output = 3 **separate** `constraint_warmup` blocks.
- **No flash level → no suggestion at all.**
- **The day's main pillar is decided by the training-plan algorithm** (the
  suggested workout's main pick). The constraints are not only suggested but
  **put into the suggested workout** (after the S/C block, per the S/C →
  technique → rest ordering rule). When the warm-up is added, the technique
  target's own constraint drill is **dropped** from that workout (coach
  2026-10-03), so there are never 4 constraint blocks.
- The 3 suggested workouts' warm-ups are **chained**: workout 2 treats
  workout 1's warm-up as "last time", workout 3 treats workout 2's. Each
  suggestion card shows its warm-up (constraint, colour × attempts), and
  Build puts exactly those blocks in the workout.
- In the coach's workout builder (for an athlete): a "Suggested warm-up"
  card with the 3 picks and one tap to add/replace them. ASSUMPTION: its
  pillar defaults to the workout's most common main pillar (first block wins
  a tie), switchable with chips.
- **The constraint → pillar → colour table is a first guess** (coach): each
  constraint's pillars and colour range are editable in its block editor
  ("Warm-up rotation" chips), saved on its **library block** as
  `rotation: { pillars, colours }`. The table above is only the default
  (`DEFAULT_CONSTRAINT_ROTATION` in `profiles.ts`). No pillars = out of the
  rotation; a library constraint not in the table joins once given a pillar.

Data: rotation picks/history read the coach's `constraint_warmup` library
blocks; usage is matched by `libraryBlockId`, else by name.

### 3.6 project_bouldering — `none`
Tracking only (sends, sessions per project). The coach picks the next project.

### 3.7 free_session — `none`

### 3.8 exploration_session — `test`
Never progresses. Results recorded only.

---

## 4. `utils/methods.ts` changes (Phase 2)

> **Superseded 2026-10-04:** `utils/methods.ts` was deleted with the move to
> the fixed plan rotation — see [`training-plan.md`](training-plan.md).

`progression` is currently only a display label (status chip in
`AdaptationTargetModal`'s method list), not behaviour.

| Method | Now | Becomes |
|---|---|---|
| power_endurance_4x4, one_on_one_off, base_1, max_bouldering, slab_made_up_block | auto | auto (notes rewritten to the rules above) |
| project_bouldering | manual | **none** |
| technique_drills, double_hands | none / auto | **rotate** (add `"rotate"` and `"test"` to `ProgressionStatus`) |
| heavy_low_rep_sc, movement_pattern_circuit | manual | **auto**, since the S&C engine already suggests for these (pending coach OK) |
| everything else | none | none |

`fatigueScore` values untouched (still drafts).

---

## 5. Build order (Phase 2, one at a time, coach checks each)

1. Shared: profiles, `blockHistory.ts`, `libraryBlockId` on clone.
2. **sequence**: 3.2a between sessions, then 3.2b in-session.
3. **four_by_four**: per-slot colours.
4. **intervals**: "fell in round N" logging.
5. **flash level** column (with the coach's OK), then **constraint_warmup** rotate.
6. `methods.ts` statuses.

---

## 6. Still open

1. Constraint warmup: in-app check, and the builder pillar default ASSUMPTION
   in §3.5.
2. `utils/methods.ts` statuses (§4), including whether to relabel the two
   S&C methods `auto` (label only).

Confirmed by the coach 2026-10-01: 75 % rounds up, partial-send start
variation, pass counter resets on level change, level-8 / no-route edges,
no Easier → level down, 90 s hold, warmup tie-break.
Confirmed 2026-10-02: the 4 sequence decisions (same wall, preload +
"Choose my own", no early-fall rule after resume, no-route banner), ranking on
this block's history only, `flashLevel` column added in Appwrite, 4×4 start =
flash − 1, slot order, black cap.
Confirmed 2026-10-03: sequence wording "Complete 4 level N sequences to move
up to level N+1"; 4×4 live drop in sets 1–2 (last boulder, then another),
next session starts on the colours finished on; drops are horizontal
(last boulder holding the highest colour, e.g. `[Y,Y,Y,G]` → `[Y,Y,G,G]`);
4×4 approved in the app. Intervals revised into warm-up / power endurance and
approved in the app. Athlete overrides are "choose my own" only (sequence,
4×4, intervals). Constraint warmup: reuse when < 3 fresh, separate blocks,
no flash → no suggestion, pillar from the training plan, put into the
suggested workouts, technique drill dropped when the warm-up is added,
strength + power endurance merged, table editable per constraint.
