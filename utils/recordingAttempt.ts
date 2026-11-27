// Pure helpers for components/VideoRecorder.tsx: timings, log text and how to
// read a failed recording. No React Native imports, so
// scripts/progression-tests/recordingAttempt.test.ts can run them in Node.

/**
 * After tapping stop, recordAsync normally settles within a second or two
 * (the clip only needs its index written). Past this, assume the native
 * recording is stuck and give the athlete a way out instead of "Saving…"
 * forever.
 */
export const RECORDING_STOP_TIMEOUT_MS = 6000

/**
 * "stuck": recordAsync never settled after stop.
 * "mic": the error points at the microphone / audio session (a call, another
 * app holding the mic, an interrupted capture session).
 * "other": anything else.
 */
export type RecordingFailureKind = "stuck" | "mic" | "other"

/** "+4.2s": time since `fromMs`, for log lines. */
export function elapsedLabel(fromMs: number, nowMs: number): string {
  return `+${(Math.max(0, nowMs - fromMs) / 1000).toFixed(1)}s`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "unknown"
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

// AVFoundation codes (iOS): -11818 session interrupted (a call or alarm took
// the audio hardware), -11815 device in use by another app. "!pri" /
// 561017449 is AVAudioSession's "insufficient priority" (another app, such as
// the Phone app during a call, owns the audio session). The patched
// expo-camera appends the audio session state to every error ("audio
// category=… interrupted=…"), so plain "audio" proves nothing; only its
// "interrupted=true" and "audio setup error" parts point at the mic.
const MIC_PATTERN = /microphone|\bmic\b|interrupted=true|audio setup error|audiodeviceinuse|in use by another|-11818|-11815|!pri|561017449|insufficient ?priority/

/**
 * AsyncStorage key: "1" when this phone records without sound by default,
 * because recording with sound got stuck on it and then worked without.
 */
export const NO_SOUND_STORAGE_KEY = "videoRecorder.noSound.v1"

/**
 * After a clip recorded without sound works, should the phone start without
 * sound from now on? Only when sound went off because recording with it got
 * stuck or the mic failed, not when it failed for another reason.
 */
export function rememberNoSoundAfter(soundFailure: RecordingFailureKind | null): boolean {
  return soundFailure === "stuck" || soundFailure === "mic"
}

/** How to read the message recordAsync rejected with. */
export function failureKind(message: string): RecordingFailureKind {
  return MIC_PATTERN.test(message.toLowerCase()) ? "mic" : "other"
}

export type RecorderContext = {
  model?: string | null
  os: string
  osVersion: string | number
  /** CFBundleVersion of the installed binary (iOS); never changes with an EAS update. */
  nativeBuild?: string | null
  updateId?: string | null
  updateCreatedAt?: Date | null
  channel?: string | null
}

/**
 * One line that says which phone, OS, native build and EAS update a set of
 * debug logs came from, e.g.
 * "iPhone 11 · ios 18.1 · build 12 · update 1a2b3c4d (2026-11-20) · production".
 */
export function recorderContextLine(c: RecorderContext): string {
  const update = c.updateId
    ? `update ${c.updateId.slice(0, 8)}${c.updateCreatedAt ? ` (${c.updateCreatedAt.toISOString().slice(0, 10)})` : ""}`
    : "built-in JS"
  return [
    c.model || "unknown device",
    `${c.os} ${c.osVersion}`,
    `build ${c.nativeBuild || "?"}`,
    update,
    c.channel || "no channel",
  ].join(" · ")
}
