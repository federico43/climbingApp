// Tests for utils/timerDial.ts (the big timer dial's geometry). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/timerDial.test.ts

import assert from "node:assert/strict"
import { clockEm, clockFontSize, clockText, dialGeometry, dialTicks, fitDialSize } from "@/utils/timerDial"

const count = (path: string) => (path.match(/M/g) ?? []).length

// The mock-up's ring: 260 pt, 14 pt stroke, ticks 8 pt out, 10 pt majors → a 296 pt dial.
const g = dialGeometry(260)
assert.equal(g.k, 1)
assert.equal(g.stroke, 14)
assert.equal(g.box, 296)
assert.equal(g.face, 232)
assert.equal(g.tickInner, 138)
// Smaller rings scale, with a stroke of at least 8.
assert.equal(dialGeometry(130).stroke, 8)
assert.equal(dialGeometry(130).box, 148)

// 60 ticks, every 5th a major one.
const all = (t: ReturnType<typeof dialTicks>) => count(t.litMajor) + count(t.litMinor) + count(t.dimMajor) + count(t.dimMinor)
const start = dialTicks(260, 0)
assert.equal(all(start), 60)
assert.equal(count(start.litMajor) + count(start.dimMajor), 12)
// At the start only 12 o'clock is lit; at the end all of them.
assert.equal(count(start.litMajor), 1)
assert.equal(count(start.litMinor), 0)
const end = dialTicks(260, 100)
assert.equal(count(end.litMajor) + count(end.litMinor), 60)
// The mock-up: 1:22 left of 8:00 (83 %) → ticks up to 294° lit, 300° (10 o'clock) faded.
const mock = dialTicks(260, ((480 - 82) / 480) * 100)
assert.equal(count(mock.litMajor) + count(mock.litMinor), 50)
assert.equal(count(mock.dimMajor), 2) // 10 and 11 o'clock
// Out-of-range fills are clamped.
assert.deepEqual(dialTicks(260, -5), start)
assert.deepEqual(dialTicks(260, 140), end)
// 12 o'clock's tick is vertical, from r 138 to 148 above the centre (148, 148).
assert.ok(start.litMajor.startsWith("M148 10L148 0"))

// Clock digits: 104 pt at 260 for "1:22"; long clocks shrink to fit the face.
assert.equal(clockFontSize("1:22", 260), 104)
assert.equal(clockFontSize("1:22", 130), 52)
assert.ok(clockFontSize("12:34", 260) < 104)
assert.ok(clockFontSize("1:05:00", 260) * clockEm("1:05:00") <= 232 * 0.85 + 1)
assert.equal(clockFontSize("", 260), 104)

// Fit: the biggest ring whose dial (ticks included) fits, 120–260.
assert.equal(fitDialSize(400, 600), 260)
assert.equal(fitDialSize(400, 250), Math.round(250 / (296 / 260)))
assert.equal(fitDialSize(100, 100), 120)

// Clock text.
assert.equal(clockText(82), "1:22")
assert.equal(clockText(480), "8:00")
assert.equal(clockText(754), "12:34")
assert.equal(clockText(3900), "1:05:00")
assert.equal(clockText(-3), "0:00")

console.log("timerDial: all tests passed")
