import { C } from "@/utils/theme"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import type { Attempt } from "@/hooks/WorkoutHook"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { useNextBlockLabel } from "@/utils/blockNav"

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")

// ─── Types ────────────────────────────────────────────────────────────────────

interface Block {
  type: "free_session"
  blockName: string
  description?: string
  timeLimit?: number   // minutes; when set, show a countdown instead of elapsed
  // Prompt shown above the notes field once the session ends, e.g. "What
  // did you try?" — set by the coach when building the block. Falls back to
  // a generic "Notes" label when unset.
  notePrompt?: string
  // Example text shown as the notes field's placeholder, e.g. "e.g. Tried
  // the blue overhang, fell on the last move" — set by the coach. Falls
  // back to a generic placeholder when unset.
  noteExample?: string
  // Optional attached sequence — shown for reference only, no attempt tracking.
  routeHolds?: string  // JSON stringified PlacedHold[]
  wallImageUri?: string
  wallWidth?: number
  wallHeight?: number
}

interface Props {
  block: Block
  goToNextBlock?: () => void
  goToPreviousBlock?: () => void
  logAttempt?: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
}

type Phase = "intro" | "running" | "done"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FreeSessionBlock({ block, goToNextBlock, goToPreviousBlock, logAttempt }: Props) {
  const nextLabel = useNextBlockLabel("Next block")
  const [phase, setPhase] = useState<Phase>("intro")
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [note, setNote] = useState("")

  const holds = useMemo(() => {
    if (!block.routeHolds) return []
    try { return JSON.parse(block.routeHolds) } catch { return [] }
  }, [block.routeHolds])
  const hasRoute = holds.length > 0
  const wallImageSource = block.wallImageUri ? { uri: block.wallImageUri } : WALL_IMAGE
  const wallSize = block.wallWidth && block.wallHeight ? { w: block.wallWidth, h: block.wallHeight } : null

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  function start() {
    startTimeRef.current = Date.now()
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current!) / 1000))
    }, 500)
    setPhase("running")
  }

  function stop() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setPhase("done")
  }

  function finish() {
    if (note.trim()) {
      logAttempt?.({ success: true, notes: note.trim() })
    }
    goToNextBlock?.()
  }

  // ── Intro ──────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={block.blockName} onBack={goToPreviousBlock} />
        <ScrollView
          contentContainerStyle={shared_styles.introContent}
          showsVerticalScrollIndicator={false}
        >
          {!!block.description && (
            <Text style={shared_styles.description}>{block.description}</Text>
          )}
          <Pressable style={styles.startBtn} onPress={start}>
            <Text style={styles.startBtnText}>Start</Text>
          </Pressable>
        </ScrollView>
      </View>
    )
  }

  // ── Running ────────────────────────────────────────────────────────────────

  if (phase === "running") {
    // With a time limit, count down from it (turning red at zero) instead of
    // showing elapsed time. The countdown starts when the athlete hits Start.
    const limitSec = (block.timeLimit ?? 0) * 60
    const hasLimit = limitSec > 0
    const remaining = Math.max(0, limitSec - elapsed)
    const over = hasLimit && remaining <= 0
    return (
      <View style={shared_styles.screen}>
        <TopBar title={block.blockName} />
        {!!block.description && (
          <Text style={styles.runningDescription}>{block.description}</Text>
        )}
        {hasRoute && (
          <View style={styles.wallWrap}>
            <SprayWallViewer
              imageSource={wallImageSource}
              holds={holds}
              style={{ flex: 1 }}
              freeGesture
              naturalSize={wallSize}
            />
          </View>
        )}
        <View style={hasRoute ? styles.timerFooter : styles.centerContent}>
          <Text style={styles.timerLabel}>{hasLimit ? (over ? "time's up" : "remaining") : "elapsed"}</Text>
          <Text style={[styles.timer, over && { color: C.red }, hasRoute && styles.timerCompact]}>
            {hasLimit ? formatElapsed(remaining) : formatElapsed(elapsed)}
          </Text>
          <Pressable style={styles.stopBtn} onPress={stop}>
            <Text style={styles.stopBtnText}>Stop</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Done ───────────────────────────────────────────────────────────────────

  return (
    <View style={shared_styles.screen}>
      <TopBar title={block.blockName} />
      <ScrollView
        contentContainerStyle={styles.doneContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.doneCheck}>✓</Text>
        <Text style={styles.doneTitle}>Session complete</Text>
        <Text style={styles.doneTime}>{formatElapsed(elapsed)}</Text>
        <View style={styles.noteBlock}>
          <Text style={styles.noteLabel}>{block.notePrompt || "Notes"}</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={block.noteExample || "Add a note (optional)"}
            placeholderTextColor={C.textMuted}
            style={styles.noteInput}
            multiline
          />
        </View>
        <Pressable style={styles.nextBtn} onPress={finish}>
          <Text style={styles.nextBtnText}>{nextLabel}</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 20,
  },
  doneContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 20,
  },

  // Done — note field
  noteBlock: {
    width: "100%",
    gap: 8,
  },
  noteLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textMuted,
  },
  noteInput: {
    width: "100%",
    minHeight: 90,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: C.textPrimary,
    textAlignVertical: "top",
  },

  // Running — description
  runningDescription: {
    fontSize: 14,
    color: C.textMuted,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
  },

  // Attached-sequence viewer (running)
  wallWrap: { flex: 1 },
  timerFooter: {
    alignItems: "center",
    paddingHorizontal: 32,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 12,
  },
  timerCompact: {
    fontSize: 44,
    lineHeight: 50,
  },

  // Timer display
  timerLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  timer: {
    fontSize: 72,
    fontWeight: "700",
    color: C.textPrimary,
    fontVariant: ["tabular-nums"],
    letterSpacing: -2,
    lineHeight: 80,
  },

  // Start button
  startBtn: {
    width: "100%",
    backgroundColor: C.green,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: 8,
  },
  startBtnText: {
    fontSize: 18,
    fontWeight: "700",
    color: C.bg,
    letterSpacing: 0.3,
  },

  // Stop button
  stopBtn: {
    width: "100%",
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    borderWidth: 2,
    borderColor: C.red,
    marginTop: 8,
  },
  stopBtnText: {
    fontSize: 18,
    fontWeight: "700",
    color: C.red,
    letterSpacing: 0.3,
  },

  // Done state
  doneCheck: {
    fontSize: 52,
    color: C.green,
    lineHeight: 60,
  },
  doneTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
  },
  doneTime: {
    fontSize: 40,
    fontWeight: "600",
    color: C.textSecondary,
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },

  // Next button
  nextBtn: {
    width: "100%",
    backgroundColor: C.green,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    marginTop: 8,
  },
  nextBtnText: {
    fontSize: 18,
    fontWeight: "700",
    color: C.bg,
    letterSpacing: 0.3,
  },
})
