import * as FileSystem from "expo-file-system/legacy"
import { VIDEO_EXTENSIONS, videoExtOf } from "@/services/videoStorage"
import { enqueueVideoUpload, removeFromUploadQueue, videoDir } from "@/services/videoUploadQueue"

const getVideoDir = videoDir

export async function saveVideoLocally(
  uri: string,
  blockType?: string,
  meta?: { projectId?: string; projectName?: string; grade?: string },
  options?: {
    // Recorded clips auto-submit to the coach during a monitored block.
    // Imported clips are a deliberate, out-of-session action, so callers can
    // opt out and let the athlete decide instead.
    notifyCoach?: boolean
    // Tags the filename so the Library grid can badge this clip as pulled in
    // from the camera roll rather than recorded live, and — if notifyCoach is
    // on — carries the same flag onto the remote `videos` row so the coach's
    // view shows the identical badge.
    imported?: boolean
  },
): Promise<string | null> {
  const videoDir = getVideoDir()
  console.log("[saveVideo] START — source uri:", uri)
  console.log("[saveVideo] VIDEO_DIR:", videoDir)

  try {
    await FileSystem.makeDirectoryAsync(videoDir, { intermediates: true })
    console.log("[saveVideo] directory ready")

    // Keeps whatever container the clip came in (camera .mov, imported .mp4/.m4v).
    const ext = videoExtOf(uri)
    const tag = options?.imported ? "_imported" : ""
    const filename = `boulderapp_${blockType ?? "video"}${tag}_${Date.now()}.${ext}`
    const dest = videoDir + filename

    const sourceInfo = await FileSystem.getInfoAsync(uri)
    console.log("[saveVideo] source exists:", sourceInfo.exists, "size:", (sourceInfo as any).size ?? "?")

    // Move, not copy: the source is a temp file in the cache (camera output
    // or the picker's export), and copying left a second full-size copy of
    // every clip behind.
    await FileSystem.moveAsync({ from: uri, to: dest })
    console.log("[saveVideo] move done")

    const destInfo = await FileSystem.getInfoAsync(dest)
    console.log("[saveVideo] dest exists:", destInfo.exists, "size:", (destInfo as any).size ?? "?")

    if (options?.notifyCoach ?? true) {
      // Persistent queue: retried until it reaches the coach (see
      // services/videoUploadQueue.ts). Not awaited past the enqueue itself.
      await enqueueVideoUpload(filename, { blockType, ...meta, imported: options?.imported })
    }

    return dest
  } catch (err) {
    console.error("[saveVideo] ERROR:", err)
    return null
  }
}

export async function listSavedVideos(): Promise<{ filename: string; uri: string }[]> {
  const videoDir = getVideoDir()
  console.log("[listVideos] VIDEO_DIR:", videoDir)

  try {
    const dirInfo = await FileSystem.getInfoAsync(videoDir)
    console.log("[listVideos] dir exists:", dirInfo.exists)
    if (!dirInfo.exists) return []

    const files = await FileSystem.readDirectoryAsync(videoDir)
    console.log("[listVideos] all files:", files)

    const filtered = files.filter(
      (f) => f.startsWith("boulderapp_") && VIDEO_EXTENSIONS.some((ext) => f.endsWith("." + ext))
    )
    console.log("[listVideos] filtered:", filtered)

    return filtered
      .sort()
      .reverse()
      .map((filename) => ({ filename, uri: videoDir + filename }))
  } catch (err) {
    console.error("[listVideos] ERROR:", err)
    return []
  }
}

export async function deleteVideoFile(filename: string): Promise<void> {
  const uri = getVideoDir() + filename
  console.log("[deleteVideo] deleting:", uri)
  await FileSystem.deleteAsync(uri, { idempotent: true })
  await removeFromUploadQueue(filename)
}
