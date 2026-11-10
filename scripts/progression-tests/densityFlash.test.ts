// Tests for the flash colour from the Density test (utils/densityFlash.ts). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/densityFlash.test.ts

import assert from "node:assert/strict"
import { colourFromLabel, densityClimbs, densityFlashColour, densitySummary, latestDensityTest } from "@/utils/densityFlash"

assert.equal(colourFromLabel("Blue"), "blue")
assert.equal(colourFromLabel(" verde "), "green")
assert.equal(colourFromLabel("Morado"), null)

const d = (notes: string, extra: any = {}) => ({ type: "exploration_session", success: true, notes, ...extra })

// old tests: only tops, the go in the notes; other blocks ignored
assert.deepEqual(densityClimbs([d("Blue · Flash"), d("Green · 2nd go"), d("Green · 3+"), { type: "sequence", success: true, notes: "Blue · Flash" }]), [
  { colour: "blue", tries: 1, sent: true },
  { colour: "green", tries: 2, sent: true },
  { colour: "green", tries: 3, sent: true },
])
// new tests: wall, tries and not sent
assert.deepEqual(densityClimbs([d("Yellow · Not sent", { success: false, wall: "slab", tries: 3 }), d("Yellow · Flash", { wall: "desplome", tries: 1 })]), [
  { colour: "yellow", wall: "slab", tries: 3, sent: false },
  { colour: "yellow", wall: "desplome", tries: 1, sent: true },
])

// flash colour: the hardest with 4+ flashes
const climbs = [
  ...Array(6).fill(d("Blue · Flash")),
  ...Array(4).fill(d("Green · Flash")), d("Green · 2nd go"),
  ...Array(3).fill(d("Yellow · Flash")), d("Yellow · Not sent", { success: false }),
].flatMap((a) => densityClimbs([a]))
assert.equal(densityFlashColour(climbs), "green")
assert.equal(densityFlashColour(climbs, 3), "yellow")
assert.equal(densityFlashColour(climbs, 7), null)
assert.deepEqual(densitySummary(climbs).find((s) => s.colour === "yellow"), { colour: "yellow", flashes: 3, sent: 3, tried: 4 })

// latest session with a Density test
const session = (at: string, attempts: any[]) => ({ $createdAt: at, attempts: JSON.stringify(attempts) })
const latest = latestDensityTest([
  session("2026-11-01T10:00:00Z", [d("Blue · Flash")]),
  session("2026-11-09T10:00:00Z", [{ type: "sequence", success: true }]),
  session("2026-11-05T10:00:00Z", [d("Green · Flash")]),
])
assert.equal(latest?.at, "2026-11-05T10:00:00Z")
assert.equal(latestDensityTest([]), null)

console.log("densityFlash tests passed")
