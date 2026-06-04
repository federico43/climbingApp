import { Image } from "expo-image"
import { getSprayWalls, listProjects } from "@/services/BoulderGraphService"

// Warm remote photos into expo-image's disk cache on app start, so they render
// instantly the first time a viewer shows them. prefetch skips anything already
// cached, so repeat launches are cheap. Best-effort: failures are swallowed.

async function prefetch(uris: string[]) {
  const clean = uris.filter((u): u is string => typeof u === "string" && u.length > 0)
  if (clean.length) await Image.prefetch(clean, { cachePolicy: "memory-disk" })
}

// Spray-wall photos (grid, route picker, sequence blocks).
export async function prefetchWallImages(): Promise<void> {
  try {
    const walls = await getSprayWalls()
    await prefetch(walls.map((w) => w.imageUri))
  } catch {
    /* best effort */
  }
}

// Project photos (home cards, past projects, project picker).
export async function prefetchProjectImages(): Promise<void> {
  try {
    const projects = await listProjects()
    await prefetch(projects.map((p) => p.imageUri ?? ""))
  } catch {
    /* best effort */
  }
}

// Warm both in parallel.
export async function prefetchAppImages(): Promise<void> {
  await Promise.all([prefetchWallImages(), prefetchProjectImages()])
}
