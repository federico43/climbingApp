# Recipe: create a one-off training session for an athlete

Use this when Federico asks "create a session/workout for <athlete>". No need to re-search the code.

## Where things live
- A workout = a row in Appwrite table `protocol`: `name`, `blocks` (JSON string, array of blocks), `athleteId`, `source: "coach"`.
- Active workout = `users.assignedProtocolId` + `users.assignedAt` (YYYY-MM-DD). The athlete is found by `users.username`.
- Block library = table `blocks`: `name`, `type`, `data` (JSON of the block). A block copied from the library carries `libraryBlockId` (progression history uses it).
- Block shapes: the `Block` union in `components/workoutBlocks.tsx` (defaults in `makeDefaultBlock`). Colours: `orange, blue, green, yellow, red, black` (`utils/boulderColours.ts`).

## Mapping what he says to block types
- Constraint warm-up → `constraint_warmup` {level: colour, targetAttempts: number of climbs, timeLimit: min, description}. Rules for the athlete go in `description`.
- Cardio / jump rope → `intervals` {series, workTime s, restTime s}.
- Rest / coffee break / stretching / anything timed and free → `free_session` {timeLimit min, description}.
- Project → `project_bouldering` {grade: "" = athlete picks, timeLimit 20, restTime 180, reviewPrompts: true}.
- Also: `four_by_four`, `strength_conditioning`, `sequence`, `route_exploration`.

## Script
Copy `scripts/single-session/felipe-2026-11-15.mjs` to `scripts/single-session/<athlete>-<date>.mjs` and edit the texts + `blocks`. It looks up the user (lists similar usernames if not found; `--username=` override), links library blocks by name, creates any NEW library block (copies an existing block's permissions), creates the protocol and assigns it (`--no-assign` to skip). Dry run by default, `--apply` writes. Federico runs it from testApp:
`node --env-file=.env.local scripts/single-session/<file>.mjs` then again with `--apply`.

## New library block
Created by the script if missing. It is NOT in the auto warm-up rotation unless added to `DEFAULT_CONSTRAINT_ROTATION` in `utils/progression/profiles.ts` (code change, ask first).

## Defaults / confirm
Assume: project 20 min, 3 min rest, athlete picks colour; assign as active workout; English block texts. Confirm only real ambiguities (e.g. "4 or 5 s"), state the pick in the reply. Own branch + draft PR, no app/function changes, no EAS update needed.
