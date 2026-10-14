# S&C — exercise settings & explosiveness (plan)

Branch `v2`. Status: **Phases 1–4 built (uncommitted), not tried on a device.** Appwrite: add `settingHarder` / `settingEasier`. Builds on
[`sc-progression-plan.md`](sc-progression-plan.md) (rules, ladders,
in-session drops).

## 1. What the coach noticed

1. **Some exercises have a setting that changes the difficulty a lot**,
   without changing the exercise:

   | Exercise | Setting |
   | --- | --- |
   | Elevated push-up | Bench height (lower = harder) |
   | Jumps into box | Box height |
   | Jumps to catch | Rung height |
   | Chest flys | How horizontal the body is |
   | Assisted pistol squat | How far you lean back |
   | Inverted row, one-arm inverted row | How far you lean back |
   | Band-assisted pull-ups | Band (thinner = harder) |

   Today the app only knows weight or ladder level, so it can't track or
   suggest any of these.

2. **The rule for these exercises:** reaching the top of the rep range
   should make the *setting* harder first. Only when the athlete is on
   the hardest setting **and** reaches the top of the range should the
   app suggest the next ladder level. Today it jumps straight to the next
   level.

3. **Explosiveness isn't progressed by reps.** Max force and hypertrophy
   progress by reps done. Explosiveness progresses by speed, and the app
   can't measure speed. Decided: **leave speed to the athlete** (every rep
   as fast as possible). The rules shouldn't treat "more reps" as
   progress for explosiveness.

4. **The plan rotates focus, but the load doesn't follow.** The plan gives
   an exercise max force one time and explosiveness another. The weight
   or level that suits max force can't be moved fast, so explosiveness
   needs an easier version:
   - **Weight:** about half.
   - **Ladder:** an easier level.
   - **No easier level:** an easier setting (lower box, more lean, the
     easiest band).

   Today the explosiveness session only looks at earlier explosiveness
   sessions. The first time, it starts on whatever the block prescribes.

## 2. Proposed design

### 2.1 Settings on an exercise (library) — decided: no numbers

> **Naming (2026-10-06, coach):** athletes and coaches see **"Exercise
> setup"** — the Brief card title, the "I'm on the hardest setup" toggle,
> the form section ("Fixed setup / Adjustable setup"), and "· hardest
> setup" in the coach's history. "Setting" read like an app preference.
> In code the names stay `setting*` (`settingHarder`, `atHardestSetting`,
> `ExerciseSetting`).

Angles and heights are judged differently by each athlete ("45°" or
"50 cm" isn't the same for everyone), so the app **doesn't measure the
setting**. It trusts the athlete's judgement.

In the exercise form (weight or ladder mode), an optional **"Has an
adjustable setting"** section with two short coach hints:
- **How to make it harder:** "Lower the bench".
- **How to make it easier:** "Raise the bench".

These are stored on new `exercises` columns, `settingHarder` and
`settingEasier` (String, optional — **Appwrite: you add them**).

### 2.2 In the workout

- On an exercise with a setting, a switch: **"I'm on the hardest
  setting"**. It's prefilled from last time, and the athlete turns it on
  when they believe they are.
- Each logged round records it (`atHardestSetting`).

### 2.3 Progression order

| Result | Exercise with a setting |
| --- | --- |
| Every set at the top, switch **off** | Next session: same level / weight, note "**Make it harder: lower the bench**" |
| Every set at the top, switch **on** | Next ladder level (or weight), as today |
| A round under the floor (in session) | Banner only: "**Make it easier this round: raise the bench**". No automatic change (Q5). If the switch was on, it turns off |

### 2.4 Explosiveness

- **No rep-based step up or down for explosiveness.** Reps over the top
  don't count as progress, and missing the floor still makes the next
  round easier (it's too heavy to move fast).
- **Explosiveness starts from the athlete's max force load:**
  - Weight: **50 %** of the last max force weight, rounded to the
    smallest weight jump.
  - Ladder: **one level easier** than their max force level.
  - At the easiest level with a setting: the note says "**Make it easier
    for speed: raise the bench**". No easier setting and no ladder
    (e.g. pull-ups): the note says use the easiest assistance (band).
  - Explosiveness history is used only when there's no newer max force
    session, so explosiveness follows max force as it improves.
- **Hypertrophy is unchanged** (its own history, rep-based).

### 2.4b Second exercise / first time at a focus (decided 2026-10-05)

**How the plan rotates.** A pattern's two exercises alternate by workout
(`exerciseSlot`), and the focus cycles max force → hypertrophy →
explosiveness (`SC_FOCUS_FOR`). So each exercise meets each focus once
every 6 workouts (about 3 weeks), and about twice in a 6-week plan:

| Workout | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| Focus | MF | Hyp | Exp | MF | Hyp | Exp |
| Exercise | 1st | 2nd | 1st | 2nd | 1st | 2nd |

**Gaps.**
- An exercise's first session at a focus has no starting point (empty
  weight, the coach's level). That's the 2nd exercise in workout 2 and
  the 1st in workout 5, even though they already have history at other
  focuses.
- Stall (3 sessions) and deload (2 in a row) counted per focus can't
  trigger within one plan.

**Decided: borrow from other focuses.** When there's no history at
today's focus:
- **Weight:** estimate a one-rep max from the latest **max force or
  hypertrophy** session (Epley: `w × (1 + reps / 30)`, using the final
  load's best set). Today's weight = `e1RM / (1 + r / 30)`, where `r` is
  the middle of today's focus range (4.5 for 3–6, 10 for 8–12). Rounded
  to the weight jump. Explosiveness sets aren't near failure, so they
  aren't used to estimate.
- **Ladder:** hypertrophy = **one level easier** than the latest max
  force level; max force = **one level harder** than the latest
  hypertrophy level. Skips levels not tagged for the focus.
- **Explosiveness:** as §2.4. With no max force history, it uses half the
  weight estimated from hypertrophy, or one level easier than the
  hypertrophy level.
- **No history at any focus:** as today.
- The note says where it came from: "From your max force (40 kg × 5): ~35
  kg for 8–12".

**Decided: stall / deload count across focuses.**
- **Deload:** the last **two sessions at any focus** both went ▼ →
  flagged for the coach. (First built as −10 % / one level for the
  athlete; changed, see below.)

> **Changed 2026-10-06 (coach): deload is coach-only.** When the last two
> sessions (any focus) both went ▼, the coach sees it: a red "Down 2×"
> badge in the athlete's S&C list, a warning on the exercise's progress
> card, and a line in the workout editor ("consider backing off"). The
> athlete gets **nothing**: no note, no extra drop. Their next session
> follows the normal rules. `flags.deload` is only read by coach screens.

- **Stuck:** no ▲ in the last **3 max force / hypertrophy sessions** (any
  mix). Explosiveness never steps up, so it's left out of the count.
  Flagged for the coach.

### 2.5 Coach screens

- The progress card shows "hardest setup" in "Did" ("Bodyweight ·
  hardest setup · 6, 6, 5 reps").
- "Next session" mentions the setting.

## 3. Phases (order decided 2026-10-05)

1. **Explosiveness.** §2.4: start from max force (50 % / one level
   easier), no rep-based step up; under the floor still drops. Tests.
   — **built 2026-10-05:**
   - `utils/scProgression.ts`: `decideNext` never returns ▲ for
     explosiveness (new reason `speed_focus`, "keep every rep as fast as
     you can"). Misses still step down. The in-session drop is unchanged.
   - `utils/scNext.ts`: `planNextForFocus(ex, chain, loadStep, unit,
     entries, when)` takes sessions at any focus.
     - Explosiveness starts from the latest **max force** session
       whenever it's newer than the last explosiveness one: 50 % of the
       weight, rounded to the weight jump (at least one jump), or one
       level easier. At the easiest level or bodyweight, a note.
     - Other focuses use their own focus's history (`planNext`).
     - Explosiveness is never flagged "stuck".
   - Callers switched to it: the workout prefill (reads 10 sessions at
     any focus, `HISTORY_LOOKBACK`), the "Next time" card, the coach's
     history (`scCoach.ts`, lookback 12) and the editor flag
     (`workoutBlocks.tsx`).
   - Tests: added to `scripts/progression-tests/scNext.test.ts`.
   - Not done: the "make it easier for speed" note can't name the
     exercise's setting yet (Phases 2–3).
   - **Follow-up 2026-10-05: some exercises can't be done fast**
     (negatives, isometric holds). Ladder moves now skip levels whose
     **"Used for"** doesn't include that day's focus.
     - `ResolvedChain.focuses` comes from the library, with `usableAt`
       in `levelChain.ts`. `stepLevel(..., usable)` skips unusable steps
       and stays put when none are left.
     - It applies to the max force → explosiveness step, next session's
       ▲/▼, and the in-session drop.
     - Example: Pull Ups at max force → explosiveness skips Negative
       pull-ups and chin-up isometric → Band Assisted Pull-Ups.
     - **Coach to tag in the library:** "Used for" = max force +
       hypertrophy on *Negative pull-ups*, *chin-up isometric* and
       *Front lever*. Untagged means all three, so the app treats them
       as explosive today.
1b. **First time at a focus + cross-focus safety rails** (§2.4b). Tests.
   — **built 2026-10-05** (`utils/scNext.ts`):
   - `planNextForFocus` borrows when there's no history at today's focus
     (`borrow`):
     - Weight: Epley e1RM from the latest max force / hypertrophy
       session's best set, converted to the middle of today's range,
       rounded to the weight jump.
     - Ladder: hypertrophy one easier than max force, max force one
       harder than hypertrophy, skipping levels not tagged for the focus.
     - Explosiveness with no own and no max force history: half the
       max-force-equivalent from hypertrophy, or one level easier.
     - Timed holds and bodyweight: nothing to estimate.
   - `crossFocusRails` (deload / stuck across focuses) feeds `planNext`
     through its new `rails` option. *(Superseded 2026-10-06: deload is
     coach-only, see §2.4b.)* A deload now always backs off one
     step (−10 % or one level), whatever that session's own result was.
     The note reads "Deload ▼ 30 → 27 kg — down two sessions in a row".
   - `FocusEntry` carries `prescribed` / `unit`, so each past session is
     judged at its own target.
   - The coach's history and the editor flag get all of this through
     `planNextForFocus`; nothing changed in them.
   - Tests: added to `scNext.test.ts` (borrowing both ways, weight jump,
     ladders, the real rotation's first hypertrophy day, cross-focus
     deload / stuck).
2. **Settings in the library.** Coach hints in the exercise form + the
   two columns. — **built 2026-10-06:**
   - `ExerciseRow.settingHarder` / `settingEasier` (optional String) and
     `OPTIONAL_EXERCISE_FIELDS`.
   - Exercise form, non-mobility: an "Exercise setup" section with
     "Fixed setup / Adjustable setup" and the two hints. Switching off or
     emptying clears them ("").
   - Copied into plan-built blocks (`scPlanBuilder`) and the block
     `Exercise` type as an offline fallback; the workout reads the live
     library in Phase 3.
   - **Safer saves:** `createExercise` / `updateExercise` go through
     `writeExercise`. When Appwrite rejects an unknown column, only that
     column is dropped and the save retried; the rest is kept. Before,
     one missing column dropped every optional field. This closes
     `sc-progression-plan.md` §8.1's risk.
   - Checked on the web build (form only, nothing saved).
   - **Appwrite (you):** add `settingHarder` and `settingEasier`, String,
     optional, size ~200, to `exercises`. Until then hints aren't saved;
     the rest of the exercise still is.
3. **Settings in the workout + progression.** The switch, logging, and
   the order in §2.3. Tests. — **built 2026-10-06:**
   - **Engine:**
     - `planNext` with `ex.setting`: ▲ only when the last session ended
       on the hardest setting. Otherwise it keeps the load with "Make it
       harder: lower the bench — 12 reps on every set".
     - A non-deload ▼ keeps the load with "Make it easier: raise the
       bench — …". A deload still steps down for real.
     - `NextPlan.atHardest` is the switch to start on next time: off
       after a new level, a miss, or a "make it harder" note.
     - Explosiveness at the easiest level uses the easier hint ("raise
       the bench so you can move fast").
   - **History:** rounds log `atHardestSetting`, read as `ScRound.hardest`.
     The setting is part of the load in `setsAtFinalLoad`, so rounds
     before reaching the hardest setting don't judge rounds on it.
     `ScSetsSummary.atHardest`.
   - **In session (Q5):** `planRoundDrop(..., settingEasier)` gives a
     banner only ("Make it easier this round: raise the bench — you got 7
     of 8–12 reps"). No automatic change, no Undo, and the switch turns
     off.
   - **Screen:** the Brief shows an **Exercise setup** card (Harder / Easier
     hints + "I'm on the hardest setup" switch) under the load. Hints
     come from the live library (block copy offline; a swap brings its
     own). The switch is prefilled from `planNextForFocus`, then from the
     last round.
   - **Coach (Phase 4, done here):** "Did" shows "· hardest setup", and
     the coach history and editor flag pass the hints to the rules.
   - Tests: `scNext.test.ts`, `scProgression.test.ts`.
   - Checked on the web build with a mock block: the card, the switch, a
     7-rep miss → banner, the switch reset, and "Next time: Make it
     harder".
4. **Coach screens + docs.** — done with Phase 3.

#### 2.3b In-round banners — current rules (2026-10-06)

The banner shows on the **next round** of that exercise (none after the
last round).

| Exercise | Under the minimum | Above the top (13+ on 8–12) |
| --- | --- | --- |
| With an exercise setup (toggle off) | "Make it easier this round: raise the bench" — suggestion; toggle turns off | "↑ Make it harder this round: lower the bench" — suggestion |
| With a setup, toggle on | as above | weight exercise: "Add a little weight: try 21 kg"; ladder: nothing (next level next session) |
| Weight, no setup | "Lower the weight a little: try 18 kg" (~−10 %) — **suggestion** | "↑ Add a little weight: try 21 kg" (~+5 %) — **suggestion** |
| Ladder, no setup | Automatic one level down, with **Undo** | Nothing — next session |
| Bodyweight, nothing to lower / easiest level | "Pick an easier exercise" | Nothing |
| Explosiveness day | as above | Nothing (more reps isn't the goal) |

Suggested weights are whole weight jumps, **between 0.5 kg and 2.5 kg**
per change (coach, 2026-10-06; also next session and deloads). A
coach-set jump above 2.5 kg, e.g. kettlebells, wins. Code:
`planRoundDrop` / `planRoundRaise` in `scProgression.ts`;
`RoundDrop.bannerOnly` (was `settingOnly`) marks a suggestion with no
automatic change.

**Added 2026-10-06 (coach rule): above the range → make it harder now.**
- A round **above the top** of the range (13+ on 8–12) on an exercise
  with an **exercise setup**, with "I'm on the hardest setup" **off**,
  makes the next round open on the Brief with a green banner: "↑ Make it
  harder this round: lower the box height — you got 13 of 8–12 reps".
- Banner only (like the "make it easier" one): nothing changes
  automatically and the toggle stays as it is.
- Not when the toggle is on (nothing harder to adjust; the level moves
  next session), not for ladders or weight without a setup (they wait
  for next session), not on explosiveness, and not after the last round.
- Exactly the top (12) still waits for next session.
- Code: `planRoundRaise` in `scProgression.ts` (`RoundDrop.raise`), called
  in `handleExerciseDone` when there's no drop. Tests in
  `scProgression.test.ts`. Checked on the web build.

**Added 2026-10-06 (coach request): what the suggestion is based on.**
Under the green round-1 suggestion on the Brief, a second line names the
past session it came from:
- "Last time · Sep 30 · 20 kg · 10, 9, 8 reps"
- "Based on · Sep 28 · Max force · Pull Ups · 5, 5, 4 reps" when it was
  borrowed from another focus or from max force.

The focus, exercise, weight and "hardest setup" are only named when they
differ or matter. `NextPlan.basis` is set by `planNextForFocus`;
`basisLine` in `scNext.ts` formats it. Tests in `scNext.test.ts`. It
couldn't be checked on the web build: the prefill needs a logged-in
athlete's real sessions.

## 4. Open questions

- **Q1 — decided 2026-10-05:** no numbers. Coach hints + the athlete's
  "I'm on the hardest setup" switch (athletes judge angles and heights
  differently).
- **Q2 — decided:** explosiveness = 50 % of the max force weight / one
  level easier.
- **Q3 — decided:** explosiveness never steps up from reps; it follows
  max force.
- **Q4 — decided:** explosiveness first.
- **Q5 — decided 2026-10-05: banner only.** A round under the floor on
  an exercise with a setting shows "Make it easier this round: raise the
  bench" and changes nothing automatically. The athlete knows whether
  they're already on the easiest setting; the app doesn't.
