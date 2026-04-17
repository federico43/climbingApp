

export function formatTime(seconds: number | null) {
  if (seconds === null) return "--:--"

  const m = Math.floor(seconds / 60)
  const s = seconds % 60

  return `${m}:${s.toString().padStart(2, "0")}`
}