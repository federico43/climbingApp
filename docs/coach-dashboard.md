# Coach dashboard

Status: **done 2026-10-16** (branch `coach-dashboard`). Checked with
type-check, lint, `coachRoster.test.ts`, the roster queries against live
Appwrite data, and visually on the web at 1400 / 1000 / 375 px with mock
data (screens behind login can't be opened from the preview). Not tried on
a device. §9 lists what changed from the phase-1 design.

Rewrites the coach's **Design** tab (`app/(tabs)/(buttonTabs)/design.tsx`)
as an analytics dashboard built for tablet / web, that degrades to
list → detail on a phone.

## 1. Goals

1. Find an athlete in one tap: a roster that is always visible on wide
   screens, instant search by name, quick filters.
2. See at a glance who has **pending homework** — a badge per athlete and a
   KPI row across the whole roster.
3. An athlete detail panel: homework (pending + recently done), the
   training plan and its next workout, the **same calendar the athlete
   sees**, recent activity.
4. Less on screen: the training-focus chart, S&C exercise list, frequency
   chart and month calendar go.

## 2. Breakpoints

From `useWindowDimensions().width` (same 900 threshold the workout builder
already uses for "wide"):

| Width | Layout |
| --- | --- |
| `≥ 1200` | 3 columns: roster (300) · detail main (flex) · detail side (360) |
| `900–1199` | 2 columns: roster (280) · detail (one column, side cards stacked below) |
| `< 900` (phone, small tablet portrait) | 1 column: roster screen → tap → detail screen with a back arrow |

The KPI row sits above the detail columns on wide layouts and at the top of
the roster screen on a phone. On a phone the detail is shown in place
(state, not a new route) so the tab, the mini workout bar and "back"
(hardware back on Android via `BackHandler`) behave as they do today.

## 3. Wireframes

### 3.1 Wide (≥ 1200)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Coach                                            [Exercises] [Spray wall]              ⚙︎    │
├──────────────────────┬───────────────────────────────────────────────────────────────────────┤
│ 🔍 Search athletes   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │
│                      │  │ 4           │ │ 9           │ │ 2           │ │ 3           │      │
│ [Homework 4] [No     │  │ athletes w/ │ │ workouts    │ │ athletes    │ │ inactive    │      │
│  plan 2] [Idle 7d 3] │  │ homework    │ │ this week   │ │ without plan│ │ 7+ days     │      │
│                      │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘      │
│ ┌──────────────────┐ │  (tapping a KPI applies the matching roster filter)                   │
│ │(A) Ana        ●2 │ ├────────────────────────────────────────────┬──────────────────────────┤
│ │    Wk 3/6 · 1d   │ │ Ana                       [Log session] ⋮  │ HOMEWORK            2 ⚠  │
│ ├──────────────────┤ │ Power endurance plan · Week 3 of 6         │ ▸ Density test           │
│ │(B) Bruno         │ │                                            │   Due Fri · Overdue  ›   │
│ │    No plan · 12d │ │ ┌ PLAN ──────────────────────────────────┐ │ ▸ Hangboard 7/3          │
│ ├──────────────────┤ │ │ Power endurance · 6 Oct → 16 Nov       │ │   Due Sun · Scheduled ›  │
│ │(C) Carla      ●1 │ │ │ 5 of 12 done · this week 1 of 2  [Edit]│ │ ─ done (3 wk) ─          │
│ │    Wk 1/6 · today│ │ │ NEXT: Workout 6 · Power      [Build]   │ │ ✓ Density test  Mon 6    │
│ ├──────────────────┤ │ │  S&C · explosiveness                   │ ├──────────────────────────┤
│ │ …                │ │ │  Warm-up · 1 on 1 off                  │ │ RECENT ACTIVITY          │
│ │                  │ │ │  Power · Moonboard 4×4 × 2   ⇄ Swap    │ │ Tue 14 · Workout 5 · 1h20│
│ │                  │ │ └────────────────────────────────────────┘ │ Sat 11 · Homework · 25m  │
│ │                  │ │ ┌ TIMELINE (athlete's card) ─────────────┐ │ Thu 9  · Workout 4 · 1h35│
│ │                  │ │ │ Start 6 Oct ───────────▶ End 16 Nov    │ │ (tap → session detail)   │
│ │                  │ │ │ [Week 3 of 6]            31 days left  │ ├──────────────────────────┤
│ │                  │ │ │   M T W T F S S                        │ │ ATHLETE                  │
│ │                  │ │ │ W1 ● ○ ● · · ● ·                       │ │ Readiness today: rest 4/5│
│ │                  │ │ │ W2 ● · · ● · · ●                       │ │ Flash level  ● ● ● ○ ○   │
│ │                  │ │ │ W3 · ◎ · ◇ · · ·   ◇ homework day      │ ├──────────────────────────┤
│ │                  │ │ │ …                                      │ │ TEMPLATES · 3     [+ Add]│
│ │                  │ │ └────────────────────────────────────────┘ │ ▸ Project day  ▶ ✎ ⋮     │
│ └──────────────────┘ │                                            │ VIDEOS                   │
└──────────────────────┴────────────────────────────────────────────┴──────────────────────────┘
```

Roster row: avatar initial, name, homework badge (●n, red if any overdue,
yellow otherwise), second line = plan status ("Wk 3/6" / "No plan" /
"Plan ended") · days since last session ("today", "1d", "12d", "—").
Selected row highlighted. Sorted: pending homework first, then by name.

### 3.2 Medium (900–1199)

Same as 3.1 minus the side column: KPI row, then detail header, Plan,
Timeline, Homework, Recent activity, Athlete, Templates, Videos stacked in
one scrolling column.

### 3.3 Phone (< 900)

```
 Roster screen                     Detail screen
┌──────────────────────────┐      ┌──────────────────────────┐
│ Coach        [🏋] [▦]  ⚙︎ │      │ ‹ Ana        [Log] ⋮     │
│ ┌────┐┌────┐┌────┐┌────┐ │      │ Wk 3 of 6 · PE plan      │
│ │ 4  ││ 9  ││ 2  ││ 3  │ │ ←KPIs│ ┌ HOMEWORK  2 ─────────┐ │
│ │ hw ││ wk ││noPl││idle│ │ swipe│ │ Density · Overdue  › │ │
│ └────┘└────┘└────┘└────┘ │      │ │ 7/3 · Scheduled    › │ │
│ 🔍 Search athletes       │      │ └──────────────────────┘ │
│ [Homework][No plan][7d+] │      │ ┌ PLAN · Next workout ─┐ │
│ (A) Ana          ●2   ›  │  →   │ │ … [Build]            │ │
│ (B) Bruno             ›  │      │ └──────────────────────┘ │
│ (C) Carla        ●1   ›  │      │ ┌ TIMELINE ────────────┐ │
│ …                        │      │ │ (athlete's card)     │ │
│                          │      │ └──────────────────────┘ │
│                          │      │ Recent activity          │
│                          │      │ Athlete · Templates ·    │
│                          │      │ Videos                   │
└──────────────────────────┘      └──────────────────────────┘
```

KPI cards scroll horizontally on a phone. On a phone the homework card goes
first (it's the reason to open the screen); on wide it's top of the side
column.

## 4. Panels: what they show and where the data comes from

### 4.1 Roster-wide data (loaded once on focus, shared by roster + KPIs)

New hook `hooks/useCoachRoster.ts` runs these in parallel, then derives a
per-athlete summary `{ pendingHomework, overdueHomework, plan, lastSessionDay }`:

| Data | Query | Notes |
| --- | --- | --- |
| Athletes | `users` — all rows (`listAllRows`) | `getAthletes()` used a single `listRows` with no limit → **only the first 25 users**. Now paginated. No role filter (coaches train too); the signed-in coach is **included**. |
| Homework (all) | `protocol` where `planPart = "homework"` | One query instead of one per athlete. Grouped by `athleteId`. |
| Active plans (all) | `training_plans` where `status = "active"` | Newest per `athleteId` (same rule as `getActiveTrainingPlan`). |
| Recent sessions (all) | `workoutsession` where `$createdAt ≥ today − 60 d`, `Query.select(["$id","$createdAt","userId.$id","protocolId","planId","planIndex","attempts"])`, ordered desc. `userId` is a **relationship**: it must be selected as `userId.$id` and comes back as an object, flattened to the id | `attempts` is needed for the session's real day (`sessionLocalDate` uses the first attempt's timestamp); the `protocol` JSON is skipped. Used for "last session", "workouts this week", and homework done-ness (`homeworkStatus` matches `protocolId`). |

Derived:

- **pending homework** = rows whose `homeworkStatus(hw, sessions, today)` is
  not `done` (i.e. `not_scheduled`, `scheduled`, `missed`, `cant_attend`,
  `overdue`). `overdue` and `cant_attend` mark the badge red.
  - Homework older than 60 days that was done by a session older than the
    window would look pending. Guard: homework whose `dueBy` is > 60 days
    ago is ignored by the roster (it's long past; the detail panel still
    loads the athlete's full history and shows the truth).
- **plan status** = no plan / "Wk n of 6" (`planWeek`) / "Plan ended"
  (`today > windowEnd`; `planIsOver` needs built workouts, the cheap date
  check is enough for the roster).
- **last session** = newest `sessionLocalDate` for the athlete; none in 60
  days → "60d+".

### 4.2 KPI row

| KPI | Definition | Tap |
| --- | --- | --- |
| Athletes with homework | athletes with ≥ 1 pending homework (subtitle: "n overdue") | filter "Homework" |
| Workouts this week | sessions from Monday 00:00 (local) to now, all athletes; split-off S&C / homework sessions count too (they're sessions the athlete did) | — |
| Athletes without plan | no active plan, or the active plan has ended | filter "No plan" |
| Inactive 7+ days | last session ≥ 7 days ago (or none in 60 d) | filter "Inactive" |

### 4.3 Roster

- Search: `TextInput`, filters on `username` as you type (case- and
  accent-insensitive, `normalize("NFD")`), client-side — no query.
- Filter chips (toggle, one at a time): **Homework** · **No plan** ·
  **Inactive** with a days selector `7 / 14 / 30` (tap the chip again to
  cycle; default 7). Chip shows its count.
- **Remember last athlete**: `AsyncStorage` key `coach.lastAthleteId`
  (already a dependency; per device). On wide layouts it is re-selected on
  load; on a phone the roster opens first (re-selecting would hide the
  list) but the row is highlighted and scrolled into view.
- Pull to refresh (phone) / refresh icon (wide) re-runs 4.1.

### 4.4 Detail header

Avatar, name, plan subtitle ("Autumn block · week 3 of 6"); **Log session**
(→ `workout-log`, as before; icon-only on a phone). No ⋮ menu.

### 4.5 Plan card (from `AthleteAnalytics`'s "Training plan" section)

Kept as-is functionally: plan name, dates, focus, S&C pattern chips,
"n of 12 built", **Next: workout n · week w** with its S&C / warm-up / main
lines (S&C exercises as chips per block), **⇄ Swap** on each line,
**Edit details** (opens `AthleteWorkoutBuilder` with the draft; was Build),
**Create** (saves the draft as is — the athlete sees it right away),
Edit / Start a plan / Start a new plan (`TrainingPlanModal`), the
"made before v2" notice. Adds "n of 12 done · this week n of 2"
(`donePlanWorkouts`, `doneThisWeek` from `utils/planProgress.ts` — the same
numbers the athlete sees).

Data: `getActiveTrainingPlan(athleteId)`, `listPlanWorkouts(planId)`,
`getSessionsByUserId(athleteId)` (full history: needed by Edit details / Create and by
`donePlanWorkouts`'s block-id matching of older sessions).

### 4.6 Timeline card — the athlete's calendar, reused

The athlete's "calendar" is the **Timeline card** on the Plan page
(`plan.tsx`: start → end, status pill, days left, the 6-week `DaysGrid`
with trained / today / to come / homework days, legend). It is inline in
`plan.tsx` today, so phase 2 **moves it** (no copy) into
`components/PlanTimelineCard.tsx`:

```ts
<PlanTimelineCard plan={plan} sessions={sessions} homework={homework} />
```

and `plan.tsx` renders that component instead of its inline JSX (`DaysGrid`,
`DateBlock`, `LegendDot` and their styles move with it). Homework days are
computed inside the card from the homework rows + sessions (same rule as
today). Without an active plan the card isn't shown (the Plan card says
"No training plan yet").

### 4.7 Homework card (from `AthleteAnalytics`'s "Homework" section)

Pending first (state colour, due date, workout n, the athlete's
"can't attend" note), then done ones from the last 3 weeks under a
"done" divider. Tapping a pending row opens `HomeworkCoachSheet` (change
deadline) — unchanged. Header count, ⚠ if any overdue. Empty: "No
homework". After a change, the roster summary for that athlete is updated
too (badge + KPI).

Data: `listAthleteHomework(athleteId)` + the athlete's sessions (4.5).

### 4.8 Recent activity

Last 5 training days (newest first): date, total minutes (`blockDurations`
sum, when saved), "n sessions" if more than one, and one chip per block
(name, left rail in its adaptation colour). Tap → `SessionDetailModal`
(feedback, edit, delete — as today from the calendar). "Show more" adds 5.

Reuse: the day-grouping and per-block summary logic of
`AthleteRecentSessionsSummary` (used by the workout builder). Phase 2
exports its pure helpers (group by day, block summaries) and renders a
compact variant; the builder's panel stays as it is. Data: the athlete's
sessions (4.5) — no extra query.

### 4.9 Athlete card

Today's readiness (`getCheckinForToday`) when there is one; flash level
picker (`setFlashLevel`) — both moved unchanged from `AthleteAnalytics`.

### 4.10 Templates + Videos

The current templates list (Test / Edit / ⋮ copy-delete / + Add) and
`AthleteVideos`, moved from `design.tsx` into the detail panel, compacted
(name + block count + actions; the block chips only on wide).

## 5. What is removed

All of it lives in `components/AthleteAnalytics.tsx`, which is only used by
`design.tsx`.

| Removed | Code that goes | Checked |
| --- | --- | --- |
| Training focus chart | "Training focus" section; `components/SessionBarsChart.tsx` | only imported by `AthleteAnalytics` |
| Frequency | "Frequency" section; `weeklyFrequency`, `trainingStats` | only used by `AthleteAnalytics` |
| — (dead already) | `weeklyAdaptationVolume`, `sessionBars` → whole `utils/athleteAnalytics.ts` | no other importer (grep) |
| Month calendar + "consistency" stats | "Training consistency" section, `getMondayOfWeek`, `countUniqueDaysInRange`, `countSessionsInMonth`, `trainedDays` | `react-native-calendars` stays — `past-workouts.tsx` uses it |
| S&C exercise list | "Strength & conditioning" section, `extractSCExercises`, `scBadges`, `getExerciseLibrary` call | `coachExerciseView` / `utils/scCoach.ts` stay (`exerciseProgress.tsx` + tests) |
| Horizontal athlete chip strip | in `design.tsx` | replaced by the roster |

`AthleteAnalytics.tsx` itself is then split into the cards of §4
(`components/coach/PlanCard.tsx`, `HomeworkCard.tsx`, `AthleteCard.tsx`,
`RecentActivityCard.tsx`) and deleted.

**Side effect to confirm:** the S&C list was the **only** way into
`exerciseProgress` (per-exercise S&C progression + deload/stalled flags).
Default in phase 2: keep the screen and give it one entry point that isn't
"S&C details" on the dashboard — tapping an S&C exercise inside
`SessionDetailModal` (opened from Recent activity) opens its progress.
Say "borra exerciseProgress" if you'd rather drop it.

## 6. Files (phase 2)

| File | Change |
| --- | --- |
| `app/(tabs)/(buttonTabs)/design.tsx` | Rewritten: breakpoint shell, roster, KPI row, detail |
| `hooks/useCoachRoster.ts` | New: roster-wide queries + per-athlete summary + KPIs |
| `utils/coachRoster.ts` | New, pure: summary/KPI/filter/search derivation (+ a test in `scripts/progression-tests/`) |
| `components/coach/RosterList.tsx`, `KpiRow.tsx` | New |
| `components/coach/AthleteDetail.tsx`, `styles.ts` | New: detail panel (loads the athlete's data, lays out the cards) |
| `components/coach/PlanCard.tsx`, `HomeworkCard.tsx`, `AthleteCard.tsx`, `RecentActivityCard.tsx`, `TemplatesCard.tsx` | New, from `AthleteAnalytics` / `design.tsx` |
| `components/PlanTimelineCard.tsx` | New, **moved** out of `plan.tsx` |
| `app/(tabs)/(buttonTabs)/plan.tsx` | Uses `PlanTimelineCard` |
| `components/AthleteRecentSessionsSummary.tsx` | Exports its pure helpers (`groupByDay`, `sessionDayKey`, …) |
| `scripts/coach-indexes/create-indexes.mjs` | New: the two Appwrite indexes (§7) |
| `components/SessionDetailModal.tsx` | S&C exercise → `exerciseProgress` (see §5) |
| `services/BoulderGraphService.tsx` | `getAthletes` paginated; new `listAllHomework`, `listActivePlans`, `listRecentSessions(sinceIso)` |
| `components/AthleteAnalytics.tsx`, `SessionBarsChart.tsx`, `utils/athleteAnalytics.ts` | Deleted |
| `docs/redesign.md`, `docs/training-plan*.md` | Point to this doc where they mention the coach's analytics |

Colours / spacing from `utils/theme.ts` (`C`) and `theme/`; no new palette.

## 7. Appwrite

No new tables or attributes. The new roster-wide queries filter on columns
that so far were only queried together with `athleteId` / `userId`, so
indexes may be missing:

| Table | Query | Index (key) | Needed? |
| --- | --- | --- | --- |
| `protocol` | `planPart = "homework"` | `planPart` | **Added** (`idx_planPart`) |
| `training_plans` | `status = "active"` | `status` | **Added** (`idx_status`) |
| `workoutsession` | `$createdAt ≥ …` order `$createdAt` desc | `$createdAt` | Not needed (internal index; checked live) |

Created 2026-10-16 with `node --env-file=.env.local
scripts/coach-indexes/create-indexes.mjs --apply` (key indexes
`protocol.idx_planPart`, `training_plans.idx_status`, prefix length 32 —
see §9). The `$createdAt` range query works without a new index.
Permissions: unchanged — the coach already reads every athlete's
`users`, `protocol`, `training_plans`, `workoutsession` rows.

## 8. Decisions

1. `exerciseProgress` entry point → tapping a logged S&C exercise in
   `SessionDetailModal` (only when the host passes `onOpenExercise` — the
   coach dashboard does; the athlete's Past workouts doesn't).
2. "Workouts this week" counts every session (incl. homework / split-off
   S&C), Monday → today, by the session's real day (`sessionLocalDate`).
3. Inactive thresholds 7 / 14 / 30 days: tapping the active Inactive chip
   steps 7 → 14 → 30 → off.
4. The roster includes every user, the signed-in coach too (corrected on
   review).
5. Strings stay in English like the rest of the app.

## 9. Changes from the phase-1 design

- **Indexes** need a prefix length: `planPart` / `status` are long string
  columns and Appwrite rejected a full-length index (767-byte limit). The
  script (`scripts/coach-indexes/create-indexes.mjs`) creates them with
  `lengths: [32]`. **Applied 2026-10-16**: `protocol.idx_planPart`,
  `training_plans.idx_status`.
- Medium layout (900–1199) uses the same single-column order as the phone
  (homework first) rather than plan first.
- Templates card hides homework rows (they're in the Homework card).
- Flash level is owned once (`useFlashLevel` in `AthleteCard.tsx`) and
  shared by the Athlete card and the plan's Build.
- Recent activity shows block chips + minutes, not a workout name.
- The S&C exercise badges (Down 2× / Stuck / Swapped) went with the S&C
  list; the same flags are on each exercise's progress screen.
- Live check (2026-10-16): 17 users, 5 homework rows, 10 active plans, 119
  sessions in the last 60 days — the four roster queries return in one go
  each.

## 10. What to try

Tablet / web (≥ 900 px wide):
- The roster stays on the left; type part of a name (accents don't matter);
  the list filters as you type.
- Tap each KPI that has a filter and each chip; tap Inactive repeatedly
  (7 → 14 → 30 → off). Counts on chips match the KPIs.
- Pick an athlete, leave the tab and come back / reload: the same athlete
  re-opens.
- ≥ 1200 px: plan / timeline / templates on the left of the detail,
  homework / activity / athlete on the right. Narrower: one column.
- Homework: move a deadline → the roster badge and KPI update.
- Build the next workout, Edit / start / end a plan → roster status updates.
- Recent activity → tap a day → session detail; tap an S&C exercise →
  its progress screen.
- Compare an athlete's Timeline with what they see on their Plan page
  (same component).

Phone:
- Roster screen with KPI cards (swipe sideways), search, chips.
- Tap an athlete → detail (homework first); ‹ and Android back return to
  the list, with the last athlete highlighted.
