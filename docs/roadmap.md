# Roadmap — new parts of the app to build

Last updated 2026-10-24. A running list of features that don't exist yet.
Each entry is an idea + a first design; when one gets built it moves to its
own doc (like [`training-plan.md`](training-plan.md)) and is ticked here.

| # | Feature | Status |
| --- | --- | --- |
| 1 | [Automatic workout scheduling](#1-automatic-workout-scheduling) | Idea |
| 2 | [Live rest countdown outside the app](#2-live-rest-countdown-outside-the-app) | Idea |

---

## 1. Automatic workout scheduling

### 1.1 The idea

Today the plan knows **what** workout *n* is (`workoutSpec` in
`utils/planRotation.ts`), but not **when** to do it — the athlete just sees
"next workout" and the plan expects 2 a week.

The app should work out the date of the next workout, week by week, from what
the athlete actually did. Example: a **strength** workout done today → the
next workout is scheduled **2 days later**. If the athlete trains late or
skips a day, the following dates move with them.

### 1.2 Inputs

All already available — the algorithm is pure, like the rest of the plan
code:

- The plan: `windowStart`, `windowEnd`, `startType` (`PlanShape`).
- Workouts done and the day each was done: `donePlanWorkouts` →
  `Map<planIndex, "YYYY-MM-DD">` (`utils/planProgress.ts`).
- Main type of each workout: `mainTypeFor(index, startType)` /
  `builtMainType`.
- Today (`localDateStr(new Date())`).
- Optional, per athlete: days they can't train (see 1.6).

### 1.3 Rules

**Rest after a workout**, by the main type of the workout just done (days
between the session and the next one; to confirm with the coach):

| Main type done | Rest before next workout |
| --- | --- |
| `strength` | 2 days |
| `power` | 2 days |
| `power_endurance` | 2 days (3 if the next one is strength?) |
| S&C-only part | doesn't move the schedule |

So "2 days" = done Monday → next one Wednesday.

**Weekly cap**: `WORKOUTS_PER_WEEK` (2) per plan week (`planWeek`). If the
week already has 2 done, the next workout goes to the first day of the next
plan week (or later, if rest isn't over yet).

**Never in the past**: a scheduled date earlier than today becomes today —
the athlete is late, the workout is due now.

**Never after the plan**: a date past `windowEnd` means that workout won't
fit; it's shown as "doesn't fit in this plan" instead of a date.

### 1.4 Algorithm

```
schedule(plan, done, today):
  dates = Map<planIndex, { date, status }>
  last = latest done workout (highest index in `done`), or none
  cursor = last ? done[last] + rest(mainType(last)) : max(plan.windowStart, today)
  cursor = max(cursor, today)

  for n = nextPlanIndex .. PLAN_WORKOUTS:
    // weekly cap: count done + already scheduled in cursor's plan week
    while countInWeek(planWeek(cursor)) >= WORKOUTS_PER_WEEK:
      cursor = first day of next plan week
    skip cursor forward over blocked days (1.6)
    if cursor > plan.windowEnd:
      dates[n] = { status: "doesnt_fit" }; continue
    dates[n] = { date: cursor, status: cursor == today ? "today" : "scheduled" }
    cursor = cursor + rest(mainType(n))
  return dates
```

It's recomputed from scratch every time (on opening the Plan page, after
saving a session) — nothing is stored, so a late or early session just
shifts every later date. Week by week the schedule stays right without
anyone editing it.

Example (plan starts Mon 1, strength → PE → power…):

| Workout | Type | Done | Next scheduled |
| --- | --- | --- | --- |
| 1 | strength | Mon 1 | → #2 Wed 3 |
| 2 | power_endurance | Thu 4 (one day late) | → #3 would be Sat 6, but week 1 already has 2 → Mon 8 |
| 3 | power | — | Mon 8 → #4 Wed 10 |

### 1.5 Where it goes

- `utils/planSchedule.ts` — pure: `REST_DAYS`, `scheduleWorkouts(plan, done, today, blocked?)`.
  Reuses `addDays`, `planWeek`, `mainTypeFor`, `nextPlanIndex`.
- `scripts/progression-tests/planSchedule.test.ts` — the cases in 1.4 + plan
  end, late athlete, week cap, early start.
- Athlete **Plan page** (`app/(tabs)/(buttonTabs)/plan.tsx`): "Next workout:
  Wednesday 23" and the dates of the upcoming ones.
- Coach **PlanCard** (`components/coach/PlanCard.tsx`): next date + "late by
  N days" when today is past the scheduled date.
- Later: a reminder on the scheduled day (`services/notifications.ts`), and
  optionally adding the dates to the calendar.

### 1.6 Open questions

- Rest days per type — are 2/2/2 right? Does S&C intensity change them?
- Blocked days: should the athlete (or coach) mark days they can't train
  (e.g. "never Sundays")? Where is it stored — on the plan or the athlete?
- If the athlete trains **earlier** than the rest allows, warn them, or just
  accept it?
- Should the coach be able to move a single date by hand (an override that
  the algorithm keeps)?
- Does a non-plan session (free climbing) count as a workout for rest?

---

## 2. Live rest countdown outside the app

### 2.1 The idea

PR #19 shows a notification when the athlete leaves the app mid-rest:
"Resting · ends at 14:32:10", replaced by "Rest's over" when it ends. It
doesn't tick down: a notification can't update itself without native code.

The next step is a countdown that runs on its own on the lock screen and in
the notification shade, like the iOS timer: `1:29`, `1:28`…

### 2.2 How

- **iOS: Live Activity** (lock screen + Dynamic Island). Needs a widget
  extension target (SwiftUI) and ActivityKit. Its `Text(timerInterval:)`
  counts down by itself, so the app only starts it with the end time and ends
  it, no updates while in the background. Options: a config plugin such as
  `expo-live-activity`, or a small local Expo module + `@bacons/apple-targets`.
- **Android: ongoing notification with a chronometer**
  (`setUsesChronometer(true)` + `setChronometerCountDown(true)` +
  `setWhen(endsAt)`). Not exposed by `expo-notifications`; needs a small
  native module (or a library like Notifee).
- Same hook as today (`hooks/useRestNotification.ts`): on leaving the app
  start the countdown with `endsAt`, on return / skip / end stop it. The
  "Rest's over" alert from #19 stays.

### 2.3 Cost

- New native code → a **new build** (EAS build + TestFlight / APK), not an
  `eas update`. Bump `runtimeVersion` so old binaries don't get the update.
- Only testable on a real phone for the lock screen / Dynamic Island; add it
  to "Pruebas en teléfono real".

### 2.4 Open questions

- Also for the Intervals block timer (work/rest phases), or only rests?
- Show the next exercise / attempt in the Live Activity?
- Worth it on Android too, or iOS first?
