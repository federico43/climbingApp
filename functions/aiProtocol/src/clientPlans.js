// The plans athletes can ask for (the "Choose your plan" pop-ups), as the
// server needs them: what each one costs and the package the coach's OK
// creates. Kept in step with utils/clientPlans.ts, which also holds what the
// pop-ups show (scripts/progression-tests/clientPlans.test.ts checks both
// agree). There's no payment in the app: the athlete sends a request and the
// coach activates it once they've paid.

export const CLIENT_PLANS = {
  program6: {
    name: "6-Week Program",
    payments: {
      once: { label: "Pay once", price: 345000, sessions: 12, weeks: 6 },
      twice: { label: "2 payments", price: 360000, sessions: 12, weeks: 6 },
      blocks3: { label: "3 blocks", price: 930000, sessions: 36, weeks: 18 },
    },
  },
  hybrid: { name: "Hybrid Program", payments: { once: { label: "Pay once", price: 270000, sessions: 6, weeks: 6 } } },
  flex: { name: "Flex", payments: { once: { label: "Pay once", price: 280000, sessions: 8, weeks: 6 } } },
  fundamentals: { name: "Fundamentals", payments: { once: { label: "Pay once", price: 130000, sessions: 4, weeks: 5 } } },
}

const own = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k)

// The plan and payment option, or null when either isn't one of ours.
export function planTerms(plan, payment) {
  const p = own(CLIENT_PLANS, plan) ? CLIENT_PLANS[plan] : null
  const pay = p && own(p.payments, payment) ? p.payments[payment] : null
  return pay ? { name: p.name, ...pay } : null
}

// 345000 → "$345.000" (pesos, dots for thousands).
export const formatCop = (n) => `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`
