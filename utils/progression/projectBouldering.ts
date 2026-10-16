// Pure rules for the project bouldering block, v2 (docs/project-bouldering-v2.md):
// the block works one grade under a time cap, the athlete logs attempts with
// one button and tags falls with reasons while resting, and the app now and
// then asks them to film the next attempt for the coach. No React Native
// imports — the runtime, the summaries and the Node tests share this.

export type FallReason = "beta" | "execution" | "slip" | "fatigue" | "commitment"

// Display order of the chips (and the tie-break when counting them).
export const FALL_REASONS: { key: FallReason; label: string }[] = [
  { key: "beta", label: "Wrong beta" },
  { key: "execution", label: "Poor execution" },
  { key: "slip", label: "Slipped" },
  { key: "fatigue", label: "Pumped / tired" },
  { key: "commitment", label: "Didn't commit" },
]

export function fallReasonLabel(key: string): string {
  return FALL_REASONS.find((r) => r.key === key)?.label ?? key
}

export const PROJECT_DEFAULT_TIME_MIN = 20
export const PROJECT_MIN_TIME_MIN = 5
export const PROJECT_MAX_TIME_MIN = 90
export const PROJECT_DEFAULT_REST_S = 180

// Marks an attempt as logged by the v2 runtime (fallReasons / videoId may be
// present). Sessions without it are v1 project attempts.
export const PROJECT_V2 = 2

export interface ProjectBlockSettings {
  grade: string
  timeLimit: number    // minutes, always > 0
  restTime: number     // seconds
  reviewPrompts: boolean
}

// Fill v2 defaults on any stored project block (v1 blocks have no grade /
// time limit). Never mutates; extra fields (e.g. legacy targetAttempts) are
// the caller's to keep.
export function normalizeProjectBlock(b: any): ProjectBlockSettings {
  const tl = typeof b?.timeLimit === "number" && b.timeLimit > 0 ? b.timeLimit : PROJECT_DEFAULT_TIME_MIN
  const rest = typeof b?.restTime === "number" && b.restTime > 0 ? b.restTime : PROJECT_DEFAULT_REST_S
  return {
    grade: typeof b?.grade === "string" ? b.grade : "",
    timeLimit: Math.min(PROJECT_MAX_TIME_MIN, Math.max(PROJECT_MIN_TIME_MIN, Math.round(tl))),
    restTime: Math.round(rest),
    reviewPrompts: b?.reviewPrompts !== false,
  }
}

export interface ProjectAttemptLike {
  success?: boolean
  level?: string
  fallReasons?: string[]
  videoId?: string
  reviewClip?: boolean
  pbv?: number
  coached?: boolean
  routeId?: string
}

export interface ProjectSummary {
  grade: string
  attempts: number
  sends: number
  sent: boolean
  reasons: { key: string; count: number }[]
  clips: number
  reviewClips: number
  // No attempt carries the v2 marker: a v1 (pick-a-project) block.
  legacy: boolean
}

// One block's attempts (already filtered to the block) → what the summaries
// show. A coached block's Done marker isn't an attempt and is skipped.
export function summarizeProjectAttempts(attempts: ProjectAttemptLike[]): ProjectSummary {
  const real = attempts.filter((a) => !(a.coached && !a.routeId))
  const counts = new Map<string, number>()
  for (const a of real) {
    if (a.success) continue
    for (const r of new Set(a.fallReasons ?? [])) counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  const order = (k: string) => {
    const i = FALL_REASONS.findIndex((r) => r.key === k)
    return i < 0 ? FALL_REASONS.length : i
  }
  const reasons = [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || order(a.key) - order(b.key))
  const sends = real.filter((a) => a.success).length
  const grade = [...real].reverse().find((a) => a.level)?.level ?? ""
  return {
    grade,
    attempts: real.length,
    sends,
    sent: sends > 0,
    reasons,
    clips: real.filter((a) => a.videoId).length,
    reviewClips: real.filter((a) => a.reviewClip).length,
    legacy: !real.some((a) => a.pbv === PROJECT_V2),
  }
}

// ─── Random "film the next attempt" prompt ────────────────────────────────────

export const REVIEW_PROMPT_PROBABILITY = 0.3
export const REVIEW_CLIPS_PER_WORKOUT = 2
export const REVIEW_PROMPTS_PER_BLOCK = 2
export const REVIEW_PROMPT_COOLDOWN = 3   // attempts between two prompts
export const REVIEW_PROMPT_MIN_ATTEMPT = 2

export interface ReviewPromptState {
  enabled: boolean
  attemptNumber: number          // the attempt just logged, 1-based
  sentInBlock: boolean           // a send has been logged in this block
  clipsThisWorkout: number       // review clips already filmed this workout
  promptsThisBlock: number       // prompts shown in this block (accepted or not)
  lastPromptAttempt: number | null
  secondsLeft: number | null     // block time left; null = unknown
  restTime: number               // seconds
  pendingRecord: boolean         // a "film the next one" is already accepted
}

// Whether to ask the athlete to film their next attempt for the coach.
// `rand` returns [0, 1) — Math.random in the app, fixed in tests.
export function shouldPromptReviewClip(s: ReviewPromptState, rand: () => number): boolean {
  if (!s.enabled || s.pendingRecord) return false
  if (s.attemptNumber < REVIEW_PROMPT_MIN_ATTEMPT) return false
  if (s.sentInBlock) return false
  if (s.clipsThisWorkout >= REVIEW_CLIPS_PER_WORKOUT) return false
  if (s.promptsThisBlock >= REVIEW_PROMPTS_PER_BLOCK) return false
  if (s.lastPromptAttempt != null && s.attemptNumber - s.lastPromptAttempt < REVIEW_PROMPT_COOLDOWN) return false
  if (s.secondsLeft != null && s.secondsLeft <= s.restTime + 60) return false
  return rand() < REVIEW_PROMPT_PROBABILITY
}

// When the block's clock started, rebuilt from its attempts when a workout is
// resumed (the live timer isn't persisted): a minute before the first attempt.
export function resumedBlockStart(timestamps: number[]): number | null {
  if (!timestamps.length) return null
  return Math.min(...timestamps) - 60_000
}
