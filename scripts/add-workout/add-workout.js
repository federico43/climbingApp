// One-off script: creates a new workout (a row in Appwrite's `protocol` table)
// for one or more athletes and, optionally, assigns it as each athlete's
// active workout — the same two writes the coach UI does (see
// createProtocol/assignProtocol in services/BoulderGraphService.tsx), but run
// directly against Appwrite instead of through the app. One protocol row is
// created per athlete (see resolveAthleteIds below for why).
//
// Usage:
//   cd scripts/add-workout
//   npm install
//   APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1 \
//   APPWRITE_PROJECT_ID=689e515d000c2e1af428 \
//   APPWRITE_API_KEY=<server API key with tablesDB read/write scope> \
//   APPWRITE_DATABASE_ID=68bd9dd7003c15f7147e \
//   npm run add-workout -- --file=workout.json --dry-run
//
// Run once with --dry-run first to see what it would do, with no writes.
// Drop --dry-run to actually create (and optionally assign) the workout.
//
// See example-workout.json for the input shape. `blocks` follows the Block
// union in components/workoutBlocks.tsx — copy the shape of whichever block
// types you need (strength_conditioning, four_by_four, intervals, etc.), no
// `id` fields (this script strips them if present, same as the app's
// stripLocalIds before saving).

import { Client, TablesDB, Query, ID } from "node-appwrite"
import fs from "node:fs"

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID } = process.env

const DRY_RUN = process.argv.includes("--dry-run")
const fileArg = process.argv.find((a) => a.startsWith("--file="))

for (const [name, value] of Object.entries({
  APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID,
})) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}
if (!fileArg) {
  console.error("Missing --file=<path-to-workout.json>")
  process.exit(1)
}

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY)
const tablesDB = new TablesDB(client)

const USERS_TABLE = "users"
const PROTOCOLS_TABLE = "protocol"

const fileConfig = JSON.parse(fs.readFileSync(fileArg.slice("--file=".length), "utf8"))
// A file is either one workout ({name, blocks, ...}) or a batch of distinct
// workouts ({workouts: [{name, blocks, ...}, ...]}) — e.g. different groups
// getting different block content in one run.
const workoutConfigs = Array.isArray(fileConfig.workouts) ? fileConfig.workouts : [fileConfig]

for (const wc of workoutConfigs) {
  if (!wc.name || !Array.isArray(wc.blocks) || wc.blocks.length === 0) {
    console.error(`Each workout needs a non-empty \`name\` and a non-empty \`blocks\` array. Got: ${JSON.stringify(wc.name)}`)
    process.exit(1)
  }
}

// Strip any local `id` fields (top-level blocks and strength_conditioning
// exercises) — the app never persists these, see stripLocalIds() in
// components/workoutBlocks.tsx.
function stripLocalIds(blocks) {
  return blocks.map(({ id, ...rest }) => {
    if (rest.type === "strength_conditioning" && Array.isArray(rest.exercises)) {
      return { ...rest, exercises: rest.exercises.map(({ id, ...ex }) => ex) }
    }
    return rest
  })
}

async function resolveUserId(username) {
  const result = await tablesDB.listRows({
    databaseId: APPWRITE_DATABASE_ID,
    tableId: USERS_TABLE,
    queries: [Query.equal("username", username)],
  })
  if (result.rows.length === 0) throw new Error(`No user found with username "${username}"`)
  return result.rows[0].$id
}

// One protocol row per athlete — a protocol's `athleteId` is a single value,
// and assignProtocol() just points a user at a protocol id without checking
// it "owns" it, so sharing one row across athletes risks listAthleteTemplates'
// lazy-migrate step silently reassigning that row's athleteId to whichever
// athlete opens it last (see createProtocol/listAthleteTemplates in
// services/BoulderGraphService.tsx). Same content, separate rows, is safe.
async function resolveAthleteIds(config) {
  if (config.athleteIds) return config.athleteIds
  if (config.athleteUsernames) return Promise.all(config.athleteUsernames.map(resolveUserId))
  if (config.athleteId) return [config.athleteId]
  if (config.athleteUsername) return [await resolveUserId(config.athleteUsername)]
  return [null] // no athlete: single global library workout
}

async function createForAthlete(config, athleteId, blocks) {
  const data = { name: config.name, blocks: JSON.stringify(blocks) }
  if (athleteId) data.athleteId = athleteId
  data.source = config.source ?? "coach"

  console.log(`${DRY_RUN ? "[dry-run] Would create" : "Creating"} protocol "${config.name}" with ${blocks.length} block(s)${athleteId ? ` for athlete ${athleteId}` : " (global library workout)"}.`)

  if (DRY_RUN) {
    console.log(JSON.stringify(data, null, 2))
    if (config.assign && athleteId) console.log(`[dry-run] Would also assign it to athlete ${athleteId} as their active workout, dated ${config.assignedAt || "(today)"}.`)
    return
  }

  const row = await tablesDB.createRow({
    databaseId: APPWRITE_DATABASE_ID,
    tableId: PROTOCOLS_TABLE,
    rowId: ID.unique(),
    data,
  })
  console.log(`Created protocol row ${row.$id}`)

  if (config.assign) {
    if (!athleteId) throw new Error("`assign: true` requires athleteId(s)/athleteUsername(s)")
    const assignedAt = config.assignedAt || new Date().toISOString().slice(0, 10)
    try {
      await tablesDB.updateRow({
        databaseId: APPWRITE_DATABASE_ID,
        tableId: USERS_TABLE,
        rowId: athleteId,
        data: { assignedProtocolId: row.$id, assignedAt },
      })
    } catch {
      await tablesDB.updateRow({
        databaseId: APPWRITE_DATABASE_ID,
        tableId: USERS_TABLE,
        rowId: athleteId,
        data: { assignedProtocolId: row.$id },
      })
    }
    console.log(`Assigned protocol ${row.$id} to athlete ${athleteId} as their active workout.`)
  }
}

async function main() {
  for (const config of workoutConfigs) {
    const athleteIds = await resolveAthleteIds(config)
    const blocks = stripLocalIds(config.blocks)
    for (const athleteId of athleteIds) {
      await createForAthlete(config, athleteId, blocks)
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
