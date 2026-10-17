# App redesign — athlete navigation

Branch `v2`. Status: **done 2026-10-04 — not committed, not tried on a
device** (checked with type-check, automated tests and the web build; the
Plan page was checked visually on the web with mock data — screens behind
login weren't). §1–§6 describe the app as it is now; §7 is how it was
built, phase by phase.

## 1. Goal

The athlete opens the app to **today's workout**. Everything else is one tap
away but out of the way.

- **No training plan** → bottom bar **Home · Plan** (coaches also
  **Design**). Home = the most recently built workout, full screen.
- **Active training plan** → the **Plan page is the app's home**: no Home
  tab, and athletes get **no tab bar** at all (coaches: Plan · Design).
- **Settings** is not a tab: gear icon top-right, the hub for everything
  else (incl. the version / update status).
- Removed from Home: calendar + consistency stats (→ Settings › Past
  workouts), the ✓ "record workout" button, the workout / library lists.
- Kept: **create sequence** ("＋ Sequence" in the header).

## 2. Before vs. after

| Before | After |
| --- | --- |
| Tabs: Home · Library · Design (coach) · Settings | No plan: Home · Plan (+ Design for coaches). With a plan: no tab bar for athletes; Plan · Design for coaches |
| Home header: "Hi, name" + version/update status | "Hi, name" · ＋ Sequence · ⚙︎ |
| Home: My workouts, My sequences, From the library, calendar, stats, ✓ FAB | One workout, full screen + Start |
| Settings tab: account, check-in, welcome page, sign out | Settings screen (pushed): §5 |
| Library tab (videos) | Settings › Videos |
| Coach's plan card only in `AthleteAnalytics` | Athlete Plan page (read-only): §4 |

The `UpdateBanner` ("Updating…" toast that auto-restarts) stays global. The
version / update status (`VersionFooter`) moved from the Home corner to
Settings › About.

## 3. Home (athletes without a plan)

`app/(tabs)/(buttonTabs)/index.tsx`. With a plan it redirects to Plan.

- Header: "Hi, name" · **＋ Sequence** (`NewSequenceButton`) · ⚙︎.
- **`LatestWorkoutCard`** filling the screen: the most recently built coach
  workout (newest `$createdAt`, `source !== "library"`, not a split-off
  S&C). Kicker "Today's workout" (plan workout) or "Latest workout"; plan
  chip "Workout 5 of 12 · Power endurance"; name; block list (icon, type,
  name, short detail); split-off S&C (`planPart: "sc"`, same plan slot) as
  "Also today" with its own Start.
- **Start workout** pinned above the tab bar; the list scrolls under it.
- Empty: "No workout yet" + link to the workout library.
- **`LaunchExtras`**: hero intro (once per launch), daily check-in (once
  per day, after the intro), failing overdue projects (on focus).
- After saving a new sequence: "Try it now", or find it in Settings › My
  sequences.

## 4. Plan page

`app/(tabs)/(buttonTabs)/plan.tsx`. Read-only.

**Header:** "**<name>'s plan**", plan name below; ＋ Sequence (when there's
a plan) · ⚙︎.

**Group 1 — ⚡ Up next:** `LatestWorkoutCard` (same as Home's, with its own
Start button).

**Group 2 — 📅 Your training plan** (group headings: icon + caps + rule,
extra space between the groups):

1. **Focus card** — "This week's focus" + the focus in its adaptation
   colour (`ADAPTATION_COLOR`). If the plan has S&C: "Our conditioning
   focus" + the 4 movement patterns as chips (+ Mobility). No specific
   exercises, no explanation line, no focus-cycle strip (all removed on
   review).
2. **Timeline card** — "Timeline", "n days left" top-right (focus colour);
   **Start → End** dates (day + month, weekday below) joined by a line;
   pill "Week 2 of 6" ("Starts …" before, "Plan finished" after); then the
   **6-week day grid**: one row per plan week, starting on the plan's first
   day (plans can start any weekday — column letters follow it). Trained
   (any session) = filled green, past = dark, today = green ring, to come =
   outline. Legend below.
3. **Workouts card** — ring "n of 12", "n left", "This week: n of 2 done"
   (plan week). Then the 12 workouts **grouped by main type**: three
   columns, Strength / Power endurance / Power, each with its S&C focus
   (max force / hypertrophy / explosiveness), **4 large dots** (filled ✓ =
   done, thick ring = built and ready, faint = to come) and "**2** of 4
   done". No numbered tiles (removed on review).
4. **Workout detail** (only after tapping a dot; × closes): "Workout 7 ·
   Week 4", main type, name, **~1h 40m**, a time bar split by phase, then
   each phase in order — S&C → warm-up / test → main — with title, detail
   and minutes. Start when built and ready; "Preview — your coach builds the
   exact workout" when upcoming.

**States:** no active plan → "No training plan yet — your coach will set
one up." Load error (e.g. no read permission on `training_plans`) →
"Couldn't load your plan".

**With a plan the Plan page is home:** it also runs `LaunchExtras` (intro,
check-in, project auto-fail).

### 4.1 How it's worked out

- **Done** (`utils/planProgress.ts`): sessions name their workout since
  2026-10-04 (`protocolId` → its `planIndex`; a split-off S&C doesn't
  count). Older sessions are matched on **block ids** — a session keeps its
  workout's blocks and built workouts get fresh ids — to the climbing
  workout built on or before that day.
- **Upcoming workouts** come from `workoutSpec` (`utils/planRotation.ts`),
  the same rotation the coach's Build uses: main type cycles Strength → PE
  → Power; main block alternates within a type; warm-up odd = 3
  constraints, even = 1 on 1 off; S&C focus tied to the main type. The
  Density test is shown only for workout 1 and the next one to be built
  (the week-6 one depends on when it's built). Specific constraints / S&C
  exercises are picked at build time, so they're counted, not named.
- **Phases + duration** (`utils/workoutSummary.ts`): built workouts from
  their blocks; upcoming from `workoutSpec` + library blocks + the S&C
  layout rules (3 rounds, rest by focus, mobility blocks). Duration =
  median of the athlete's own past times for that block (by name; by type
  for S&C and constraints, whose names vary), else from the block's
  settings (attempts × rest, sets, rounds, intervals, time limit); rounded
  to 5 min; shown as "45m", "1h", "1h 40m" (`formatMinutes`).
- **Plan as home** (`contexts/ActivePlanContext.tsx`): the active plan is
  fetched on sign-in and whenever the app returns to the front;
  unreadable = no plan (Home stays). The tab layout waits for it so Home
  doesn't flash. The Plan page re-syncs it when it loads.

## 5. Settings (hub)

Pushed screen (hidden tab, so the mini workout bar still shows), opened from
the gear. Back returns to where it was opened (`backBehavior="history"`).

| Section | Rows |
| --- | --- |
| Account | Email, role |
| Today | Daily check-in |
| Training | My workouts (coach workouts + library picks + "Browse library") · My sequences (try / edit / delete / new) · Past workouts (calendar + stats + session detail) · Projects |
| Media | Videos (the old Library tab) |
| About | Version + update status (tap to restart when ready) · Welcome page |
| | Sign out |

Not in Settings: Exercise progress (needs a specific exercise — opened by
the coach from an S&C exercise in a session's detail, docs/coach-dashboard.md)
and Spray wall (coach tool, in Design).

## 6. Files

| File | Role |
| --- | --- |
| `app/(tabs)/(buttonTabs)/_layout.tsx` | Tabs; hides Home / the tab bar with a plan |
| `app/(tabs)/(buttonTabs)/index.tsx` | Home (no plan) |
| `app/(tabs)/(buttonTabs)/plan.tsx` | Plan page |
| `app/(tabs)/(buttonTabs)/settings.tsx` | Settings hub |
| `app/(tabs)/(buttonTabs)/my-workouts.tsx`, `my-sequences.tsx`, `past-workouts.tsx` | Settings screens |
| `contexts/ActivePlanContext.tsx` | Active plan for the layout |
| `components/LatestWorkoutCard.tsx` | Latest built workout card (Home + Plan) |
| `components/LaunchExtras.tsx` | Hero intro, daily check-in, project auto-fail |
| `components/NewSequenceButton.tsx` | ＋ Sequence |
| `components/SettingsButton.tsx`, `SubScreenHeader.tsx` | Gear; back + title for Settings screens |
| `utils/planProgress.ts` | Done workouts, days, pace (pure) |
| `utils/workoutSummary.ts` | Phases + duration (pure) |
| `utils/sessionDates.ts` | Past workouts calendar / stats helpers |
| `scripts/progression-tests/planProgress.test.ts`, `workoutSummary.test.ts` | Automated checks |

## 7. How it was built (all ✅ 2026-10-04)

1. **Navigation shell** — tabs, gear, Settings + Library as hidden routes,
   `VersionFooter` → Settings › About, `backBehavior="history"`.
2. **Settings hub** — My workouts, My sequences, Past workouts, Projects
   (`past-projects`, an athlete screen nothing linked to before).
3. **Home** — full-screen latest workout + pinned Start; calendar, lists
   and ✓ button removed. `workout-log` stays (the coach's Design uses it).
4. **Session ↔ workout link** — `openWorkout(blocks, name, link?)`; Home,
   My workouts and Plan pass `sessionLinkFor(protocol)` (sequences, single
   library blocks and the coach's "Test" don't). The link goes
   `WorkoutContext` → `useWorkout` → `saveSession`, and into the
   crash-recovery snapshot. `saveSession` retries without the link columns
   (then without `blockDurations`) if Appwrite rejects them. Retro-logged
   sessions (`workout-log`) aren't linked.
5. **Plan tab** — first as a list of 12 workouts; then, on review: focus
   card trimmed, hour format, rows → phase summaries → grouped by main type
   → dots only; S&C exercises → patterns on the focus card.
6. **Plan as home** — Home / tab bar hidden with a plan, latest workout
   card + launch extras + ＋ Sequence on Plan.
7. **Plan page layout** — name in the title, Up next / Your training plan
   groups, "This week's focus", "Our conditioning focus", merged Timeline
   card.

## 8. Console / data (you)

- Athletes need **read** permission on `training_plans` rows (before, only
  the coach read them). Without it the Plan page shows "Couldn't load your
  plan" and Home stays.
- `workoutsession` columns `protocolId`, `planId` (string, optional),
  `planIndex` (integer, optional). Without them sessions still save, just
  unlinked (counted via block-id matching).
