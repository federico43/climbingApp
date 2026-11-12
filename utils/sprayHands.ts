// Which hand makes the move right after a hand bounce (coach 2026-11-12).
// Only when move 1 says its hand (left or right): moves alternate hands,
// a match hold is two moves (the other hand comes to the same hold), and
// after a bounce the same hand moves again. Pure, shared by the builder and
// the viewer, which add the letter to that move's badge ("5L").

export interface HandHold {
  id: string
  type: string
  order?: number
  hand?: "left" | "right" | "both"
  match?: boolean
  bounce?: boolean
}

export type HandLetter = "L" | "R"

const other = (h: HandLetter): HandLetter => (h === "L" ? "R" : "L")

export function handsAfterBounce(holds: HandHold[]): Map<string, HandLetter> {
  const out = new Map<string, HandLetter>()
  const moves = holds
    .filter((h) => h.type === "move" && h.order != null)
    .sort((a, b) => a.order! - b.order!)
  const firstHand = moves[0]?.hand
  if (firstHand !== "left" && firstHand !== "right") return out
  let hand: HandLetter = firstHand === "left" ? "L" : "R"
  let prevBounce = false
  moves.forEach((m, i) => {
    if (i > 0) hand = prevBounce ? hand : other(hand)
    if (prevBounce) out.set(m.id, hand)
    // A match hold's second number is the other hand; the next move goes on from there.
    if (m.match) hand = other(hand)
    prevBounce = !!m.bounce && !m.match
  })
  return out
}
