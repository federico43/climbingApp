# Progression engine — handoff for the next agent

Last updated 2026-10-03. Branch `v2`. **Read this, then
[`docs/progression-spec.md`](progression-spec.md) (the coach-approved spec),
before touching anything.**

## 1. What this feature is

A climbing-coaching app (React Native / Expo + Appwrite). A coach builds
workouts from **blocks** (`BlockType` in `components/workoutBlocks.tsx`). The
goal is to reduce the coach's workload: for each block type the app
**suggests** how hard the athlete's next instance of that block should be,
based on what they logged last time. S&C progression already existed
(`utils/scProgression.ts` + `utils/scHistory.ts`); this work extends it to
every other block type, one block at a time.

## 2. Ground rules (from the coach / original task — keep following them)

- **Don't commit** unless the user asks. Everything below is uncommitted on
  `v2`, mixed in with lots of other unrelated uncommitted work. Run
  `git status` first and don't assume anything is on `main`.
- **Don't modify or migrate live Appwrite data** without the coach's explicit
  OK. New columns are added **by hand in the Appwrite console by the user**
  (same pattern as `pushToken`); code must fail gracefully until they exist.
- **Appwrite has no array-of-object columns.** Structured data goes in JSON
  String columns, or inside existing JSON blobs (`protocol`, `BlockRow.data`,
  `attempts`). So far no schema change was needed except `users.flashLevel`.
- **Don't invent training numbers or methods.** Ask the coach. `fatigueScore`
  values in `utils/methods.ts` are unconfirmed drafts — leave them alone.
- **One block type at a time; stop for the coach to check each one** before
  starting the next.
- **Suggest only.** Nothing is ever written to a block automatically; the
  athlete sees a persistent banner (only override: choose their own) and the
  coach sees a flag in the editor. Exceptions that act live mid-block:
  sequence step-down (§4.3), 4×4 boulder drop (§4.4), warm-up intervals' 10 s
  cut (§4.5). The training plan's suggested workouts include the constraint
  warm-up directly (§4.6).
- **Rules are fixed per block type** (coach's decision), with all numbers as
  named constants in `utils/progression/profiles.ts`.
- **Typecheck must stay clean.** `npx tsc --noEmit -p .` currently reports
  **0 errors** — keep it that way. ESLint has many pre-existing warnings; just
  don't add new ones.
- The coach writes in English and sometimes Spanish; answer in the language
  they used.

## 3. Status by block

| Block | Kind | Status |
|---|---|---|
| strength_conditioning | progress | Already built before this work (`scProgression.ts`) |
| sequence | progress | Built 2026-10-01; coach tested + confirmed 2026-10-02 (text reworded, Preview added) |
| four_by_four | progress | Built 2026-10-02; coach OK 2026-10-03 |
| intervals | progress | Built 2026-10-03 (rule revised by coach); coach OK 2026-10-03 |
| **constraint_warmup** | rotate | **Built 2026-10-03 — awaiting the coach's check (§6)** |
| project_bouldering | none | Nothing to build (tracking only) |
| free_session | none | Nothing to build |
| exploration_session | test | Nothing to build |

## 4. What was built (all uncommitted)

### 4.1 Athlete flash level
- `services/BoulderGraphService.tsx`: `AppUser.flashLevel?: string | null`
  (a `BoulderLevelOptions` colour value) and `setFlashLevel(userId, value)`,
  which **throws** if the column is missing so the UI can say so.
- `components/AthleteAnalytics.tsx`: "Flash level" card (coach view) above
  the Training plan card — six colour chips, tap to set, tap again to clear.
  Re-reads the user row on mount (the athlete prop list can be stale).
- The `flashLevel` String column on `users` **has been added** by the coach
  (confirmed 2026-10-02).

### 4.2 Shared pieces
- `utils/progression/profiles.ts` — `PROGRESSION_PROFILES: Record<BlockType,
  ProgressionProfile>` (kind / signals / lever / built flag for every block
  type) and every rule's constants (`SEQUENCE_RULES`, `FOUR_BY_FOUR_RULES`,
  `INTERVALS_RULES`, `CONSTRAINT_WARMUP_RULES`, `DEFAULT_CONSTRAINT_ROTATION`).
- `utils/blockHistory.ts` — `findBlockRuns(sessions, ref)` returns every past
  run of a block (newest first), each with the block config as run and that
  block's own attempts. Matching: same `type`, then `libraryBlockId` if both
  sides have one, else exact `blockName`. **Reuse this for every block —
  don't write per-screen history lookups** (same reason `scHistory.ts` exists).
- `libraryBlockId` on blocks (`components/workoutBlocks.tsx`):
  - `BaseBlock.libraryBlockId?: string`.
  - `blockFromLibraryRow` now sets `libraryBlockId: row.$id` (after spreading
    `data`, so it always wins).
  - `withoutLibraryRef` strips `id` + `libraryBlockId` before any library save
    (`handleSaveEdit`, `handleSaveNew`).
  - `handleSaveNew` with "save to library" links the workout's copy to the
    newly created row.
  - Limitations: sessions logged before this change have no id (name match
    only), and so do blocks in workouts built before it.
- Verified: `utils/workoutSession.ts` `serializeSession` remaps `blockIndex`
  when blocks are skipped, so `attempts[].blockIndex` ↔ `protocol[i]` lines up.

### 4.3 Sequence (spec §3.2)
- **Pure rules** — `utils/progression/sequence.ts`:
  - `summarizeSequenceRun(attempts)` — judges only the trailing attempts on
    the route the athlete *ended* on; send rate rounded to the nearest 10 %
    (as whole tenths, so no float issues); start/final variation.
  - `isPassed` — rounded rate ≥ 80 % and final variation Original/Harder.
  - `passesAtLevel` — distinct routes passed at this level/type, walking back
    until a run ended on a different level (so the count resets on a level change).
  - `pickRoute(routes, from, level, runs, exclude)` — same type, target level,
    **same wall** as `from`, not `from` itself; ranked never-passed first, then
    least recently climbed, then name. Uses only *this block's* history.
  - `suggestNextSequence(runs, routes)` → `{ direction, route | null,
    startVariation, note }` or `null` (no history → run as the coach authored).
  - `isEarlyFall(highPoint, totalMoves)` — fall within the first third.
  - `routeInfo` / `routesVisibleTo(rows, athleteId)` — shared routes plus the
    athlete's own.
- **Athlete runtime** — `components/SequenceBlock.tsx`:
  - On mount: loads `getSessions()` + `getSprayRoutes()`, computes the
    suggestion, **preloads** the suggested route + starting variation, and
    shows a green banner on the intro screen with one override link, "Choose
    my own sequence" (opens the route picker; closing it restores the
    suggestion). Start is disabled until loaded. Not applied on resume.
  - The old blind "How did that feel?" calibration phase and its styles were
    **removed**, replaced by the live step-down (`earlyCheck` state +
    `dropALevel`): early fall on attempt 1 → Easier; early fall again on the
    first Easier attempt → route one level down (same type/wall) and the
    attempt count restarts.
  - `attemptsDone` now counts only attempts on the current route
    (`routeAttempts`); the review lists every attempt with a "Moved to …"
    divider. On resume, the route comes from the *last* logged attempt.
- **Coach editor** — `SequenceFields` in `components/workoutBlocks.tsx`: when
  authoring for an athlete (`AuthoringAthleteContext`), shows the same
  suggestion with a "Use this sequence" action (or "✓ Using it").
- `utils/methods.ts`: the notes on `base_1`, `max_bouldering` and
  `slab_made_up_block` were rewritten to the approved rule.
- **Tests:** `scripts/progression-tests/` (no test framework in the repo; plain
  Node 25 strips TS types, and `alias-hook.mjs` resolves `@/`):
  `node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sequence.test.ts`
  (a harmless `MODULE_TYPELESS_PACKAGE_JSON` warning is printed). Add one test
  file per block module the same way.
- **Coach-tested in the app 2026-10-02.** Feedback fixed: the flag's
  "1/1 sent … 1/4 passed" text was unclear → `SequenceSuggestion` now has
  `lastTime` + `note` (two plain sentences, shown in both the athlete banner
  and the coach flag); the coach flag has a **Preview** action (full-screen
  route on its wall, starting variation, "Use this sequence" button).

### 4.4 Four-by-four (spec §3.3) — built 2026-10-02
- `utils/boulderColours.ts` — `BoulderLevelOptions` moved here (pure, so rule
  modules/tests can read it) + `colourIndex` / `shiftColour` / `colourLabel`.
  `components/ProjectPickerModal.tsx` re-exports it, so old imports still work.
  Reuse for constraint warmups.
- `FOUR_BY_FOUR_RULES` in `profiles.ts`; profile marked `built: true`.
- **Pure rules** — `utils/progression/fourByFour.ts`: `fitGrades`,
  `authoredGrades(block)`, `runGrades(run)` (legacy single `level` →
  all slots), `startingGrades(flash, n)`, `summarizeFourByFourRun`,
  `nextSlotToRaise`, `attemptGrades`, `liveStepDown(grades)` (in-session
  drop: last boulder holding the highest colour — horizontal, last → first), `pendingStepDowns`
  (early falls the log doesn't show as applied), `suggestNextFourByFour(runs,
  { bouldersPerSet, flashLevel, authored })` → `{ direction, grades,
  lastTime, note }` or `null`.
- Block: `FourByFourBlock.boulderGrades?: string[]`.
- **Coach editor** — `FourByFourFields`: `BoulderSlots` (numbered circles) +
  `GradePicker` to recolour the selected slot; "Clear colours". When authoring
  for an athlete: flag with the suggested slots + "Use these colours"
  (computed with `authored: null`, so the first-session flash − 1 suggestion
  shows even while the coach edits colours). Reads the athlete's
  `flashLevel` via `getUsers`.
- **Athlete runtime** — `components/FourByFourBlock.tsx`: loads
  `getSessions()` + own user row on a fresh start, preloads the suggested
  colours, banner with one override link, "Choose my own colour" (the
  old one-colour picker; Start waits for a pick). Start waits for the
  load. Logs `scData: { tops, set, grades }`, `level` = hardest slot.
  **Live step-down (2026-10-03):** after logging a set 1–2 with a fall (and
  sets remaining), `liveStepDown` lowers a boulder and the next set shows a
  notice. On resume: colours of the last logged set, plus any drop owed.
  Review shows each set's colours as dots.
- Test: `scripts/progression-tests/fourByFour.test.ts`.
- **Coach-tested and approved in the app 2026-10-03.**

### 4.5 Intervals (spec §3.4) — built 2026-10-03
- Coach revised the rule: two kinds (warm-up / power endurance), picked on
  the block; falls + one yes/no question instead of RPE.
- `INTERVALS_RULES` in `profiles.ts` (`workStep 10`, `minWork 30`,
  `maxWork 90`, `earlyFallFraction 2/3`); profile `built: true`.
- **Pure rules** — `utils/progression/intervals.ts`: `IntervalsKind`,
  `INTERVALS_KIND_LABEL`, `intervalsLog(attempt)`, `earlyFallLimit(series)`,
  `clampWork`, `liveWorkAfterFall`, `intervalsDescription`,
  `suggestNextIntervals(runs, kind)` → `{ direction, workTime, series,
  lastTime, note }` or `null` (no kind / no history / old logs without
  answers).
- Block: `IntervalsBlock.kind?: IntervalsKind`.
- **Coach editor** — `IntervalsFields`: Kind chips (tap again to clear) +
  flag with "Use N s work" when authoring for an athlete. Series/work/rest
  are still edited in `BlockNumerics`.
- **Athlete runtime** — `components/IntervalsBlock.tsx`: preloads the
  suggested work time + rounds with a banner ("Choose my own time" → 30–90 s
  chips, rounds back to the block's). "I fell" during work, during the rest
  after a round ("I fell in round N") and on the done screen ("I fell in the
  last round"). "I fell" during work calls `endWork` — the round ends and
  the rest starts at once. Warm-up: each fall cuts 10 s off the following rounds
  (`liveWorkAfterFall`; `workRef` feeds the chained timers, `roundWork` keeps
  the running round's length). With no fall the done screen asks the kind's
  question and Continue waits for Yes/No. Logs `scData: { kind, series,
  workTime, startWorkTime, restTime, fellInRound?, falls?, pumped?,
  veryEasy? }`, `success: true` as before. Revisiting a finished block no
  longer logs a second attempt.
- Coach requests 2026-10-03: generated description (`intervalsDescription`,
  editor shows it read-only; `block.description` is now "Notes"); Warm-up
  chip sets `series` to `INTERVALS_RULES.warmupSeries` (4); Pause/Resume on
  the timer (`pauseTimer`/`resumeTimer`, `onDoneRef`/`endRef`/`pausedMsRef`).
  A temporary Skip button was used for the coach's testing and removed.
- Rule extras (2026-10-03): power endurance at 90 s → +1 round
  (`suggestion.series`); warm-up next session = finished work time, minus
  10 s per fall not cut live. Editor flag applies rounds + work time.
- 4×4 runtime: override is now only "Choose my own colour" (no "planned
  colours" option), per coach. Sequence too: `SequenceBlock.tsx`
  `declineSuggestion` always opens the route picker; `closePicker` restores
  the suggestion if they back out.
- `utils/methods.ts` `one_on_one_off` note rewritten to the rule.
- Test: `scripts/progression-tests/intervals.test.ts`.
- **Coach-tested and approved in the app 2026-10-03.**

### 4.6 Constraint warmup (spec §3.5) — built 2026-10-03

> **Updated 2026-10-04:** `utils/methodSelection.ts` and "Suggest next 3"
> are gone; warm-ups now come from the plan rotation
> ([`training-plan.md`](training-plan.md) §5–§6), groups are the plan
> focuses, and no flash level → orange.
- `profiles.ts`: `CONSTRAINT_WARMUP_RULES` (count 3, attempts [3,2,1],
  rampBelowFlash 2), types `WarmupPillar` / `ColourRange` /
  `ConstraintRotation`, and `DEFAULT_CONSTRAINT_ROTATION` (the coach's table,
  keyed by normalised name — **a first guess, editable per constraint**).
  `WarmupPillar` is a rotation **group**: `strength_power_endurance` |
  `power` | `general` (strength + power endurance merged, coach 2026-10-03).
  `warmupPillarFor(adaptation)` maps a training pillar to its group; old
  stored values are normalised in `rotationFor`.
- **Pure rules** — `utils/progression/constraintWarmup.ts`: `constraintKey`,
  `rotationFor(block)` (own `rotation` → default by name; empty pillars =
  out), `defaultRotation`, `allowedColours(range, flash)`,
  `warmupCandidates(rows)`, `warmupUsage(sessions, candidates)` (last
  warm-up's set + recency), `suggestWarmup(candidates, pillar, usage,
  flash)` → 3 `{ id, name, colour, attempts }` or `null` (no flash).
- **Editable settings** — `ConstraintWarmupFields` (`workoutBlocks.tsx`):
  "Warm-up rotation" pillar chips + colour-range chips + "Back to default".
  Writes `block.rotation` and, when the block has a `libraryBlockId`,
  straight to that library row's `data.rotation` (`updateBlock`), since
  the rotation reads library rows.
- **Training plan** — `utils/methodSelection.ts`: `mainPillarOf(slot)`,
  `warmupBlocks(picks, library)`, `planWarmups(suggestions, library,
  sessions, flash)` (per-slot picks, chained with `afterWarmup` so slot N+1
  avoids slot N's constraints), `warmupInsertIndex`;
  `blocksFromWorkoutSuggestion` takes that slot's picks and inserts the 3
  blocks after the S/C block;
  when it does, a technique pick whose method is a constraint_warmup
  (`technique_drills`) is dropped from the draft (coach 2026-10-03).
  `AthleteAnalytics`: "Suggest next 3" re-reads the athlete's sessions
  first (suggestions aren't stored; each tap recalculates), computes
  `planWarmups` once, shows each slot's warm-up on its card and passes the
  same picks to Build.
- **Builder** — `components/SuggestedWarmupCard.tsx`, shown in
  `AthleteWorkoutBuilder` under the recent-sessions summary: pillar chips
  (default = workout's most common main pillar), the 3 picks with colour +
  attempts, "Add these to the workout" / "Replace the warm-up with these".
  No flash level → a one-line hint only.
- Test: `scripts/progression-tests/constraintWarmup.test.ts`.
- **Not verified in the running app** — needs the coach.

## 5. Next steps, in order

### 5.1 Four-by-four — built (§4.4), coach OK 2026-10-03

### 5.2 Intervals — built (§4.5), coach OK 2026-10-03

### 5.3 Constraint warmup — built (§4.6), waiting on the coach (§6)

### 5.4 `utils/methods.ts` statuses (spec §4)

> **Superseded 2026-10-04:** `utils/methods.ts` and
> `AdaptationTargetModal.tsx` were deleted — nothing to do here.
Add `"rotate"` and `"test"` to `ProgressionStatus`; this will break
`PROGRESSION_LABEL` / `PROGRESSION_COLOR` in `components/AdaptationTargetModal.tsx`
(the only consumer — the status is display-only), so add entries there.
`project_bouldering` → `none`; `technique_drills`, `double_hands` → `rotate`;
`heavy_low_rep_sc`, `movement_pattern_circuit` → `auto` **only once the coach OKs it**.

## 6. Waiting on the coach

1. In-app test of constraint warmups (rotation chips in the block editor,
   builder card, training-plan draft).
2. Constraint warmup ASSUMPTION in spec §3.5: builder pillar default.
3. Then `utils/methods.ts` statuses (§5.4) and relabel the two S&C methods
   `auto` (label only).

Resolved 2026-10-02: sequence tested; the 4 sequence decisions confirmed;
route ranking stays per block; `flashLevel` column added.
Resolved 2026-10-03: all 4×4 assumptions confirmed (coach colours win the
first session, no-flash picker, all-or-nothing override, resized-block fitting);
4×4 approved in the app. Intervals: all assumptions confirmed; a fall ends
the round and starts the rest at once. Intervals tested and approved in the
app; Skip removed.
