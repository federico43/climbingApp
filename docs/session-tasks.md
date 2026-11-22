# Next-session tasks

Asked by Federico on 2026-11-22 (thread "Redesign end-of-workout homework tasks"). This replaces the "For next time" list of PR #101.

## The problem

Athletes need to spend a few minutes every session on one thing they haven't figured out: their project, or a movement. The plan has a lot of exercises, so this gets crowded out, both in plan workouts and when they climb on their own.

## The design

1. **Set on the review page.** At the end of a workout the summary has a "Next session" card. The athlete writes a task and picks **tries** (1 to 20) or a **time limit** (5 to 60 min). Two tasks at most. With two open, the editor asks them to remove one before adding another.
2. **Next session, after the warm-up.** When a workout starts, each open task becomes its own block, placed right after the warm-up. It runs as a Project bouldering block: one big Attempt button, then "Sent it?" and why they came off. In tries mode there is a 3-minute rest between tries and the block ends after the last one. In time mode there is no rest countdown (they rest as they like inside the time limit and tap "Next attempt"), and the block ends when the clock runs out.
3. **Keep or close.** At the end of the block the athlete picks **Keep it** (back next session) or **Close it**. If they sent it, Close is preselected. A task carries over until the athlete closes it.
4. **Not today.** The task block's intro has "Not today". That skips the block for this session only, and the task stays.
5. **Edit any time.** The "Next session" card (summary, Plan page, Home) lists the open tasks with ✕ to remove one and "Add a task", which opens a short sheet (text, tries or time limit). There is no separate edit mode.

## Rules

- **Which workouts get the blocks:** plan workouts, the athlete's own workouts, and extra solo sessions. Only workouts with a climbing block get them (warm-up, project, 4x4, sequence, exploration, route exploration), so a strength-only or cardio-only session doesn't ask for a boulder. Never added to: the coach's homework workouts, "Leave as homework" leftovers, plan S&C split-offs, the plan's Benchmark, single library blocks, sequences, or coach tests.
- **Where:** right after the last warm-up block at the start of the workout. With no warm-up, before the first climbing block.
- **Runtime only:** the blocks are added to this session's copy of the workout, never to the saved workout, so plans and the coach's builder don't change. A resumed workout (app closed mid-session) already has them, so they're never added twice.
- **Record:** the task block is saved with the session like any project block (tries, sends, fall reasons), with the task on the block (`focusTask`), including whether it was closed. The coach sees it in the athlete's session history.
- **Close happens when the workout is saved.** A closed task leaves the list only when the workout completes. A cancelled workout changes nothing.
- **Not called "homework"**, which already means the coach's homework workouts.
- Task blocks have no "Coach is here?" switch, no main-block switch, no "Leave as homework" and no video-review prompt. Project time stats leave them out (a tries-mode block has no time limit to count).

## Storage

- `users.nextTasks` (a text column, since the users table has no room for another string one; JSON `{ tasks, updatedAt }`), created by `scripts/next-tasks/create-column.mjs --apply`. **Run it before the EAS update**, or server saves fail and the list stays on that phone only.
- A copy on the phone (AsyncStorage `nextTasks.<userId>`), written first, so it works offline. The newer copy wins on load. Saves run one after another, so an older list never overwrites a newer one.
- One user-row read when the app opens (per sign-in). No list reads, and none per screen.
- Logic: `utils/sessionTasks.ts` (pure, tested in `scripts/progression-tests/sessionTasks.test.ts`). State: `contexts/SessionTasksContext.tsx`. UI: `components/SessionTasks.tsx`. Runtime: `components/ProjectBoulderingBlock.tsx` (task mode).

No Appwrite function change.
