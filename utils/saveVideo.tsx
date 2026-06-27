import * as FileSystem from "expo-file-system/legacy"
import { uploadVideoInBackground } from "@/services/videoStorage"

function getVideoDir(): string {
  return FileSystem.documentDirectory + "bouldervideos/"
}

export async function saveVideoLocally(
  uri: string,
  blockType?: string,
  meta?: { projectId?: string; projectName?: string; grade?: string },
): Promise<string | null> {
  const videoDir = getVideoDir()
  console.log("[saveVideo] START — source uri:", uri)
  console.log("[saveVideo] VIDEO_DIR:", videoDir)

  try {
    await FileSystem.makeDirectoryAsync(videoDir, { intermediates: true })
    console.log("[saveVideo] directory ready")

    const filename = `boulderapp_${blockType ?? "video"}_${Date.now()}.mov`
    const dest = videoDir + filename

    const sourceInfo = await FileSystem.getInfoAsync(uri)
    console.log("[saveVideo] source exists:", sourceInfo.exists, "size:", (sourceInfo as any).size ?? "?")

    await FileSystem.copyAsync({ from: uri, to: dest })
    console.log("[saveVideo] copy done")

    const destInfo = await FileSystem.getInfoAsync(dest)
    console.log("[saveVideo] dest exists:", destInfo.exists, "size:", (destInfo as any).size ?? "?")

    // Auto-send every recorded clip to the coach (background, non-blocking).
    uploadVideoInBackground(dest, { blockType, ...meta })

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
      (f) => f.startsWith("boulderapp_") && (f.endsWith(".mov") || f.endsWith(".mp4"))
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
}
