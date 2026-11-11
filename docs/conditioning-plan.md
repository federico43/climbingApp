# Conditioning-only plans

For athletes who can't climb (an injury, no access to a wall). Coach 2026-11-09.

## What it is

A training plan with `kind: "conditioning"` (`training_plans.kind`; unset = climbing).
The coach turns on **Conditioning only** in the plan form (components/TrainingPlanModal.tsx).

Same as a climbing plan: 6 weeks, 2 workouts a week, pauses, mobility, mobility only,
the S&C progression. Movement patterns: 1 to 6 (climbing plans: 1 to 4), since S&C is
the whole workout — 5–6 patterns make 3 blocks (`scPatternMax`).

Different:

- No climbing focus (`focus` is null), no warm-up (constraints, 1 on 1 off, route
  exploration), no main climbing block, no Density test.
- Every workout is S&C only. The rotation still cycles strength → power endurance →
  power under the hood, because that is what sets the day's S&C focus
  (max force → hypertrophy → explosiveness, `SC_FOCUS_FOR`). People only ever see the
  S&C focus (`mainTypeLabel`): "First workout: Max force / Hypertrophy / Explosiveness",
  the athlete's three columns, "Workout 3 · Max force".
- The coach can still ⇄ swap the S&C focus of the next workout.

Code: `isConditioningOnly`, `canRotate`, `mainTypeLabel` in utils/planRotation.ts;
`workoutSpec` returns `mainBlock: null`, `warmup: "none"`, `withTest: false`;
`buildPlanWorkout` and `summarizeSpec` stop after S&C.

## Next: cardio (jump rope)

Cardio is the next part of conditioning (see the cardio plan proposal). It keeps its own
plan and sessions (`cardio_plans`, `cardio_sessions`), switched on per athlete, so it
works for climbing and conditioning plans alike. A conditioning plan is the natural place
to offer it first. Nothing in this change depends on it: when cardio lands, the plan
pages can show its card next to the S&C workouts.

## Appwrite

`node --env-file=.env.local scripts/conditioning-plan/create-column.mjs --apply` creates
`training_plans.kind` and makes `training_plans.focus` optional if it isn't. Climbing plans
never write `kind`, so they keep saving before the script runs.

## Smarter conditioning (coach 2026-11-11)

**Conditioning basics slides.** On the athlete's Plan page, any plan with S&C shows six
slides once (components/ConditioningBasics.tsx, built on FeatureIntro): get close to
failure, use the full range, it shouldn't hurt, be consistent, and spread it over the
week (in the athlete's own days when the app knows them). "How to train S&C" under the
focus card opens them again. They wait while a homework without a day is pending, so
they don't fight the "You've got homework" pop-up.

**Extra session on their own.** Results come faster when conditioning is spread over the
week, not just tied to gym days. utils/extraSession.ts works out the athlete's gym days
(their default classes, else weekdays they trained on at least twice in the last 4
weeks) and suggests the middle of the longest gap with a rest day either side: Tue + Thu
→ Sat or Sun; Mon + Thu → Sat; 3+ gym days → nothing to suggest.

On the coach's Plan card, "Extra session on their own" shows the days and a Send button.
One tap builds it (the S&C of the latest built workout, same focus, the other exercise of
each pattern; never climbing, warm-up or test) and creates a homework row due the last
suggested day, with a push. It is not a plan workout: no planId / planIndex, so it never
shows on Home or counts towards the 12. Each block carries an `extraSession` note (like
`leftAsHomework`), which the homework cards read to say "Extra session on their own ·
Sat or Sun" and to start the day picker on the first suggested day. While one is open,
the row shows "✓ Sent as homework" instead of the button.

No Appwrite changes: it uses the existing homework columns.
