# S&C block UX — in-workout redesign

Branch `v2`. Status: **Phases 1–3 done 2026-10-04, both-sides rework 2026-10-05 — not committed, not tried on a device** (type-check + tests; Phase 2 also checked on the web build with a mock block). Q1–Q4 decided. Scope: what the
athlete sees inside an S&C block (`components/StrengthConditioningBlock.tsx`)
from the intro to the review. The coach's block editor
(`components/workoutBlocks.tsx`) and the progression rules
(`utils/scProgression.ts`) only change where a phase says so.

> Phase 3.4 and Phase 4 below (stop logging un-entered reps, smart
> in-session adjustment) moved to `docs/sc-progression-plan.md`. The rules
> live there; this doc keeps only the UI side.

## 1. What's wrong today (from review + code)

| # | Problem | Where / why |
| --- | --- | --- |
| 1 | **Weight unit picker on the intro** even when nothing in the block takes weight (mobility, level-mode, timed holds, 7/3s). It also isn't saved: it resets to kg every block, and history weights are never converted, so switching to lb mislabels last time's numbers | `StrengthConditioningBlock.tsx:390` (`useState("kg")`) |
| 2 | **Looks like the old app**: centred text, `CustomButton` (radius 10–12), boxed "target" card, chips with borders. The new screens use left-aligned 28 / 800 titles, green caps kickers, radius 22 cards, 52-high radius-16 pill buttons, `surfaceHigh` rows | compare `LatestWorkoutCard.tsx` styles |
| 3 | **The photo isn't the hero.** A 16:9 thumbnail with a rounded border, then a separate `surface` box holding name + target | `ExercisePhotoBanner`, `targetRepsBox` |
| 4 | **Photo and name are split** into two cards | same |
| 5 | **Focus badge sits next to the name; the rep range sits in another row** — they belong together ("Max force · 3–6 reps") | `FocusBadge`, `targetRow` |
| 6 | **Logging is too much work, so it doesn't happen.** Reps = a −/+ stepper; weight + RPE hidden behind "▸ Weight & RPE"; RPE = 7 numbers (4–10) most athletes can't judge. Worse: the stepper **starts at the top of the range**, so an athlete who just taps Done logs the ceiling → triggers "Add weight next time?" and next session's ▲ suggestion on data they never entered | `RepsExerciseUI:1104`, `RPEChips`, `handleExerciseDone:305` |
| 7 | **Missing the rep floor does nothing in-session.** Only the ceiling triggers anything (an `Alert`). Under the floor the next round is the same weight/level | `handleExerciseDone:297-328` |
| 8 | **7/3s can't be paused** (chained `setInterval`s with no stored remaining time). Also: no way to stop early or skip. (Screen sleep is *not* an issue — `WorkoutContext` keeps the screen awake for the whole workout.) | `SevenThreesUI` |
| 9 | **7/3s screen** is a small 200px ring, labels in grey, no photo, no sense of "series 3 of 6" beyond a line of text | same |
| 10 | **Fullscreen photo zoom**: uses `ScrollView maximumZoomScale`, which is **iOS-only** — no pinch on Android, no double-tap, and the inner `Pressable` can steal the gesture | `ExercisePhotoBanner:995` |
| 11 | **Mobility holds**: the plan builder *does* prescribe them in seconds (`mobilityDraft` → `unit: "seconds"`, `defaultHold` or "20-30"), and the UI does show a timer — but it's a manual stepper + "Start timer" button; **both-sides holds only get one timer** (no left → right); a range "20-30" silently becomes 30. Need to check the coach's manual block editor: a "Both" mobility exercise added there may arrive as reps with no hold | `MobilityExerciseUI`, `scPlanBuilder.ts:124`, `workoutBlocks.tsx` |

## 2. Target design (per exercise screen)

```
┌──────────────────────────────┐
│ ←  Round 2 of 3        3/5   │  TopBar (unchanged) + thin progress bar
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│      PHOTO, full-bleed,      │  ~45% of screen height, cover-cropped,
│      tap → zoomable view     │  fades into C.bg at the bottom
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│ Bulgarian split squat · Left │  28 / 800, overlaps the fade
│                           ⓘ │  (side only on both-sides exercises)
│ ● Max force · 3–6 reps       │  focus colour dot + range, one line
│ 20 kg  ▼ from 22.5 kg        │  load line (only if weight/level)
│                              │
│  How many reps?              │
│  [ 3 ][ 4 ][ 5 ][ 6 ][ 7+ ]  │  big tap targets, the range ±1
│  How did it feel?            │
│  [ Easy ][ Solid ][ Max ]    │  3 options, not RPE 4–10
│                              │
│ [        ✓  Done         ]  │  pinned 52px pill
└──────────────────────────────┘
```

Principles:

- **Photo + name + target are one unit** at the top, no card boxes between
  them. No photo → name block starts at the top, `ⓘ` opens notes.
- **Focus + range on one line** under the name, coloured with
  `FOCUS_COLOR`.
- **Logging = at most two taps + Done.** Reps as chips around the focus's
  range (e.g. max force 3–6 → `2 3 4 5 6 7+`; "−/+ edit" fallback for
  anything else). Effort as 3 words mapped to RPE inside the focus band:
  Easy = below band, Solid = mid-band, Max = above band. Weight shows as a
  line ("20 kg") that opens a stepper only if tapped.
- **Nothing is prefilled as "done".** No reps chip selected by default and
  **Done is disabled until reps are picked** (decided, Q2) — so the
  ceiling is never logged by accident.
- **Same look as the new screens**: left-aligned, `LatestWorkoutCard`
  type scale and radii, one pill button pinned at the bottom.

## 3. Phases

Each phase ends with type-check + tests + a report; I stop for approval
before the next.

### Phase 1 — Quick fixes ✅ 2026-10-04
1. **Weight unit**: removed from the intro. Remembered per device
   (`utils/weightUnit.ts`, AsyncStorage key `sc.weightUnit`, default kg),
   loaded together with the history prefill (so the "Suggested ▲ 20kg →
   21kg" note uses it). Switched with a small kg | lb toggle next to the
   "Weight" label; the stepper value shows the unit. Only appears where a
   weight stepper does — never for mobility, level mode or 7/3s.
   Not done: history weights logged in the other unit aren't converted.
2. **Zoomable photo** (`components/ZoomableImage.tsx`): pinch (up to 4×),
   pan while zoomed (clamped to the image edges), double-tap to zoom 2.5×
   around the finger / reset, single tap at 1× → back to the notes sheet
   (or close), swipe down at 1× to close. gesture-handler + reanimated,
   with its own `GestureHandlerRootView` because an Android `Modal` sits
   outside the app's. The S&C photo viewer is the only fullscreen photo
   viewer in the app, so there was nothing else to swap.
3. **7/3s pause / resume**: the countdown keeps its end time and next step
   in refs; Pause stores the time left, Resume restarts from it. A Pause /
   Resume button sits under the ring during get-ready, hang and rest; the
   ring label reads PAUSED. Keep-awake dropped from the plan (already on
   for the whole workout).

### Phase 2 — Exercise screen layout ✅ 2026-10-04
Visual only, no logic changes. New building blocks in
`StrengthConditioningBlock.tsx`:
- `PillButton` — the 52-high, radius-16 green button from
  `LatestWorkoutCard` (grey `secondary` variant for Skip rest). Replaces
  `CustomButton` everywhere in the block.
- `ExerciseScreen` — scrolling content + the button **pinned below it**,
  so Done is always in the same place. Each exercise screen owns its
  scrolling now (the circuit no longer wraps them in a ScrollView).
- `ExerciseHeader` — green caps kicker ("Exercise 2 of 4 · Left side"),
  28 / 800 name with ⓘ (coach's notes) beside it, then one line pairing
  focus and target: "● Max force · 3–6 reps" in `FOCUS_COLOR`, "●
  Mobility · 30s", or just the amount when there's no focus. Ranges get
  an en dash.
- `ExerciseRow` — photo thumb (or a barbell / body / hand icon), name, the
  same focus · target line. Used on the intro and as "Up next" on rest.

Screens:
- **Exercise** (reps, both-sides, mobility, 7/3s ready): the photo is a
  full-bleed 4:3 hero, cover-cropped, capped at 45 % of the screen height,
  fading into the background; the header overlaps the fade. Expand badge
  top-right. The yellow easier-round banner sits under the header, then
  the reps input, then "Weight & RPE". No photo → header at the top.
- **Circuit**: thin green progress bar under the TopBar (exercises done ÷
  all exercises in all rounds); the "3/5" on the right of the TopBar is
  gone (the kicker says it).
- **Intro**: hero, kicker + block name + "3 rounds · 4 exercises · 1 min
  rest", description, exercise rows, Start pinned.
- **Rest**: kicker + "Round 2 of 3 next", 260 ring, easier-round notes as
  yellow cards, "Up next" row, Skip rest pinned.
- **Review**: kicker + "Circuit complete", "Next time" and round cards at
  radius 22, Continue pinned.
- Chips and inputs: borderless `surfaceHigh` fills, radius 12–14; labels
  12 / 700 caps.
- 7/3s timer screens: only wrapped in the new frame (Phase 5 redesigns
  them). Also fixed: the hold timer's seconds weren't centred.

Cropping trade-off: 4:3 cover cuts ~12 % off each side of a 16:9 photo.
Tapping still shows the whole photo.

### Phase 3 — Low-friction logging ✅ 2026-10-04 (built in `sc-progression-plan.md` Phase 4)
Rep buttons + Other, Easy/Solid/Max effort, the weight line, and Done
locked until reps are picked. Q6 resolved: Done locked, no `repsEntered`.
1. Reps chips (range-aware) + "edit" fallback for out-of-range values.
2. Effort: Easy / Solid / Max → RPE in the focus band (stored as RPE,
   so `scHistory` / `suggestProgression` keep working). Level mode keeps
   reps-only.
3. Weight shown as a line; tapping opens the stepper inline.
4. **Done disabled until reps are picked** — fixes the ceiling false
   positive (today the stepper starts at the top of the range).
5. Both-sides: keep left → right (decided, Q3). The right side's reps
   used to be prefilled from the left; dropped 2026-10-05 because it let
   Done log the left's number as the right's (breaks Q2). Weight / level
   still carry over.

### Phase 4 — Smart in-session adjustment → moved
Built in `docs/sc-progression-plan.md` Phase 3 (2026-10-04): under the
floor → next round −10 % or one level down, applied automatically with a
yellow banner + Undo, listed on the rest screen; the popups are gone. The
Phase 2 layout here already shows it.

### Both-sides: side glow + switch moment ✅ 2026-10-05 (from review)
Athletes missed the small "Left side" in the kicker. A first fix (a big
green LEFT / RIGHT tracker pinned above the photo, plus the side repeated
in both section labels) made the screen cluttered: four places said the
side, the green bar competed with the Done button, and it pushed the photo
off the top. Replaced with (iterated with the user):
- **Side glow** (`SideGlow`): a subtle mint (16 %) → transparent gradient in the
  background, coming in from the side being worked — left to right on the
  left side, right to left on the right. Behind all text, chips and the
  button (`ExerciseScreen`'s `background` slot; the footer goes
  transparent). The photo sits on the glow too: its bottom fade goes into
  bg + glow instead of plain bg (`GlowFade`, an SVG rect with the glow's
  gradient masked top → bottom — react-native-svg, no new native module),
  so the upper photo stays untinted and there's no seam.
- **Side in the title**: "Bulgarian split squat · Left", the side in mint
  (non-breaking spaces keep it on the name's last word when it wraps). No
  badge on the photo. On
  the right side the title and target line are right-aligned.
- **Switch moment**: "Switch to right side" shows a full-screen card
  (arrow · "Switch sides" · "Right side", right-aligned, 35 % glow) for
  1.5 s, tap to skip, with a haptic.
- **Design-review fixes (2026-10-05)**:
  - Right side reps start unpicked (see Phase 3.5).
  - Everything stays left-aligned on both sides (the right-aligned
    title made the screen half right, half left, and the header jumped).
  - The switch card shows on the block's first switch only. Later
    switches get the glow, the title and the haptic.
  - The side colour is its own lavender `C.side` (#A78BFA), not green,
    because green already means "primary action / progress".
- No left-side summary / Edit (user: not needed). Section labels don't
  repeat the side. Effort is still logged per side; no mirrored photo
  (both decided).

### No "Exercise n of n" kicker ✅ 2026-10-05 (from review)
Removed from every exercise screen (reps, mobility, both-sides, 7/3s ready
and done) — the progress bar under the TopBar already shows where you are.
The header is now name + focus · target. The intro / rest / review screens
keep their kickers ("Strength & conditioning", "Rest", "Block done").

### Phase 7 — Brief → (timer) → log ✅ 2026-10-05 (from review)
How the exercise is used: the athlete reads it, puts the phone down,
trains, comes back and reports. One screen doing both jobs was cluttered
(worst on timed both-sides). Split by **before vs after**, not by amount
of stuff:

- **Brief** (before): photo hero, name, focus · target, and a one-line
  **focus cue** saying what the focus means right now (`FOCUS_CUE` in
  `scProgression.ts`, e.g. Max force → "Heavy. Stop with 1–2 reps in the
  tank. Rest fully."). Everything that sets the load lives here: weight /
  level, suggestion note, easier-round banner, swap banner. Load is set
  before lifting, not reported after. Button: "Log reps" (rep-counted) or
  "Start timer" (timed).
- **Timer** (during, timed exercises only): compact header + the hold
  timer. Both-sides: left timer → "Switch to right side" → right timer.
  The side glow and the switch card (first switch of the block only) live
  here and nowhere else. "Enter seconds instead" goes straight to Log.
- **Log** (after): compact header (thumb, name, load; tap → back to Brief),
  then reps chips (timed: the measured seconds, editable), one optional
  effort, Done. Both-sides: **Left** and **Right** reps on the same screen,
  Done locked until both are picked. No left → right screens for
  rep-counted exercises — the athlete doesn't come back between sides.

Rules:
- **Round 2+ skips Brief** (starts on Log, or Timer if timed) — the
  athlete already knows the exercise. Brief still shows when the round
  was made easier (drop banner) or the exercise was just swapped. The
  compact header always gets you back to Brief.
- Both-sides logs **one load and one effort** for both sides
  (`weightLeft` = `weightRight`, `rpeLeft` = `rpeRight`). `readRound`
  already takes the weaker side's reps and the harder side's RPE, so
  progression is unchanged.
- 7/3s already works this way (ready → timer → done + effort). Mobility is
  unchanged (one screen, nothing to log beyond Done; Phase 6 covers it).
- Removed: the side in the title (`ExerciseHeader side`) and the photo's
  glow fade (`GlowFade`) — no photo on a side-specific screen any more.
- Replaces the two-screen left → right flow and Q3's "right prefilled from
  left" for rep-counted exercises.

### Phase 5 — 7/3s screen redesign
Full-screen, phase-coloured: big countdown (≥ 96 pt) inside a large ring,
**HANG** green / **REST** grey / **GET READY** yellow, row of series dots
(done / current / to come), edge + photo on the ready screen,
Pause · Skip · End-early controls, haptic + sound on each change. Done
screen: series completed + Easy/Solid/Max effort.

### Phase 6 — Mobility hold timer
Done early (2026-10-05, from review): the idle timer no longer looks like
the logged value. "Hold timer" label (was "Seconds done"); length shown
big with a "Timer length" caption and −5 s / +5 s buttons (min 5 s);
full-width "▶ Start 30 s hold"; when finished it reads "LOGGED 30 s" with
"Redo hold".

1. **Check** both paths that create mobility holds: plan builder (OK in
   code) and the coach's manual editor in `workoutBlocks.tsx` (adding a
   "Both" mobility exercise — does it use `defaultHold`?). Fix the editor
   if not.
2. Timed mobility: the timer is the screen — big countdown, Start
   button, prep 5 s, auto-mark done at 0. Range "20-30" → counts to the
   low end, shows "+10 s optional" after.
3. Both-sides holds: left → right automatically (short switch countdown).
4. Rep-based mobility unchanged (just Done).

## 4. Open questions

- **Q1** ✅ Effort = Easy / Solid / Max, mapped to RPE in the focus band.
- **Q2** ✅ Reps must be picked before Done.
- **Q3** ✅ Both-sides stays left → right. Right reps not prefilled (Q2 wins).
  Superseded by Phase 7: rep-counted both-sides log both sides on one
  screen; only timed holds still run left → right.
- **Q4** ✅ Auto-adjust with Undo (built in `sc-progression-plan.md`
  Phase 3).
- **Q5** ✅ Phase order as listed.
- **Q6** ✅ Done locked until reps are picked (user, 2026-10-04); no
  `repsEntered` flag.

## 5. Files

| File | Change |
| --- | --- |
| `components/StrengthConditioningBlock.tsx` | Phases 1–6 (likely split: `sc/ExerciseScreen.tsx`, `sc/SevenThrees.tsx`, `sc/HoldTimer.tsx`) |
| `components/ZoomableImage.tsx` | New, Phase 1 |
| `utils/weightUnit.ts` | New, Phase 1 — saved kg / lb |
| `utils/scProgression.ts` | `adjustNextRound`, effort → RPE mapping (Phases 3–4) |
| `utils/scHistory.ts` | Ignore rounds with no entered reps (Phase 3) |
| `components/workoutBlocks.tsx` | Only if Phase 6 check finds the manual editor drops holds |
| `scripts/progression-tests/` | Tests for the above |
| `docs/progression-spec.md`, `docs/training-plan.md` | Kept in sync |
