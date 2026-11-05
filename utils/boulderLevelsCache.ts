import { getBoulderLevels } from "@/services/BoulderGraphService"
import { useEffect, useState } from "react"

// Boulder level id → difficulty (niveles_boulder), fetched once and shared:
// the Stats card and the athlete's block review score Density tests with it.

const TTL_MS = 30 * 60_000

let cache: { at: number; promise: Promise<Record<string, number>> } | null = null

export function getLevelDifficulty(): Promise<Record<string, number>> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const promise = getBoulderLevels().then((rows) =>
      Object.fromEntries((rows as any[]).map((r) => [r.$id, typeof r.difficulty === "number" ? r.difficulty : 0])),
    )
    cache = { at: Date.now(), promise }
    // A failed fetch (offline) shouldn't stick — the next caller retries.
    promise.catch(() => { if (cache?.promise === promise) cache = null })
  }
  return cache.promise
}

// undefined until loaded (or if it fails).
export function useLevelDifficulty(): Record<string, number> | undefined {
  const [map, setMap] = useState<Record<string, number>>()
  useEffect(() => {
    let cancelled = false
    getLevelDifficulty().then((m) => { if (!cancelled) setMap(m) }).catch(console.error)
    return () => { cancelled = true }
  }, [])
  return map
}
