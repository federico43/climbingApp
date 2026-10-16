// Tests for the pure project bouldering v2 rules (utils/progression/projectBouldering.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/projectBouldering.test.ts

import assert from "node:assert/strict"
import {
  normalizeProjectBlock, resumedBlockStart, shouldPromptReviewClip, summarizeProjectAttempts,
  type ReviewPromptState,
} from "@/utils/progression/projectBouldering"

// ── normalizeProjectBlock ──
// v1 block: attempts + rest, no grade / time.
assert.deepEqual(
  normalizeProjectBlock({ type: "project_bouldering", description: "", targetAttempts: 10, restTime: 120 }),
  { grade: "", timeLimit: 20, restTime: 120, reviewPrompts: true },
)
// v1 block saved with the time limit off.
assert.equal(normalizeProjectBlock({ timeLimit: 0 }).timeLimit, 20)
// Nothing at all.
assert.deepEqual(normalizeProjectBlock(undefined), { grade: "", timeLimit: 20, restTime: 180, reviewPrompts: true })
// v2 block kept as is.
assert.deepEqual(
  normalizeProjectBlock({ grade: "yellow", timeLimit: 30, restTime: 240, reviewPrompts: false }),
  { grade: "yellow", timeLimit: 30, restTime: 240, reviewPrompts: false },
)
// Clamped to 5…90 minutes.
assert.equal(normalizeProjectBlock({ timeLimit: 2 }).timeLimit, 5)
assert.equal(normalizeProjectBlock({ timeLimit: 500 }).timeLimit, 90)

// ── summarizeProjectAttempts ──
function v2(o: object) { return { success: false, level: "yellow", pbv: 2, ...o } }
{
  const s = summarizeProjectAttempts([
    v2({ fallReasons: ["beta", "fatigue"] }),
    v2({ fallReasons: ["fatigue"] }),
    v2({}),
    v2({ fallReasons: ["slip"], videoId: "v1", reviewClip: true }),
    v2({ fallReasons: ["beta"] }),
    v2({ success: true, videoId: "v2" }),
  ])
  assert.equal(s.grade, "yellow")
  assert.equal(s.attempts, 6)
  assert.equal(s.sends, 1)
  assert.equal(s.sent, true)
  assert.equal(s.clips, 2)
  assert.equal(s.reviewClips, 1)
  assert.equal(s.legacy, false)
  // Most frequent first; ties follow the chip order (beta before fatigue).
  assert.deepEqual(s.reasons, [{ key: "beta", count: 2 }, { key: "fatigue", count: 2 }, { key: "slip", count: 1 }])
}
// A reason picked twice on one attempt counts once; reasons on a send are ignored.
assert.deepEqual(
  summarizeProjectAttempts([v2({ fallReasons: ["slip", "slip"] }), v2({ success: true, fallReasons: ["beta"] })]).reasons,
  [{ key: "slip", count: 1 }],
)
// No attempts.
assert.deepEqual(summarizeProjectAttempts([]), {
  grade: "", attempts: 0, sends: 0, sent: false, reasons: [], clips: 0, reviewClips: 0, legacy: true,
})
// v1 session: project attempts with notes, no marker.
{
  const s = summarizeProjectAttempts([
    { success: false, level: "red", projectId: "p", notes: "heel" } as any,
    { success: false, level: "red", projectId: "p" } as any,
  ])
  assert.equal(s.legacy, true)
  assert.equal(s.grade, "red")
  assert.equal(s.attempts, 2)
  assert.equal(s.sent, false)
  assert.deepEqual(s.reasons, [])
}
// A coached block's Done marker isn't an attempt.
assert.equal(summarizeProjectAttempts([{ success: true, coached: true }]).attempts, 0)

// ── shouldPromptReviewClip ──
const base: ReviewPromptState = {
  enabled: true, attemptNumber: 3, sentInBlock: false, clipsThisWorkout: 0, promptsThisBlock: 0,
  lastPromptAttempt: null, secondsLeft: 900, restTime: 180, pendingRecord: false,
}
const low = () => 0.1    // under the 0.3 threshold
const high = () => 0.5   // over it
assert.equal(shouldPromptReviewClip(base, low), true)
assert.equal(shouldPromptReviewClip(base, high), false)
assert.equal(shouldPromptReviewClip(base, () => 0.3), false)   // threshold is strict
assert.equal(shouldPromptReviewClip(base, () => 0.29), true)
assert.equal(shouldPromptReviewClip({ ...base, enabled: false }, low), false)
assert.equal(shouldPromptReviewClip({ ...base, pendingRecord: true }, low), false)
assert.equal(shouldPromptReviewClip({ ...base, attemptNumber: 1 }, low), false)   // first attempt is a read
assert.equal(shouldPromptReviewClip({ ...base, attemptNumber: 2 }, low), true)
assert.equal(shouldPromptReviewClip({ ...base, sentInBlock: true }, low), false)
assert.equal(shouldPromptReviewClip({ ...base, clipsThisWorkout: 1 }, low), true)
assert.equal(shouldPromptReviewClip({ ...base, clipsThisWorkout: 2 }, low), false)  // per-workout cap
assert.equal(shouldPromptReviewClip({ ...base, promptsThisBlock: 1, lastPromptAttempt: 0 }, low), true)
assert.equal(shouldPromptReviewClip({ ...base, promptsThisBlock: 2 }, low), false)  // per-block cap
// Cooldown: 3 attempts between prompts.
assert.equal(shouldPromptReviewClip({ ...base, attemptNumber: 5, promptsThisBlock: 1, lastPromptAttempt: 3 }, low), false)
assert.equal(shouldPromptReviewClip({ ...base, attemptNumber: 6, promptsThisBlock: 1, lastPromptAttempt: 3 }, low), true)
// Needs time for another attempt: rest + 60 s.
assert.equal(shouldPromptReviewClip({ ...base, secondsLeft: 240 }, low), false)
assert.equal(shouldPromptReviewClip({ ...base, secondsLeft: 241 }, low), true)
assert.equal(shouldPromptReviewClip({ ...base, secondsLeft: null }, low), true)

// ── resumedBlockStart ──
assert.equal(resumedBlockStart([]), null)
assert.equal(resumedBlockStart([200_000, 100_000]), 40_000)

console.log("projectBouldering: all tests passed")
