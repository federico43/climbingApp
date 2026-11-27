// Tests for utils/recordingAttempt.ts (VideoRecorder timings, log text and
// failure reading). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/recordingAttempt.test.ts
import assert from "node:assert/strict"
import {
  elapsedLabel, failureKind, formatBytes, RECORDING_STOP_TIMEOUT_MS, recorderContextLine,
} from "@/utils/recordingAttempt"

// ── elapsedLabel ────────────────────────────────────────────────────────────
assert.equal(elapsedLabel(1000, 5200), "+4.2s")
assert.equal(elapsedLabel(1000, 1000), "+0.0s")
assert.equal(elapsedLabel(5000, 1000), "+0.0s", "a clock going backwards never shows a negative time")

// ── formatBytes ─────────────────────────────────────────────────────────────
// Pauli's phone: getFreeDiskStorageAsync() → 2844392885
assert.equal(formatBytes(2844392885), "2.8 GB")
assert.equal(formatBytes(512_000_000), "512 MB")
assert.equal(formatBytes(null), "unknown")
assert.equal(formatBytes(undefined), "unknown")
assert.equal(formatBytes(Number.NaN), "unknown")

// ── failureKind ─────────────────────────────────────────────────────────────
// Patched expo-camera (iOS): AVFoundation error + audio session state.
assert.equal(failureKind(
  "An error occurred while recording a video: AVFoundationErrorDomain -11818: Recording Stopped | after 0.41s | " +
  "audio category=AVAudioSessionCategoryPlayAndRecord mode=AVAudioSessionModeDefault otherAudioPlaying=false inputAvailable=true",
), "mic")
assert.equal(failureKind("AVFoundationErrorDomain -11815: Cannot Record"), "mic", "device in use by another app")
assert.equal(failureKind("Error Domain=NSOSStatusErrorDomain Code=561017449 \"(null)\""), "mic", "'!pri': another app owns the audio session")
assert.equal(failureKind("The microphone is in use"), "mic")
// Unpatched expo-camera only says this much: nothing points at the mic.
assert.equal(failureKind("An error occurred while recording a video"), "other")
assert.equal(failureKind("Recording finished without a file."), "other")
assert.equal(failureKind("AVFoundationErrorDomain -11807: Disk Full"), "other")
// The patch appends the audio session state to every error: that alone isn't a mic problem…
assert.equal(failureKind(
  "An error occurred while recording a video: AVFoundationErrorDomain -11807: Disk Full | after 31.20s | " +
  "audio category=AVAudioSessionCategoryPlayAndRecord mode=AVAudioSessionModeDefault otherAudioPlaying=true inputAvailable=true | " +
  "autoAudioSession=false sessionRunning=true interrupted=false",
), "other")
// …but an interrupted session or a failed audio activation is.
assert.equal(failureKind("AVFoundationErrorDomain -11803: Cannot Record | autoAudioSession=false sessionRunning=false interrupted=true"), "mic")
assert.equal(failureKind("AVFoundationErrorDomain -11803: Cannot Record | audio setup error: Error Domain=NSOSStatusErrorDomain Code=560557684"), "mic")
assert.equal(failureKind("Camera unmounted during taking photo process."), "other")
// "mic" must be a word, not part of one.
assert.equal(failureKind("dynamic range error"), "other")

// ── recorderContextLine ─────────────────────────────────────────────────────
assert.equal(
  recorderContextLine({
    model: "iPhone 11", os: "ios", osVersion: "18.1", nativeBuild: "12",
    updateId: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d", updateCreatedAt: new Date("2026-11-20T15:04:00Z"), channel: "production",
  }),
  "iPhone 11 · ios 18.1 · build 12 · update 1a2b3c4d (2026-11-20) · production",
)
// Dev client / simulator: no update, no channel, no model.
assert.equal(
  recorderContextLine({ model: null, os: "ios", osVersion: "26.0", nativeBuild: null, updateId: null, updateCreatedAt: null, channel: null }),
  "unknown device · ios 26.0 · build ? · built-in JS · no channel",
)
assert.equal(
  recorderContextLine({ model: "Pixel 7", os: "android", osVersion: 34, updateId: "abcdef0123", channel: "preview" }),
  "Pixel 7 · android 34 · build ? · update abcdef01 · preview",
)

// ── timeout ─────────────────────────────────────────────────────────────────
// Long enough for a 2-minute clip to finish writing, short enough that the
// athlete isn't left on "Saving…" (Pauli waited 10s+ for a Close button).
assert.ok(RECORDING_STOP_TIMEOUT_MS >= 4000 && RECORDING_STOP_TIMEOUT_MS <= 10000)

console.log("all recordingAttempt tests passed")
