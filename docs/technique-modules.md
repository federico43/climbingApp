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
2. Plan picker and rotation: `training_plans.techniqueModuleId`; on Technique plans, the module replaces the 3 technique constraints on odd workouts.
3. Progress storage: `users.techniqueProgress` (TEXT column), phone copy first, like next-session tasks.
4. The athlete's module block.
5. Coach confirmation on the plan card.

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
