import { Image } from "expo-image"
import { getSprayWalls } from "@/services/BoulderGraphService"

// Warm the spray-wall photos into expo-image's disk cache on app start, so they
// render instantly the first time a viewer shows them (grid, route picker,
// sequence blocks). prefetch skips anything already cached, so repeat launches
// are cheap. Best-effort: failures are swallowed.
export async function prefetchWallImages(): Promise<void> {
  try {
    const walls = await getSprayWalls()
    const uris = walls
      .map((w) => w.imageUri)
      .filter((u): u is string => typeof u === "string" && u.length > 0)
    if (uris.length) {
      await Image.prefetch(uris, { cachePolicy: "memory-disk" })
    }
  } catch {
    /* best effort */
  }
}
