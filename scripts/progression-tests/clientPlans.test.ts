// The plans in the app's pop-ups (utils/clientPlans.ts) and on the server
// (functions/aiProtocol/src/clientPlans.js) must agree. Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/clientPlans.test.ts

import assert from "node:assert/strict"
import { CLIENT_PLANS as SERVER, formatCop as serverCop, planTerms } from "@/functions/aiProtocol/src/clientPlans.js"
import { CLIENT_PLANS, formatCop, paymentOf, requestLabel } from "@/utils/clientPlans"

assert.deepEqual(CLIENT_PLANS.map((p) => p.id).sort(), Object.keys(SERVER).sort())
for (const plan of CLIENT_PLANS) {
  assert.equal(plan.name, (SERVER as any)[plan.id].name)
  assert.deepEqual(plan.payments.map((o) => o.id).sort(), Object.keys((SERVER as any)[plan.id].payments).sort())
  for (const o of plan.payments) {
    const terms = planTerms(plan.id, o.id)!
    assert.deepEqual([o.label, o.price, o.sessions, o.weeks], [terms.label, terms.price, terms.sessions, terms.weeks], `${plan.id}/${o.id}`)
  }
}
assert.equal(planTerms("flex", "twice"), null)
assert.equal(planTerms("__proto__", "once"), null)
assert.equal(paymentOf("flex", "twice"), null)

for (const n of [0, 999, 1000, 35000, 345000, 930000, 1234567]) assert.equal(formatCop(n), serverCop(n))
assert.equal(formatCop(345000), "$345.000")
assert.equal(formatCop(1234567), "$1.234.567")
assert.equal(requestLabel("program6", "blocks3"), "6-Week Program · 3 blocks · $930.000")
assert.equal(requestLabel("flex", "once"), "Flex · $280.000")

console.log("clientPlans: all tests passed")
