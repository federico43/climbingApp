// Tests for unknownColumn (services/BoulderGraphService.tsx): which column a
// failed spray_routes write names, so only that one is dropped. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sprayRouteSave.test.ts
import assert from "node:assert/strict"
import { unknownColumn } from "@/utils/appwriteErrors"

assert.equal(unknownColumn('Invalid document structure: Unknown attribute: "athleteId"'), "athleteId")
assert.equal(unknownColumn("Invalid row structure: Unknown column: 'variations'"), "variations")
assert.equal(unknownColumn("Unknown attribute: level"), "level")
assert.equal(unknownColumn("Missing required attribute \"name\""), null)
assert.equal(unknownColumn(undefined), null)
console.log("sprayRouteSave: ok")
