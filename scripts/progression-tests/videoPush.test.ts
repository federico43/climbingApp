// Tests for functions/aiProtocol/src/videoPush.js (coach push for a new clip). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/videoPush.test.ts

import assert from "node:assert/strict"
import { videoPushMessage } from "@/functions/aiProtocol/src/videoPush.js"

// Route name + grade win over the block label
{
  const m = videoPushMessage({ $id: "v1", userId: "a1", blockType: "sequence", projectName: "La roja", grade: "V5" }, "Ana")
  assert.equal(m.title, "New video")
  assert.equal(m.body, 'Ana sent a video: "La roja" V5.')
  assert.deepEqual(m.data, { type: "video_uploaded", athleteId: "a1", videoId: "v1" })
}

// Only the block → its label; grade alone is enough too
assert.equal(videoPushMessage({ blockType: "project_bouldering" }, "Ana").body, "Ana sent a video: Project bouldering.")
assert.equal(videoPushMessage({ blockType: "free_session", grade: "V3" }, "Ana").body, "Ana sent a video: V3.")

// Nothing known (imported clip, no name)
assert.equal(videoPushMessage({ blockType: "weird" }, "").body, "An athlete sent a video.")

console.log("videoPush tests passed")
