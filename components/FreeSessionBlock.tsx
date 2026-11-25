import { ActiveScreen } from "@/components/ActiveScreen"
import { BlockIntro } from "@/components/BlockIntro"
import { minutesLabel } from "@/utils/blockIntro"
import { paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import { shared_stylesSheet, TopBar } from "@/utils/BlockStyles"
import type { Attempt } from "@/hooks/WorkoutHook"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { useNextBlockLabel } from "@/utils/blockNav"
import { useBlockTimerAlert } from "@/hooks/useBlockTimerAlert"
import { usePauseClock } from "@/hooks/usePauseClock"
import { ringFill, timerColor } from "@/components/IntervalVisuals"
import { clockText } from "@/utils/timerDial"

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
  const C = useC()
  const shared_styles = useSheet(shared_stylesSheet)
  const styles = useSheet(sheet)
  const nextLabel = useNextBlockLabel("Next block")
  const [phase, setPhase] = useState<Phase>("intro")
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [note, setNote] = useState("")
  // When the time limit (if any) runs out while running — beeps / notifies.
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const clock = usePauseClock()
  useBlockTimerAlert(clock.real(endsAt), block.blockName || "Free session")

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
    clock.reset()
    startTimeRef.current = Date.now()
    const limitSec = (block.timeLimit ?? 0) * 60
    setEndsAt(limitSec > 0 ? startTimeRef.current + limitSec * 1000 : null)
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((clock.now() - startTimeRef.current!) / 1000))
    }, 500)
    setPhase("running")
  }

  function stop(next: Phase = "done") {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setEndsAt(null)
    clock.reset()
    setPhase(next)
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
      <BlockIntro
        title={block.blockName || "Free session"}
        onBack={goToPreviousBlock}
        facts={[minutesLabel(block.timeLimit)]}
        note={block.description}
        startSub={["Free session", minutesLabel(block.timeLimit)].filter(Boolean).join(" · ")}
        onStart={start}
      />
    )
  }

  // ── Running ────────────────────────────────────────────────────────────────

  if (phase === "running") {
    // With a time limit, count down from it (ink at zero) instead of showing
    // elapsed time. The countdown starts when the athlete hits Start.
    const limitSec = (block.timeLimit ?? 0) * 60
    const hasLimit = limitSec > 0
    const remaining = Math.max(0, limitSec - elapsed)
    const over = hasLimit && remaining <= 0
    // The running screen (components/ActiveScreen.tsx). The dial is the
    // standard timer ring; with no limit it counts up, one lap a minute.
    // Back goes to the intro and drops the timer, like route exploration's.
    return (
      <ActiveScreen
        title={block.blockName || "Free session"}
        meta={hasLimit ? `${clockText(limitSec)} total` : null}
        onBack={() => { stop("intro"); setElapsed(0) }}
        notes={block.description}
        ring={{
          fill: hasLimit ? ringFill(limitSec, remaining) : ((elapsed % 60) / 60) * 100,
          color: timerColor(C, over ? "over" : "work"),
          title: hasLimit ? (over ? "Time's up" : "Session · left") : "Session · so far",
          seconds: hasLimit ? remaining : elapsed,
          text: clockText(hasLimit ? remaining : elapsed),
          glow: !over,
          paused: clock.paused,
          onTogglePause: over ? undefined : clock.toggle,
        }}
        action={{ label: "Done", next: block.notePrompt || "notes", onPress: () => stop() }}
      >
        {hasRoute ? (
          <SprayWallViewer
            imageSource={wallImageSource}
            holds={holds}
            style={{ flex: 1 }}
            freeGesture
            naturalSize={wallSize}
          />
        ) : null}
      </ActiveScreen>
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

const sheet = paperSheet((C) => StyleSheet.create({
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
    color: C.onAccent,
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
    color: C.onAccent,
    letterSpacing: 0.3,
  },
}))
