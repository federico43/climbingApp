# Next-session tasks

Asked by Federico on 2026-11-22 (thread "Redesign end-of-workout homework tasks"). This replaces the "For next time" list of PR #101.

## The problem

Athletes need to spend a few minutes every session on one thing they haven't figured out: their project, or a movement. The plan has a lot of exercises, so this gets crowded out, both in plan workouts and when they climb on their own.

## The design

1. **Set on the review page.** At the end of a workout the summary has a "Next session" card. The athlete writes a task and picks **tries** (1 to 20) or a **time limit** (5 to 60 min). Two tasks at most. With two open, the editor asks them to remove one before adding another.
2. **Next session, after the warm-up.** When a workout starts, each open task becomes its own block, placed right after the warm-up. It runs as a Project bouldering block: one big Attempt button, then "Sent it?" and why they came off. In tries mode there is a 3-minute rest between tries and the block ends after the last one. In time mode there is no rest countdown (they rest as they like inside the time limit and tap "Next attempt"), and the block ends when the clock runs out.
3. **Keep or close.** At the end of the block the athlete picks **Keep it** (back next session) or **Close it**. If they sent it, Close is preselected. A task carries over until the athlete closes it.
4. **Not today.** "Not today" in the block's ⋯ menu skips the block for this session only, and the task stays. (No link on the block's intro, Federico 2026-11-22.)
5. **Edit any time.** The "Next session" card (summary, Plan page, Home) lists the open tasks, each with a pencil (opens a short sheet: text, tries or time limit) and a bin that removes it. "Add a task" opens the same sheet empty. There is no separate edit mode. A changed task keeps its id, so a workout already running it still closes the right one. Dev builds show a "Dev · show the intro in the next workout" link on the card to test the intro again.

## The intro

Federico 2026-11-22: the intro comes the first time the athlete meets a task, inside the workout. An athlete with **no tasks** who hasn't seen it gets a "Your first task" block where the task blocks go (after the warm-up). It shows four full-screen slides (`TASKS_INTRO` in `components/SessionTasksIntro.tsx`, the Conditioning basics look, `components/paper/Slides.tsx`): one thing every session, write it down, next session after the warm-up, it stays until you close it. "Write my task" opens the task sheet; once added, the block becomes that task's block and runs right away. "Not now" or ✕ skips the block. It counts as seen once the block is on screen (once per phone, `feature-intro-seen:session-tasks-v2`); athletes only; the workout overview lists it too. "How it works" on the Next session card (summary, Plan, Home) opens the slides again as a pop-up.

## Rules

- **Which workouts get the blocks:** plan workouts, the athlete's own workouts, and extra solo sessions. Only workouts with a climbing block get them (warm-up, project, 4x4, sequence, exploration, route exploration), so a strength-only or cardio-only session doesn't ask for a boulder. Never added to: the coach's homework workouts, "Leave as homework" leftovers, plan S&C split-offs, the plan's Benchmark, single library blocks, sequences, or coach tests.
- **Where:** right after the last warm-up block at the start of the workout. With no warm-up, before the first climbing block.
- **Runtime only:** the blocks are added to this session's copy of the workout, never to the saved workout, so plans and the coach's builder don't change. A resumed workout (app closed mid-session) already has them, so they're never added twice.
- **Record:** the task block is saved with the session like any project block (tries, sends, fall reasons), with the task on the block (`focusTask`), including whether it was closed. The coach sees it in the athlete's session history.
- **Close happens when the workout is saved.** A closed task leaves the list only when the workout completes. A cancelled workout changes nothing.
- **Not called "homework"**, which already means the coach's homework workouts.
- Task blocks (and the intro block) have no main-block switch, no "Leave as homework" and no video-review prompt. Project time stats leave them out (a tries-mode block has no time limit to count).

## Storage

- `users.nextTasks` (a text column, since the users table has no room for another string one; JSON `{ tasks, updatedAt }`), created by `scripts/next-tasks/create-column.mjs --apply`. **Run it before the EAS update**, or server saves fail and the list stays on that phone only.
- A copy on the phone (AsyncStorage `nextTasks.<userId>`), written first, so it works offline. The newer copy wins on load. Saves run one after another, so an older list never overwrites a newer one.
- One user-row read when the app opens (per sign-in). No list reads, and none per screen.
- Logic: `utils/sessionTasks.ts` (pure, tested in `scripts/progression-tests/sessionTasks.test.ts`). State: `contexts/SessionTasksContext.tsx`. UI: `components/SessionTasks.tsx`. Runtime: `components/ProjectBoulderingBlock.tsx` (task mode).

No Appwrite function change.
