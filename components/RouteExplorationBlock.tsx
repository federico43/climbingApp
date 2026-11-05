import { BlockNotes } from "@/components/BlockNotes"
import { ConsumeAuth } from "@/components/auth-context"
import type { Attempt } from "@/hooks/WorkoutHook"
import { getUsers } from "@/services/BoulderGraphService"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { useNextBlockLabel } from "@/utils/blockNav"
import { BoulderLevelOptions, colourLabel } from "@/utils/boulderColours"
import { FALL_REASONS } from "@/utils/progression/projectBouldering"
import {
  EXPLORATION_DEFAULT_DESCRIPTION, EXPLORATION_MAX_TRIES, EXPLORATION_PART_MIN, explorationGoes,
  explorationStartColour, nextExplorationColour, summarizeExploration, wallLabel, WALLS,
} from "@/utils/routeExploration"
import { C } from "@/utils/theme"
import * as Haptics from "expo-haptics"
import React, { useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

// Route exploration (utils/routeExploration.ts). Part 1 Flash: one tap per
// route — the go it went on, or not sent — on the colour shown, then "Tried
// them all" moves up a colour (all sent) or on to part 2. Part 2 Project:
// a timer on the routes that didn't go, then two questions. Routes live in
// the logged attempts, so a resumed workout picks up where it was.

type Phase = "intro" | "flash" | "projectIntro" | "project" | "question" | "done"

const RESULTS = [
  { label: "Flash", tries: 1, sent: true },
  { label: "2nd go", tries: 2, sent: true },
  { label: "3rd go", tries: 3, sent: true },
  { label: "Not sent", tries: EXPLORATION_MAX_TRIES, sent: false },
]

interface Props {
  block: any
  attempts: Attempt[]
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  undoLastAttempt?: () => void
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

function colourOf(value: string) {
  return BoulderLevelOptions.find((o) => o.value === value) ?? BoulderLevelOptions[1]
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, "0")}`
}

// Countdown from `minutes` while `running`; calls onEnd once at zero.
function useCountdown(minutes: number, running: boolean, onEnd: () => void) {
  const [left, setLeft] = useState(minutes * 60)
  const endRef = useRef<number | null>(null)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd
  useEffect(() => {
    if (!running) { endRef.current = null; return }
    endRef.current = Date.now() + minutes * 60 * 1000
    setLeft(minutes * 60)
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((endRef.current! - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) { clearInterval(id); onEndRef.current() }
    }, 250)
    return () => clearInterval(id)
  }, [running, minutes])
  return left
}

export function RouteExplorationBlock({ block, attempts, logAttempt, undoLastAttempt, goToNextBlock, goToPreviousBlock }: Props) {
  const nextLabel = useNextBlockLabel("Continue")
  const { User } = ConsumeAuth()
  const flashMin = block?.timeLimit || EXPLORATION_PART_MIN
  const projectMin = block?.projectTime || EXPLORATION_PART_MIN
  const title = block?.blockName || "Route exploration"

  const summary = summarizeExploration(attempts)
  const routes = summary.routes
  const answered = summary.solved !== null

  const [phase, setPhase] = useState<Phase>(answered ? "done" : routes.length > 0 ? "flash" : "intro")
  const [colour, setColour] = useState<string>(
    routes.length > 0 ? routes[routes.length - 1].colour : explorationStartColour(block?.startColour),
  )
  const [wall, setWall] = useState<string | null>(routes.length > 0 ? routes[routes.length - 1].wall : null)
  const [notice, setNotice] = useState<string | null>(null)

  // No colour authored: the athlete's flash level, blue at least.
  useEffect(() => {
    if (block?.startColour || routes.length > 0 || !User?.$id) return
    getUsers(User.$id)
      .then((u: any) => setColour(explorationStartColour(u?.flashLevel)))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flashLeft = useCountdown(flashMin, phase === "flash", () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
    setPhase("projectIntro")
  })
  const projectLeft = useCountdown(projectMin, phase === "project", () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
    setPhase("question")
  })

  // Part 2 answers.
  const [solved, setSolved] = useState<boolean | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [notes, setNotes] = useState("")

  function logRoute(r: (typeof RESULTS)[number]) {
    if (!wall) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    logAttempt({ success: r.sent, level: colour, wall, tries: r.tries, part: 1 })
    setNotice(null)
  }

  function triedAll() {
    const next = nextExplorationColour(colour, routes)
    if (next) {
      setColour(next)
      setNotice(`All ${colourLabel(colour).toLowerCase()} sent. Now ${colourLabel(next).toLowerCase()}.`)
    } else {
      setPhase("projectIntro")
    }
  }

  function save() {
    logAttempt({ success: !!solved, part: 2, fallReasons: reasons, notes: notes.trim() || undefined })
    setPhase("done")
  }

  const timerPill = (left: number) => (
    <View style={[s.timer, left <= 60 && s.timerUrgent]}>
      <Text style={[s.timerText, left <= 60 && { color: C.red }]}>{formatTime(left)}</Text>
    </View>
  )

  // ── Intro ──────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    const c = colourOf(colour)
    return (
      <View style={shared_styles.screen}>
        <TopBar title={title} onBack={goToPreviousBlock} />
        <ScrollView contentContainerStyle={shared_styles.introContent}>
          <BlockNotes text={block?.description?.trim() || EXPLORATION_DEFAULT_DESCRIPTION} title="Coach notes" />
          <View style={s.row}>
            <View style={[s.colourPill, { backgroundColor: c.color }]}>
              <Text style={[s.colourPillText, { color: c.on }]}>Start: {c.label}</Text>
            </View>
            <Text style={s.muted}>{flashMin} + {projectMin} min</Text>
          </View>
        </ScrollView>
        <View style={shared_styles.footer}>
          <Pressable style={s.primary} onPress={() => setPhase("flash")}>
            <Text style={s.primaryText}>Start part 1 · Flash</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Part 1: Flash ──────────────────────────────────────────────────────────
  if (phase === "flash") {
    const c = colourOf(colour)
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Part 1 · Flash" onBack={goToPreviousBlock} right={timerPill(flashLeft)} />
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.row}>
            <View style={[s.colourPill, { backgroundColor: c.color }]}>
              <Text style={[s.colourPillText, { color: c.on }]}>{c.label}</Text>
            </View>
            <Text style={s.muted}>{explorationGoes(routes)} goes · max {EXPLORATION_MAX_TRIES} per route</Text>
          </View>
          {notice && <Text style={s.notice}>{notice}</Text>}

          <Text style={s.label}>Wall</Text>
          <View style={s.chips}>
            {WALLS.map((w) => (
              <Pressable key={w.key} onPress={() => setWall(w.key)} style={[s.chip, wall === w.key && s.chipOn]}>
                <Text style={[s.chipText, wall === w.key && s.chipTextOn]}>{w.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.label}>{wall ? "Log the route" : "Pick the wall first"}</Text>
          <View style={s.results}>
            {RESULTS.map((r) => (
              <Pressable
                key={r.label}
                onPress={() => logRoute(r)}
                disabled={!wall}
                style={[s.result, r.sent ? s.resultSent : s.resultNot, !wall && { opacity: 0.35 }]}
              >
                <Text style={[s.resultText, r.sent && { color: C.bg }]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>

          {routes.length > 0 && (
            <View style={s.list}>
              {[...routes].reverse().map((r, i) => (
                <View key={routes.length - i} style={s.listRow}>
                  <View style={[s.bar, { backgroundColor: colourOf(r.colour).color }]} />
                  <Text style={s.listMain}>{colourLabel(r.colour)} · {wallLabel(r.wall)}</Text>
                  <Text style={[s.listSide, r.sent && { color: C.green }]}>
                    {r.sent ? RESULTS[r.tries - 1]?.label ?? "Sent" : "Not sent"}
                  </Text>
                  {i === 0 && undoLastAttempt && (
                    <Pressable onPress={undoLastAttempt} hitSlop={10}>
                      <Text style={s.undo}>✕</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
        <View style={shared_styles.footer}>
          <Pressable style={s.primary} onPress={triedAll}>
            <Text style={s.primaryText}>Tried all the {c.label.toLowerCase()}s</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  const notSent = routes.filter((r) => !r.sent)
  const notSentList = notSent.length > 0 ? (
    <View style={s.list}>
      {notSent.map((r, i) => (
        <View key={i} style={s.listRow}>
          <View style={[s.bar, { backgroundColor: colourOf(r.colour).color }]} />
          <Text style={s.listMain}>{colourLabel(r.colour)} · {wallLabel(r.wall)}</Text>
        </View>
      ))}
    </View>
  ) : <Text style={s.muted}>Every route went. Pick the hardest ones you tried and work them.</Text>

  // ── Part 2: Project ────────────────────────────────────────────────────────
  if (phase === "projectIntro" || phase === "project") {
    const running = phase === "project"
    return (
      <View style={shared_styles.screen}>
        <TopBar
          title="Part 2 · Project"
          right={running ? timerPill(projectLeft) : undefined}
        />
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.lead}>
            {running ? "Work the moves of these routes. Rest more between goes." : `Part 1 done: ${explorationGoes(routes)} goes, ${routes.length - notSent.length}/${routes.length} sent.`}
          </Text>
          <Text style={s.label}>Routes that didn&apos;t go</Text>
          {notSentList}
        </ScrollView>
        <View style={shared_styles.footer}>
          {running ? (
            <Pressable style={s.secondary} onPress={() => setPhase("question")}>
              <Text style={s.secondaryText}>Finish part 2</Text>
            </Pressable>
          ) : (
            <Pressable style={s.primary} onPress={() => setPhase("project")}>
              <Text style={s.primaryText}>Start part 2 · {projectMin} min</Text>
            </Pressable>
          )}
        </View>
      </View>
    )
  }

  // ── End-of-block questions ─────────────────────────────────────────────────
  if (phase === "question") {
    const toggle = (key: string) => setReasons((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Part 2 · Project" />
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={s.question}>Did you work something out?</Text>
          <View style={s.chips}>
            {[{ v: true, l: "Yes" }, { v: false, l: "No" }].map((o) => (
              <Pressable key={o.l} onPress={() => setSolved(o.v)} style={[s.chip, s.chipWide, solved === o.v && s.chipOn]}>
                <Text style={[s.chipText, solved === o.v && s.chipTextOn]}>{o.l}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.question}>What did you notice?</Text>
          <View style={s.chips}>
            {FALL_REASONS.map((r) => (
              <Pressable key={r.key} onPress={() => toggle(r.key)} style={[s.chip, reasons.includes(r.key) && s.chipOnRed]}>
                <Text style={[s.chipText, reasons.includes(r.key) && s.chipTextOn]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={s.input}
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else? (optional)"
            placeholderTextColor={C.textMuted}
            multiline
          />
        </ScrollView>
        <View style={shared_styles.footer}>
          <Pressable style={[s.primary, solved === null && { opacity: 0.35 }]} disabled={solved === null} onPress={save}>
            <Text style={s.primaryText}>Save</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  return (
    <View style={shared_styles.screen}>
      <TopBar title={title} onBack={goToPreviousBlock} />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.card}>
          <Text style={s.big}>{summary.goes}</Text>
          <Text style={s.muted}>goes in part 1</Text>
        </View>
        {summary.byColour.map((b) => (
          <View key={b.colour} style={s.listRow}>
            <View style={[s.bar, { backgroundColor: colourOf(b.colour).color }]} />
            <Text style={s.listMain}>{colourLabel(b.colour)}</Text>
            <Text style={s.listSide}>{b.sent}/{b.tried} sent</Text>
          </View>
        ))}
      </ScrollView>
      <View style={shared_styles.footer}>
        <Pressable style={s.primary} onPress={goToNextBlock}>
          <Text style={s.primaryText}>{nextLabel}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { fontSize: 12, fontWeight: "600", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4 },
  muted: { fontSize: 14, color: C.textSecondary },
  lead: { fontSize: 16, color: C.textPrimary, lineHeight: 22 },
  question: { fontSize: 18, fontWeight: "700", color: C.textPrimary, marginTop: 8 },
  notice: { fontSize: 15, fontWeight: "700", color: C.green },
  colourPill: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  colourPillText: { fontSize: 16, fontWeight: "800" },
  timer: { backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  timerUrgent: { backgroundColor: "rgba(219,80,74,0.15)" },
  timerText: { fontSize: 14, fontWeight: "700", color: C.textSecondary, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface },
  chipWide: { minWidth: 90, alignItems: "center" },
  chipOn: { backgroundColor: C.green, borderColor: C.green },
  chipOnRed: { backgroundColor: C.red, borderColor: C.red },
  chipText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  chipTextOn: { color: "#fff", fontWeight: "800" },
  results: { flexDirection: "row", gap: 8 },
  result: { flex: 1, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  resultSent: { backgroundColor: C.green },
  resultNot: { backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border },
  resultText: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  list: { gap: 8 },
  listRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  bar: { width: 4, height: 24, borderRadius: 2 },
  listMain: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  listSide: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  undo: { fontSize: 14, color: C.textMuted, fontWeight: "600", paddingLeft: 6 },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 20, alignItems: "center" },
  big: { fontSize: 56, fontWeight: "800", color: C.yellow },
  input: { minHeight: 80, backgroundColor: C.surface, borderRadius: 12, padding: 12, color: C.textPrimary, fontSize: 15, textAlignVertical: "top" },
  primary: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  primaryText: { color: C.bg, fontSize: 16, fontWeight: "700" },
  secondary: { borderRadius: 14, paddingVertical: 15, alignItems: "center", borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  secondaryText: { color: C.textPrimary, fontSize: 16, fontWeight: "700" },
})
