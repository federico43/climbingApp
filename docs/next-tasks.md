# For next time (athlete's own homework notes)

Asked by Federico on 2026-11-12. At the end of a workout the athlete writes what to do next session (homework the coach gave them, or their own), and the next workout shows it as a checklist.

Separate from the coach's homework workouts and from "Leave as homework" on a block (`utils/homework.ts`): these are free-text notes, not blocks.

## Flow

1. **Summary** (`components/workOutState.tsx`): a pink "For next time" card under the blocks. Empty: "Ask your coach for homework · Or add your own". Opening it stops the summary from closing itself.
2. **Editor** (`NextTimeEditor` in `components/NextTasks.tsx`): full-screen, poster headline "Homework". Each task is a short text plus an optional amount (tries or minutes, with a stepper). ✕ removes one. Every change saves right away; Done closes it.
3. **Next workout**: when it starts with tasks waiting, the "For today" checklist slides up over the first block (not on a resume after the app was closed). A "For today · 1/3" chip next to "Coach is here?" reopens it at any point, so tasks can be done at the start or in between blocks.
4. **End of that workout**: ticked tasks go, the rest carry over and show on the summary card again.

## Storage

- `users.nextTasks` (string 4000, JSON `{ tasks, updatedAt }`), created by `scripts/next-tasks/create-column.mjs --apply`.
- A copy on the phone (AsyncStorage `nextTasks.<userId>`), written first, so it works offline and before the column exists. The newer copy wins on load.
- Logic: `utils/nextTasks.ts` (pure, tested in `scripts/progression-tests/nextTasks.test.ts`). Max 12 tasks, 140 characters each.

No Appwrite function change.
