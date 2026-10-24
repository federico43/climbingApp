// One-off script: try the weekly classes on the climbingApp function before
// merging. Deploys a git branch (from the GitHub connection), runs the
// function every hour for the class reminders and sets the gym's time zone.
// Dry run by default — prints the function's current settings.
//
// Usage:
//   node --env-file=.env.local scripts/class-tables/deploy-test.mjs <branch> <time zone> [--apply]
//   e.g. ... deploy-test.mjs claude/project-thread-xp1ixc America/Santiago --apply
// (.env.local: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY)
// To go back: activate the latest main deployment in the console (the
// schedule and GYM_TZ can stay; main ignores them until classes merge).

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env
const FUNCTION_ID = "6a1c2e850024e1f59fc3" // climbingApp
const SCHEDULE = "0 * * * *"
const [branch, tz] = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const APPLY = process.argv.includes("--apply")

for (const [name, value] of Object.entries({ APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY })) {
  if (!value) { console.error(`Missing env var: ${name}`); process.exit(1) }
}
if (!branch || !tz) { console.error("Usage: deploy-test.mjs <branch> <time zone> [--apply]"); process.exit(1) }
try { new Intl.DateTimeFormat("en-US", { timeZone: tz }) } catch { console.error(`Unknown time zone: ${tz}`); process.exit(1) }

async function api(method, path, body) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Appwrite-Project": APPWRITE_PROJECT_ID, "X-Appwrite-Key": APPWRITE_API_KEY },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.message ?? ""}`)
  return json
}

const fn = await api("GET", `/functions/${FUNCTION_ID}`)
const { variables = [] } = await api("GET", `/functions/${FUNCTION_ID}/variables`)
const tzVar = variables.find((v) => v.key === "GYM_TZ")
console.log(`Function: ${fn.name} · active deployment ${fn.deploymentId ?? fn.deployment} · schedule "${fn.schedule || ""}" · GYM_TZ ${tzVar?.value ?? "(not set)"}`)
console.log(`Git: branch ${fn.providerBranch}, root ${fn.providerRootDirectory}`)
if (!APPLY) {
  console.log(`\nWould deploy ${branch}, set schedule "${SCHEDULE}" and GYM_TZ=${tz}. Pass --apply.`)
  process.exit(0)
}

// Keep every other setting as it is: the update replaces the whole function.
const keep = [
  "name", "runtime", "execute", "events", "timeout", "enabled", "logging", "entrypoint", "commands", "scopes",
  "installationId", "providerRepositoryId", "providerBranch", "providerSilentMode", "providerRootDirectory", "specification",
]
const update = Object.fromEntries(keep.filter((k) => fn[k] !== undefined).map((k) => [k, fn[k]]))
await api("PUT", `/functions/${FUNCTION_ID}`, { ...update, schedule: SCHEDULE })
console.log(`Schedule set to "${SCHEDULE}"`)

if (tzVar) await api("PUT", `/functions/${FUNCTION_ID}/variables/${tzVar.$id}`, { key: "GYM_TZ", value: tz })
else await api("POST", `/functions/${FUNCTION_ID}/variables`, { key: "GYM_TZ", value: tz })
console.log(`GYM_TZ = ${tz}`)

const dep = await api("POST", `/functions/${FUNCTION_ID}/deployments/vcs`, { type: "branch", reference: branch, activate: true })
console.log(`Deploying ${branch}: ${dep.$id} (${dep.status}). It's live once the build finishes, about a minute.`)
