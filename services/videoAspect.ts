import * as VideoThumbnails from "expo-video-thumbnails"

export interface VideoAspectSize { w: number; h: number }

// expo-video's player.videoTrack.size reports raw encoded dimensions, which
// don't account for the rotation transform phone-recorded portrait clips
// carry — a thumbnail's width/height reflect the actual visual frame instead
// (rotation already applied), and is the only reliable source for a clip's
// true displayed aspect ratio. Cached per video id since both
// CoachFeedbackRecorder and FeedbackViewer need it for the same clip, and
// in-flight requests are deduped so mounting both at once doesn't fetch twice.
const cache = new Map<string, VideoAspectSize>()
const inflight = new Map<string, Promise<VideoAspectSize | null>>()

export function getCachedVideoAspect(id: string): VideoAspectSize | null {
  return cache.get(id) ?? null
}

export function loadVideoAspect(id: string, url: string): Promise<VideoAspectSize | null> {
  const cached = cache.get(id)
  if (cached) return Promise.resolve(cached)
  const existing = inflight.get(id)
  if (existing) return existing
  const promise = VideoThumbnails.getThumbnailAsync(url, { time: 0, quality: 0.01 })
    .then((result) => {
      const size = { w: result.width, h: result.height }
      cache.set(id, size)
      return size
    })
    .catch((e: any) => {
      console.warn("[feedback] aspect lookup failed for", id, e?.message ?? e)
      return null
    })
    .finally(() => { inflight.delete(id) })
  inflight.set(id, promise)
  return promise
}
