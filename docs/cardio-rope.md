# Jump rope cardio

A cardio plan the app runs by itself: the coach only turns it on per athlete
(and may set the starting step); the app places the athlete with a starting
test and adjusts every session from 4 questions. Full proposal (Spanish):
the project doc "Cardio con cuerda: algoritmo y flujo".

Logic: `utils/cardio.ts` (pure, tested in `scripts/progression-tests/cardio.test.ts`).
Data: `services/cardio.ts`. Tables: `scripts/cardio/create-tables.mjs`.

## Data

- `users.cardioEnabled` (boolean): the coach's switch. Unset = off.
- `users.cardioPlan` (string, JSON): the plan — `{ coachStartStep?, days,
  reminderTime, committedAt, startedAt, state, lastDeloadWeek,
  forcedDeloadWeek }`. `state` is `CardioState`. No `state` yet = the next
  session is the starting test (unless `coachStartStep` is set).
- `cardio_sessions`: one row per session — userId, date ("YYYY-MM-DD"),
  kind ("test" | "session" | "deload"), step, cycle, protocol (JSON),
  answers (JSON), outcome, rule, nextStep, nextCycle, climbedHard.

## Steps (cycle 1)

| Step | Protocol |
| --- | --- |
| 0 | 30 s dry jumps, then 6 × 20/40 |
| 1 | 6 × 30/30 |
| 2 | 8 × 30/30 |
| 3 | 10 × 30/30 |
| 4 | 10 × 30/20 |
| 5 | 10 × 30/30, doubles every 10 s |
| 6 | 10 × 40/20 |

Cycle 2: 12 series. Cycle 3: shorter rests (20 / 15) and doubles every 5 s.
Cycle 4+: 40/20 and 45/15, triples or heavy rope at step 6; one more series
per cycle from cycle 5, up to 15. Cycles start again at step 3.

## Rules (first match wins)

1. Pain → one step down, at most 2 sessions a week until 2 painless sessions in
   a row. Pain in the same zone twice in a row → the coach is told.
2. Mild discomfort → repeat.
3. Many stops for coordination → step 0 (from 0–1), step 4 (from 5), else step 1.
4. Tired, not recovering or all-out → repeat, "go a bit slower".
5. Anything else not green → repeat.
6. 2 green sessions in a row → one step up.
7. 2 easy sessions in a row (green, easy effort, rest to spare) at steps 0–1 → skip a step.
8. 2 greens at step 6 → next cycle, step 3.

Deload weeks and climbed-hard days never count as green. Going to step 6 or
to the next cycle waits for a deload week (unless one ended < 3 weeks ago).
Deload: a full week at 60 % of the series, every 5 weeks. A session on a day
with a finished climbing workout uses the step below. 14+ days without a
session → one step down. 2–3 days a week, never two in a row.

## Starting test

1. 30 s dry jumps; 3 × 30 s with rope, counting stops.
2. Fewer than 2 attempts with ≤ 3 stops → step 0.
3. Else 5 × 30/30 + the 4 questions: all green → 3, any yellow → 2, any red or
   pain → 1.
