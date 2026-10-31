// The plans athletes can ask for, as the "Choose your plan" pop-ups show
// them (components/schedule/PlanPicker.tsx), from the "Planes para clientes"
// PDF. The server keeps the prices and packages too
// (functions/aiProtocol/src/clientPlans.js); keep both in step.

export type PlanId = "program6" | "hybrid" | "flex" | "fundamentals"
export type PaymentId = "once" | "twice" | "blocks3"

export interface PaymentOption {
  id: PaymentId
  label: string
  sub: string
  price: number   // COP
  sessions: number
  weeks: number
}

// A block of the plan's detail: a list with ticks or crosses, label → value
// rows, a short text, or a highlighted note.
export type PlanSection =
  | { kind: "check" | "cross"; title: string; items: (string | [string, string])[] }
  | { kind: "rows"; title: string; rows: [string, string][] }
  | { kind: "text"; title: string; text: string }
  | { kind: "note"; title?: string; lines: string[]; tone: "green" | "yellow" }

export interface ClientPlan {
  id: PlanId
  name: string
  summary: string                                        // the line under the name in the list
  detail: string                                         // the line under the name in the detail
  tag?: { text: string; tone: "badge" | "yellow" }
  payments: PaymentOption[]                              // the first one is the default
  sections: PlanSection[]
}

export const CLIENT_PLANS: ClientPlan[] = [
  {
    id: "program6",
    name: "6-Week Program",
    summary: "2 sessions a week · 6 weeks",
    detail: "12 sessions in the gym · 2 a week",
    tag: { text: "BEST VALUE", tone: "badge" },
    payments: [
      { id: "once", label: "Pay once", sub: "1 block", price: 345000, sessions: 12, weeks: 6 },
      { id: "twice", label: "2 payments", sub: "$180.000 each", price: 360000, sessions: 12, weeks: 6 },
      { id: "blocks3", label: "3 blocks", sub: "18 weeks · save about 10%", price: 930000, sessions: 36, weeks: 18 },
    ],
    sections: [
      {
        kind: "check",
        title: "Included",
        items: [
          "Test at the start and at the end",
          "Your own training plan",
          "Check-in with your coach in week 3",
          "Results report with before/after video",
          ["Improve or your next block is free", "Come to 11 of 12 sessions and do the home work"],
        ],
      },
      {
        kind: "rows",
        title: "If you can't come",
        rows: [["Miss a class", "Make it up · tell us 24 h before"], ["Trip", "Travel plan, up to 2 weeks"], ["Long break", "Freeze up to 2 weeks"]],
      },
    ],
  },
  {
    id: "hybrid",
    name: "Hybrid Program",
    summary: "1 in gym + 1 online a week · 6 weeks",
    detail: "6 in the gym + 6 online · 6 weeks",
    tag: { text: "Intermediate and up", tone: "yellow" },
    payments: [{ id: "once", label: "Pay once", sub: "", price: 270000, sessions: 6, weeks: 6 }],
    sections: [
      { kind: "note", title: "You need", lines: ["Intermediate level or higher", "A wall or training equipment at home"], tone: "yellow" },
      { kind: "rows", title: "Each week", rows: [["In the gym", "Technique, hard boulders, tests"], ["Online", "Strength, hangboard, mobility"]] },
      {
        kind: "check",
        title: "Included",
        items: [
          "Test at the start and at the end",
          "Your own training plan",
          "Weekly feedback + 1 video reviewed",
          ["Improve or your next block is free", "Log your online sessions in the app"],
        ],
      },
      { kind: "rows", title: "If you can't come", rows: [["Trip", "Online sessions keep going"], ["Long break", "Freeze up to 2 weeks"]] },
    ],
  },
  {
    id: "flex",
    name: "Flex",
    summary: "8 classes · use them within 6 weeks",
    detail: "8 guided classes · use them within 6 weeks",
    payments: [{ id: "once", label: "Pay once", sub: "", price: 280000, sessions: 8, weeks: 6 }],
    sections: [
      { kind: "text", title: "How it works", text: "Book any open spot. Your coach confirms it 24–48 h before." },
      { kind: "cross", title: "Not included", items: ["Tests", "Your own training plan", "Fixed spot in a group", "Improvement guarantee"] },
      {
        kind: "rows",
        title: "If you can't come",
        rows: [["Unused classes", "Lost after 6 weeks"], ["Sick", "More time with a doctor's note"], ["Long trip", "+2 weeks, extra cost"], ["Travel plan", "$35.000 a week"]],
      },
    ],
  },
  {
    id: "fundamentals",
    name: "Fundamentals",
    summary: "4 classes · use them within 5 weeks",
    detail: "4 classes · 1 a week · use them within 5 weeks",
    tag: { text: "New to climbing", tone: "yellow" },
    payments: [{ id: "once", label: "Pay once", sub: "", price: 130000, sessions: 4, weeks: 5 }],
    sections: [
      { kind: "check", title: "You learn", items: ["Falling and safety", "Footwork", "Body position", "Reading routes", "Skills checklist in the last class"] },
      { kind: "rows", title: "If you can't come", rows: [["Miss a class", "1 make-up · tell us 24 h before"], ["Trip", "Pause up to 2 weeks"]] },
      { kind: "note", lines: ["$20.000 off the 6-Week Program", "If you join it the week after you finish"], tone: "green" },
    ],
  },
]

export const planById = (id: string): ClientPlan | null => CLIENT_PLANS.find((p) => p.id === id) ?? null

export function paymentOf(plan: string, payment: string): { plan: ClientPlan; pay: PaymentOption } | null {
  const p = planById(plan)
  const pay = p?.payments.find((x) => x.id === payment)
  return p && pay ? { plan: p, pay } : null
}

// 345000 → "$345.000" (pesos, dots for thousands).
export const formatCop = (n: number) => `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`

// "6-Week Program · Pay once · $345.000", for the coach's list.
export function requestLabel(plan: string, payment: string): string {
  const p = paymentOf(plan, payment)
  if (!p) return "Unknown plan"
  return p.plan.payments.length > 1 ? `${p.plan.name} · ${p.pay.label} · ${formatCop(p.pay.price)}` : `${p.plan.name} · ${formatCop(p.pay.price)}`
}

// A row from the server (table plan_requests).
export interface PlanRequestRow {
  $id: string
  $createdAt?: string
  athleteId: string
  plan: PlanId
  payment: PaymentId
  status: "pending" | "active" | "declined"
  packageId?: string | null
}
