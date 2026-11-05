// The coach push for "an athlete sent a video" (action `videoUploaded` in
// main.js). Pure, so it's testable without Appwrite.

const BLOCK_LABELS = {
  project_bouldering: "Project bouldering",
  sequence: "Max bouldering",
  route_exploration: "Route exploration",
  constraint_warmup: "Warm-up",
  exploration_session: "Exploration",
  free_session: "Free session",
  four_by_four: "4x4",
  intervals: "Intervals",
  strength_conditioning: "S&C",
}

const clean = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "")

// row: the `videos` row (projectName, grade, blockType, imported).
export function videoPushMessage(row, athleteName) {
  const name = clean(athleteName, 60) || "An athlete"
  const route = clean(row?.projectName, 80)
  const grade = clean(row?.grade, 20)
  const block = BLOCK_LABELS[row?.blockType] ?? ""
  const what = [route ? `"${route}"` : "", grade].filter(Boolean).join(" ")
  const context = what || block
  return {
    sound: "default",
    title: "New video",
    body: context ? `${name} sent a video: ${context}.` : `${name} sent a video.`,
    data: { type: "video_uploaded", athleteId: row?.userId ?? null, videoId: row?.$id ?? null },
  }
}
