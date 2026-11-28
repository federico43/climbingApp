# Technique modules

Asked by Federico on 2026-11-25 (thread "Design technique modules whiteboard"). Whiteboards: [design](https://claude.ai/artifact/4uXt2DVcVJNjmdVRHSqUPK), [V1 workflow](https://claude.ai/artifact/Nz4Yr37rsTMTHp3idufk2b).

## What it is

A Technique-focus training plan can run a **technique module**: a ~6-week course whose levels the athlete unlocks one at a time, by what they show, not by date. The first module is **Footwork** (from the "Técnica de pies" working document): every time a hand moves, one foot presses flat on the bare wall.

| Level | Rule |
| --- | --- |
| 1 · Free foot | The athlete picks which foot stays on the wall |
| 2 · Opposite foot | Left hand moves → right foot on the wall, and the reverse |
| 3 · Same foot | Left hand moves → left foot on the wall, and the reverse |

Each module session: spray wall to explore (feet free, find two ways to do the hardest move), then routes to apply (once normally, then with the rule), a two-tap log per route, one chip question, and the technique card their answer points to (Experiment → Understand → Identify). The first session is the **start check**; the first session in the plan's last week is the **retest**.

## Build order (one draft PR each)

1. **Rules, no UI** (this file's first version): `utils/techniqueModules.ts` (the module definition) and `utils/techniqueProgress.ts` (the rules). Tests: `scripts/progression-tests/techniqueModules.test.ts`.
2. **Plan picker and rotation** (see below): `training_plans.techniqueModuleId`; on Technique plans, the module replaces the 3 technique constraints on odd workouts.
3. **Progress storage** (see below): `users.techniqueProgress` (TEXT column), phone copy first, like next-session tasks.
4. The athlete's module block.
5. Coach confirmation on the plan card.

## In the plan (PR 2)

- **Plan editor:** with focus Technique, a "Technique module" row: None (the 3 technique constraints, as before) or Footwork. Stored in `training_plans.techniqueModuleId` (string 32, optional), only written once a plan has one, so other plans save before the column exists. Run `scripts/technique-modules/create-column.mjs` (dry run, then `--apply`) before picking a module. Changing the focus away from Technique clears it.
- **Rotation:** `warmupFor` returns `"module"` instead of `"constraints"` on odd workouts when `planTechniqueModule(plan)` is set. Even workouts keep 1 on 1 off. The coach's ⇄ on the warm-up row swaps module ↔ 1 on 1 off (`swappedWarmup`).
- **The block:** `technique_module` (`components/workoutBlocks.tsx`) saves only `moduleId`, the name ("Footwork module"), the goal and 20 min. The level and colour are read from the athlete's progress when it starts (PR 3–4), so workouts built ahead never go stale. It isn't in the block picker. Next-session tasks go right after it, like after the constraints.
- **Until PR 4:** the block runs as a free session (`moduleStandIn`): the goal, the Level 1 rule, a 20-min timer and the chip question as the notes prompt.
- **Summaries:** the coach's Plan card says "Warm-up · Footwork module"; the athlete's Plan page and the workout summary show a "Footwork module" warm-up, 20 min.
- Tests: `scripts/progression-tests/techniqueRotation.test.ts`.

## Progress storage (PR 3)

- `users.techniqueProgress`, a **text** column (the users table has no room for another string one). Create it with `scripts/technique-modules/create-progress-column.mjs` (dry run, then `--apply`), **before the EAS update**. Until it exists, progress stays on the phone only.
- `services/techniqueProgress.ts`: phone copy (AsyncStorage `techniqueProgress.<userId>`) written first, then the server; the newer copy wins on load; saves run one after another.
- `contexts/TechniqueProgressContext.tsx` (`useTechniqueProgress`): `moduleProgress(id)` and `updateModule(id, fn)`, loaded once per sign-in, under the tabs next to the next-session tasks provider.
- **One user-row read for both:** `services/ownUserRow.ts` shares the sign-in read of the athlete's own row between next-session tasks and technique progress (reused for 60 s), so this adds no read.

## First-time intro and demo video (for PR 4, Federico 2026-11-28)

Rules for this intro (and every feature intro from now on):

1. It's the **first thing** the athlete sees of the feature, before the block intro.
2. Slides in this order: **there's something new** → **its name** → **why** → **how to use it**.

The intro includes Federico's demo video (no audio, the constraint on the wall; he'll replace it with an edited cut later). It ships **inside the app** (`assets/videos/`), so it plays at once with no download: 29 s, 720×1280 H.264, no audio, about 2.3 MB (compressed from his 32 MB clip; source in the project files `technique-modules/footwork-demo.mp4`). Swapping in the edited video later = replace the file + EAS update.

## Text and instruction types

| Field | Instruction type | Shown |
| --- | --- | --- |
| `level.rule` | Coach notes | Block intro. **Never names a technique** (a test checks this) |
| `module.howItWorks` | How it works | Numbered card under the coach notes, ≤ 4 steps |
| `level.cue` | Cue | One line on the running screen |
| `technique.note` | Coach notes | The reveal card, only after the athlete's answer points to it |
| `level.expected` | Coach only | What the coach usually sees appear at that level |

The text lives in code (Federico 2026-11-27: "code first"), so changing it is a PR plus an EAS update. It can move to an Appwrite table later if modules need editing in the app.

## The rules (`utils/techniqueProgress.ts`)

- **Route log:** rule breaks (0 / 1 / 2 / 3+) and feel (hard / OK / easy).
- **Pass:** ≤ 1 break and OK or easy. **2 passing routes in a row**, across sessions, at the athlete's level and colour earn the next step. A failed route resets the run.
- **Too easy:** when every route in that run had 0 breaks and felt easy, the next step is **one colour up** instead of a level up (at most 1 colour). The run then starts again at the new colour.
- **Level up:** proposed, not given (`pending`). The coach confirms (`confirmLevelUp`) or holds (`holdLevelUp`: stay and earn it again). If the coach hasn't answered by the athlete's next module session, it unlocks when that session starts (`atSessionStart`, logged as `auto`). The coach can also set any level by hand (`setLevel`).
- **Last level passed:** `mastered`. They stay on Level 3.
- **Colour:** one below flash, orange floor; no flash level → orange. Plus the colour step.
- **Reveal:** up to 2 chips; each points to a technique card (or none, for "Not sure"). `found` keeps every card revealed so far.
- **History:** every level change (`coach`, `auto`, `coach_set`), last 20 kept.

## Storage shape

```json
{ "updatedAt": 0, "modules": { "footwork": {
  "level": 1, "colourStep": 0, "streak": 0, "easyRun": true,
  "pending": { "level": 2, "since": "2026-12-03" }, "mastered": false,
  "found": ["smear"], "startCheck": { "on": "…", "level": 1, "routes": [{ "breaks": 1, "feel": "ok" }] },
  "retest": null, "history": [{ "level": 2, "on": "…", "by": "coach" }], "sessions": 3 } } }
```

Progress is per athlete, not per plan, so it carries over to the next plan. A full Footwork entry stays well under 4,000 characters (tested).

## Open (decide before PR 2–5)

- Push to the coach on "ready for Level 2", or plan card only? Default: plan card only in V1.
- Footwork texts above are Claude's draft for Federico to edit.
