// Group items with a $createdAt ISO date into Today / Yesterday / Last week / Earlier
export type DateGroup = "Today" | "Yesterday" | "Last week" | "Earlier"

// Local-time `YYYY-MM-DD` from a Date.
export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// True if the ISO timestamp falls on the local day matching dateKey.
export function isSameLocalDay(iso: string, dateKey: string): boolean {
  return localDateKey(new Date(iso)) === dateKey
}

// User-friendly label like "Today", "Yesterday", "Mon, Nov 4"
export function friendlyDateLabel(dateKey: string): string {
  const today = localDateKey(new Date())
  if (dateKey === today) return "Today"
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateKey === localDateKey(yesterday)) return "Yesterday"
  return new Date(dateKey + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  })
}

export function groupByDate<T extends { $createdAt: string }>(
  items: T[]
): { group: DateGroup; items: T[] }[] {
  const now = new Date()
  const startOfDay = (d: Date) => {
    const x = new Date(d); x.setHours(0, 0, 0, 0); return x
  }
  const today      = startOfDay(now).getTime()
  const yesterday  = today - 24 * 60 * 60 * 1000
  const sevenAgo   = today - 7 * 24 * 60 * 60 * 1000

  const buckets: Record<DateGroup, T[]> = {
    "Today": [],
    "Yesterday": [],
    "Last week": [],
    "Earlier": [],
  }
  for (const item of items) {
    const t = new Date(item.$createdAt).getTime()
    if (t >= today)            buckets["Today"].push(item)
    else if (t >= yesterday)   buckets["Yesterday"].push(item)
    else if (t >= sevenAgo)    buckets["Last week"].push(item)
    else                       buckets["Earlier"].push(item)
  }
  const order: DateGroup[] = ["Today", "Yesterday", "Last week", "Earlier"]
  return order
    .filter((g) => buckets[g].length > 0)
    .map((g) => ({ group: g, items: buckets[g] }))
}
