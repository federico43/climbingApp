// Pure helpers for Settings › Notifications sent (app/(tabs)/(buttonTabs)/push-log.tsx).

const pad = (n: number) => String(n).padStart(2, "0")
const localYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Entries (already newest first) grouped by local day: "Today", "Yesterday",
// then "Mon 27 Oct".
export function groupByDay<T extends { at: string }>(entries: T[], now = new Date()): { label: string; entries: T[] }[] {
  const today = localYmd(now)
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const yesterday = localYmd(yest)
  const groups: { key: string; label: string; entries: T[] }[] = []
  for (const e of entries) {
    const d = new Date(e.at)
    const key = isNaN(d.getTime()) ? "?" : localYmd(d)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      const label = key === today ? "Today" : key === yesterday ? "Yesterday" : key === "?" ? "Unknown date"
        : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
      g = { key, label, entries: [] }
      groups.push(g)
    }
    g.entries.push(e)
  }
  return groups.map(({ label, entries }) => ({ label, entries }))
}

export function timeLabel(at: string): string {
  const d = new Date(at)
  return isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// "class_tomorrow" → "Class tomorrow"; "classCron" → "Hourly reminders".
export function humanize(s: string | null): string {
  if (!s) return ""
  if (s === "classCron") return "Hourly reminders"
  const words = s.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
