import { C } from "@/utils/theme"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import React, { useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Block {
  type: "free_session"
  blockName: string
  description?: string
  timeLimit?: number   // minutes; when set, show a countdown instead of elapsed
}

interface Props {
  block: Block
  goToNextBlock?: () => void
  goToPreviousBlock?: () => void
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

export function FreeSessionBlock({ block, goToNextBlock, goToPreviousBlock }: Props) {
  const [phase, setPhase] = useState<Phase>("intro")
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
        <View style={styles.centerContent}>
          <Text style={styles.timerLabel}>{hasLimit ? (over ? "time's up" : "remaining") : "elapsed"}</Text>
          <Text style={[styles.timer, over && { color: C.red }]}>
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
      <View style={styles.centerContent}>
        <Text style={styles.doneCheck}>✓</Text>
        <Text style={styles.doneTitle}>Session complete</Text>
        <Text style={styles.doneTime}>{formatElapsed(elapsed)}</Text>
        <Pressable style={styles.nextBtn} onPress={() => goToNextBlock?.()}>
          <Text style={styles.nextBtnText}>Next block</Text>
        </Pressable>
      </View>
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
