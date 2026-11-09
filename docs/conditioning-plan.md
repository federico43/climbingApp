# Conditioning-only plans

For athletes who can't climb (an injury, no access to a wall). Coach 2026-11-09.

## What it is

A training plan with `kind: "conditioning"` (`training_plans.kind`; unset = climbing).
The coach turns on **Conditioning only** in the plan form (components/TrainingPlanModal.tsx).

Same as a climbing plan: 6 weeks, 2 workouts a week, pauses, movement patterns (1–4),
mobility, mobility only, the S&C progression.

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
