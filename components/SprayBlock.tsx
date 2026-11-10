import { BlockNotes } from "@/components/BlockNotes"
import CustomButton from "@/components/customButton"
import { ConsumeAuth } from "@/components/auth-context"
import { SprayWallBuilder } from "@/components/SprayWallBuilder"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import type { Attempt } from "@/hooks/WorkoutHook"
import {
  getSessions, getSprayRoutes, getSprayWalls, saveSprayRoute, type SessionRow, type SprayRouteRow, type SprayWallRow,
} from "@/services/BoulderGraphService"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { useNextBlockLabel } from "@/utils/blockNav"
import { useBlockTimer } from "@/utils/blockTimer"
import { resumedBlockStart } from "@/utils/progression/projectBouldering"
import { parseVariations, ROUTE_TYPE_LABEL, type RouteType, type RouteVariations } from "@/utils/sequenceVariations"
import {
  routeRecords, SPRAY_REST_OPTIONS_S, spraySettings, suggestSprayRoutes,
} from "@/utils/sprayBlocks"
import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import * as Haptics from "expo-haptics"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { AnimatedCircularProgress } from "react-native-circular-progress"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaView } from "react-native-safe-area-context"

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")

// The spray-wall blocks — Max bouldering, Base 1, Power boulders,
// Coordination boulders (utils/sprayBlocks.ts) — in Project bouldering's
// shape (coach 2026-11-10):
//   intro → choose a sequence → work (the wall, Top / Fell) ⇄ rest → … → end → review
// "time" blocks (Power, Coordination) end when the block's time runs out;
// "attempts" blocks (Max, Base 1) when the attempt target is reached. The
// athlete can change sequence at any time; each attempt is logged with its
// routeId, so every sequence keeps its own tops / attempts.

type Phase = "intro" | "choose" | "work" | "rest" | "end" | "review"

interface Props {
  block: {
    type: string; blockName?: string; description?: string
    timeLimit?: number; targetAttempts?: number; restTime?: number
    routeId?: string // a sequence the coach set on the block (listed first)
  }
  attempts: Attempt[] // this block's
  workoutAttempts: Attempt[] // the whole workout's (suggestions)
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  undoLastAttempt?: () => void
  restTimeRemaining: number | null
  startRestTimer: (duration: number) => void
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

function clock(secs: number): string {
  const v = Math.max(0, secs)
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`
}

// RN <Modal> content on Android sits outside the app's GestureHandlerRootView
// — the wall's pinch / pan need their own root there (same as SprayWallBuilder).
function ModalRoot({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "android") return <>{children}</>
  return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>
}

export function SprayBlock({
  block, attempts, workoutAttempts, logAttempt, undoLastAttempt, restTimeRemaining, startRestTimer, goToNextBlock, goToPreviousBlock,
}: Props) {
  const { User } = ConsumeAuth()
  const athleteId = User?.$id
  const nextLabel = useNextBlockLabel("Continue")
  const blockTimer = useBlockTimer()
  const settings = spraySettings(block)
  const routeType = settings.routeType as RouteType
  const title = block.blockName || "Spray wall"
  const isTime = settings.mode === "time"
  // A clock runs on time blocks, and on attempts blocks with a time limit.
  const timed = isTime || settings.timeCap != null
  const limitSecs = (isTime ? settings.minutes : settings.timeCap ?? 0) * 60

  // Resuming: clock rebuilt from the attempts, back on the last sequence.
  const [startedAt, setStartedAt] = useState<number | null>(() => resumedBlockStart(attempts.map((a) => a.timestamp)))
  const [now, setNow] = useState(Date.now())
  const secondsLeft = startedAt == null ? limitSecs : limitSecs - Math.floor((now - startedAt) / 1000)
  const [routeId, setRouteId] = useState<string | null>(() => [...attempts].reverse().find((a) => a.routeId)?.routeId ?? null)
  const [phase, setPhase] = useState<Phase>(() => (attempts.some((a) => a.routeId) ? "work" : "intro"))
  const [overtime, setOvertime] = useState(false) // "One more attempt" after the end
  const [restLength, setRestLength] = useState(settings.rest)

  // Routes (names, holds, types), walls, and the athlete's record per route.
  const [routes, setRoutes] = useState<Map<string, SprayRouteRow> | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [walls, setWalls] = useState<SprayWallRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    Promise.all([getSessions(), getSprayRoutes()])
      .then(([sessions, rows]) => {
        if (cancelled) return
        const visible = rows.filter((r) => !r.athleteId || r.athleteId === athleteId)
        setRoutes(new Map(visible.map((r) => [r.$id, r])))
        setSessions(sessions)
      })
      .catch((e) => { console.error(e); if (!cancelled) setRoutes(new Map()) })
    getSprayWalls().then((w) => { if (!cancelled) setWalls(w) }).catch(() => { if (!cancelled) setWalls([]) })
    return () => { cancelled = true }
  }, [athleteId])

  // Tick the block clock (time blocks).
  useEffect(() => {
    if (!timed || startedAt == null) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [timed, startedAt])

  // The end: time's up (time blocks) or the attempt target reached — asked
  // once the athlete is between attempts, never mid-rest.
  const timeUp = timed && startedAt != null && secondsLeft <= 0
  const reachedEnd = timeUp || (!isTime && attempts.filter((a) => a.routeId).length >= settings.attempts)
  useEffect(() => {
    if (phase === "work" && reachedEnd && !overtime) setPhase("end")
  }, [phase, reachedEnd, overtime])

  // End of rest → back to the wall.
  useEffect(() => {
    if (phase === "rest" && restTimeRemaining === 0) setPhase("work")
  }, [phase, restTimeRemaining])

  // Per sequence, in the order first climbed: tries and tops.
  const perRoute = useMemo(() => {
    const order: string[] = []
    const by = new Map<string, { tries: number; sends: number }>()
    for (const a of attempts) {
      if (!a.routeId) continue
      if (!by.has(a.routeId)) { order.push(a.routeId); by.set(a.routeId, { tries: 0, sends: 0 }) }
      const r = by.get(a.routeId)!
      r.tries++
      if (a.success) r.sends++
    }
    return order.map((id) => ({ id, ...by.get(id)! }))
  }, [attempts])
  const loggedTries = perRoute.reduce((n, r) => n + r.tries, 0)
  const loggedTops = perRoute.reduce((n, r) => n + r.sends, 0)
  const onRoute = perRoute.find((r) => r.id === routeId) ?? { tries: 0, sends: 0 }

  // Saved sessions + this workout so far, so a sequence added on the first
  // copy of the block is there on the second one.
  const records = useMemo(() => routeRecords(sessions, workoutAttempts), [sessions, workoutAttempts])
  const suggestions = useMemo(() => {
    if (!routes || !routeType) return []
    const info = new Map([...routes.values()].map((r) => [r.$id, { id: r.$id, type: r.type ?? undefined }]))
    return suggestSprayRoutes(records, info, routeType, routeId ? [routeId] : [], undefined, block.routeId || null)
  }, [routes, records, routeType, routeId, block.routeId])

  const route = routeId ? routes?.get(routeId) ?? null : null
  const wallFor = (r: SprayRouteRow | null | undefined) => (r?.wallId ? walls?.find((w) => w.$id === r.wallId) ?? null : null)
  const wallImage = (r: SprayRouteRow | null | undefined) => {
    const w = wallFor(r)
    return w?.imageUri ? { uri: w.imageUri } : WALL_IMAGE
  }
  const wallSize = (r: SprayRouteRow | null | undefined) => {
    const w = wallFor(r)
    return w?.width && w?.height ? { w: w.width, h: w.height } : null
  }

  function choose(id: string) {
    setRouteId(id)
    blockTimer.start()
    if (startedAt == null) { setStartedAt(Date.now()); setNow(Date.now()) }
    setPhase("work")
  }

  function record(success: boolean) {
    if (!routeId) return
    Haptics.impactAsync(success ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    logAttempt({ success, routeId, variation: "original" })
    // The last attempt (target reached, time's up, or the "one more" after
    // the end) goes straight to the end — no rest to sit through first.
    const endsNow = overtime || timeUp || (!isTime && loggedTries + 1 >= settings.attempts)
    if (endsNow) { setOvertime(false); setPhase("end"); return }
    startRestTimer(restLength)
    setPhase("rest")
  }

  // Leaving the rest early stops the workout's rest timer too, or its
  // "rest over" beep / notification would still go off mid-attempt.
  function stopRest() {
    startRestTimer(0)
    setPhase("work")
  }

  function setRest(secs: number) {
    setRestLength(secs)
    startRestTimer(secs)
  }

  function undo() {
    undoLastAttempt?.()
    stopRest()
  }

  function finish() {
    // Nothing logged still needs a marker, so the session shows it was done.
    if (attempts.length === 0) logAttempt({ success: true })
    setPhase("review")
  }

  // ── Adding a sequence (the spray-wall builder) ──
  const [choosingWall, setChoosingWall] = useState(false)
  const [building, setBuilding] = useState<{ wall: SprayWallRow | null } | null>(null)
  const [saving, setSaving] = useState(false)
  // iOS: wait for the builder to close before switching screens (onDismiss).
  const pendingChoose = useRef<string | null>(null)

  function add() {
    if (!walls) return
    if (walls.length <= 1) setBuilding({ wall: walls[0] ?? null })
    else setChoosingWall(true)
  }

  async function save(name: string, data: { variations: RouteVariations; level: number; type: string }) {
    if (!name.trim()) { Alert.alert("Name required", "Give the sequence a name before saving."); return }
    const holds = data.variations.original ?? []
    if (holds.length === 0) { Alert.alert("No holds", "Mark the sequence's holds first."); return }
    setSaving(true)
    try {
      const wall = building?.wall ?? null
      const created = await saveSprayRoute(name.trim(), holds, wall?.$id, {
        level: data.level, type: data.type, variations: { original: holds }, athleteId,
      })
      setRoutes((m) => new Map(m ?? []).set(created.$id, { ...created, type: data.type, level: data.level }))
      if (Platform.OS === "ios") { pendingChoose.current = created.$id; setBuilding(null) }
      else { setBuilding(null); choose(created.$id) }
    } catch (e) {
      console.error(e)
      Alert.alert("Error", "Could not save the sequence. Try again.")
    } finally {
      setSaving(false)
    }
  }

  // ── Preview of a suggested sequence ──
  const [preview, setPreview] = useState<string | null>(null)
  const pendingPreviewChoose = useRef<string | null>(null)
  const previewRow = preview ? routes?.get(preview) ?? null : null

  const timeChip = timed && startedAt != null && (
    <View style={[s.chip, secondsLeft <= 60 && s.chipUrgent]}>
      <Ionicons name="time-outline" size={16} color={secondsLeft <= 60 ? C.bg : C.green} />
      <Text style={[s.chipText, secondsLeft <= 60 && { color: C.bg }]}>{secondsLeft > 0 ? clock(secondsLeft) : "Time's up"}</Text>
    </View>
  )
  const attemptsChip = !isTime && (
    <View style={s.chip}>
      <Text style={s.chipText}>{Math.min(loggedTries, settings.attempts)} / {settings.attempts}</Text>
      <Text style={s.chipSub}>attempts</Text>
    </View>
  )

  const modals = (
    <>
      {/* Which wall — only when there's more than one */}
      <Modal visible={choosingWall} transparent animationType="fade" onRequestClose={() => setChoosingWall(false)}>
        <Pressable style={s.backdrop} onPress={() => setChoosingWall(false)}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <Text style={s.sheetTitle}>Which wall?</Text>
            {(walls ?? []).map((w) => (
              <Pressable key={w.$id} style={s.wallRow} onPress={() => { setChoosingWall(false); setBuilding({ wall: w }) }}>
                <Text style={s.wallName}>{w.name}</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* The builder: Original only, this block's route type */}
      <Modal
        visible={building !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setBuilding(null)}
        onDismiss={() => {
          const id = pendingChoose.current
          pendingChoose.current = null
          if (id) choose(id)
        }}
      >
        {building && (
          <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
            <SprayWallBuilder
              imageSource={building.wall?.imageUri ? { uri: building.wall.imageUri } : WALL_IMAGE}
              initialType={routeType ?? "base"}
              originalOnly
              saving={saving}
              onBack={() => setBuilding(null)}
              onSave={save}
            />
          </SafeAreaView>
        )}
      </Modal>

      {/* Preview of a suggested sequence: Choose or Back */}
      <Modal
        visible={!!previewRow}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPreview(null)}
        onDismiss={() => {
          const id = pendingPreviewChoose.current
          pendingPreviewChoose.current = null
          if (id) choose(id)
        }}
      >
        {previewRow && (
          <ModalRoot>
            <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
              <View style={s.previewTop}>
                <Pressable onPress={() => setPreview(null)} hitSlop={10}>
                  <Ionicons name="chevron-back" size={24} color={C.textPrimary} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={s.routeName} numberOfLines={1}>{previewRow.name}</Text>
                  {previewRow.level != null && <Text style={s.meta}>Level {previewRow.level}</Text>}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <SprayWallViewer
                  imageSource={wallImage(previewRow)}
                  holds={parseVariations(previewRow).original}
                  style={{ flex: 1 }}
                  freeGesture
                  naturalSize={wallSize(previewRow)}
                />
              </View>
              <View style={s.previewActions}>
                <Pressable style={[s.previewBtn, s.previewBtnGhost]} onPress={() => setPreview(null)}>
                  <Text style={s.previewBtnGhostText}>Back</Text>
                </Pressable>
                <Pressable
                  style={s.previewBtn}
                  onPress={() => {
                    const id = previewRow.$id
                    setPreview(null)
                    if (Platform.OS === "ios") pendingPreviewChoose.current = id
                    else choose(id)
                  }}
                >
                  <Text style={s.previewBtnText}>Choose this one</Text>
                </Pressable>
              </View>
            </SafeAreaView>
          </ModalRoot>
        )}
      </Modal>
    </>
  )

  // ── 1. Intro ──────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={title} onBack={goToPreviousBlock} />
        <ScrollView contentContainerStyle={shared_styles.introContent}>
          <View style={s.pills}>
            <View style={s.pill}><Text style={s.pillText}>{ROUTE_TYPE_LABEL[routeType] ?? "Spray wall"}</Text></View>
            <View style={s.pill}>
              <Text style={s.pillText}>{isTime ? `⏱ ${settings.minutes} min` : `${settings.attempts} attempts`}</Text>
            </View>
            {settings.timeCap != null && <View style={s.pill}><Text style={s.pillText}>⏱ {settings.timeCap} min</Text></View>}
            <View style={s.pill}><Text style={s.pillText}>{clock(settings.rest)} rest</Text></View>
          </View>
          <BlockNotes text={block.description} />
          <Text style={s.hint}>
            {isTime
              ? "Choose a sequence and climb it until the time runs out. Tap Top or Fell after every attempt — rest starts on its own."
              : `Choose a sequence and give it ${settings.attempts} attempts${settings.timeCap != null ? ` in ${settings.timeCap} minutes` : ""}. Tap Top or Fell after every attempt — rest starts on its own.`}
          </Text>
        </ScrollView>
        <View style={shared_styles.footer}>
          <CustomButton title="Choose sequence" onPress={() => setPhase("choose")} />
        </View>
      </View>
    )
  }

  // ── 2. Choose a sequence ────────────────────────────────────────────────────────

  if (phase === "choose") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={title} onBack={() => setPhase(routeId ? "work" : "intro")} />
        <ScrollView contentContainerStyle={s.chooseContent}>
          <Pressable style={[s.addBtn, !walls && { opacity: 0.5 }]} onPress={add} disabled={!walls}>
            {walls ? <Text style={s.addBtnText}>+ Add a new sequence</Text> : <ActivityIndicator color={C.green} />}
          </Pressable>
          <Text style={s.sectionLabel}>Suggested</Text>
          {!routes && <ActivityIndicator color={C.green} />}
          {routes && suggestions.length === 0 && (
            <Text style={s.empty}>
              {`The ${(ROUTE_TYPE_LABEL[routeType] ?? "").toLowerCase()} sequences you climb show up here — the ones you’ve topped least first.`}
            </Text>
          )}
          {suggestions.map((r) => {
            const row = routes?.get(r.routeId)
            const fromCoach = !!block.routeId && r.routeId === block.routeId
            return (
              <Pressable key={r.routeId} style={s.row} onPress={() => setPreview(r.routeId)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName} numberOfLines={1}>{row?.name ?? "Sequence"}</Text>
                  {(fromCoach || row?.level != null) && (
                    <Text style={s.meta}>{[fromCoach && "Set by your coach", row?.level != null && `Level ${row.level}`].filter(Boolean).join(" · ")}</Text>
                  )}
                </View>
                <Text style={s.rowRecord}>{r.sends} top{r.sends !== 1 ? "s" : ""} · {r.tries} tr{r.tries !== 1 ? "ies" : "y"}</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </Pressable>
            )
          })}
        </ScrollView>
        {modals}
      </View>
    )
  }

  // ── 3. Work: the wall, Top / Fell ───────────────────────────────────────────────

  if (phase === "work") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={title} onBack={loggedTries === 0 ? () => setPhase("choose") : undefined} />
        <View style={s.workHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.routeName} numberOfLines={1}>{route?.name ?? "Sequence"}</Text>
            <Text style={s.meta}>
              {onRoute.sends} top{onRoute.sends !== 1 ? "s" : ""} · {onRoute.tries} attempt{onRoute.tries !== 1 ? "s" : ""}
            </Text>
          </View>
          {timeChip}
          {attemptsChip}
        </View>
        <View style={s.wall}>
          {route ? (
            <SprayWallViewer
              imageSource={wallImage(route)}
              holds={parseVariations(route).original}
              style={{ flex: 1 }}
              freeGesture
              naturalSize={wallSize(route)}
            />
          ) : <ActivityIndicator color={C.green} style={{ flex: 1 }} />}
        </View>
        <View style={s.actions}>
          <Pressable style={({ pressed }) => [s.bigBtn, s.fellBtn, pressed && s.pressed]} onPress={() => record(false)}>
            <Text style={s.fellText}>Fell</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [s.bigBtn, s.topBtn, pressed && s.pressed]} onPress={() => record(true)}>
            <Text style={s.topText}>Top</Text>
          </Pressable>
        </View>
        <View style={s.footerRow}>
          <Pressable onPress={() => setPhase("choose")} hitSlop={8}>
            <Text style={s.link}>Change sequence</Text>
          </Pressable>
          <Pressable onPress={finish} hitSlop={8}>
            <Text style={s.link}>Finish block</Text>
          </Pressable>
        </View>
        {modals}
      </View>
    )
  }

  // ── 4. Rest ─────────────────────────────────────────────────────────────────────

  if (phase === "rest") {
    const t = restTimeRemaining ?? 0
    const fill = restLength ? (t / restLength) * 100 : 0
    const last = attempts[attempts.length - 1]
    return (
      <View style={shared_styles.screen}>
        <View style={s.restHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.restTitle}>{last?.success ? "Top! 🎉" : "Fell"}</Text>
            <Text style={s.meta}>Rest · {route?.name ?? "Sequence"}</Text>
          </View>
          <AnimatedCircularProgress
            size={92} width={6} fill={fill} rotation={0}
            tintColor={t <= 15 ? C.red : C.green} backgroundColor={C.surface}
          >
            {() => <Text style={s.restTimer}>{t > 0 ? clock(t) : "go!"}</Text>}
          </AnimatedCircularProgress>
        </View>
        <View style={s.restOptions}>
          {SPRAY_REST_OPTIONS_S.map((secs) => (
            <Pressable key={secs} style={[s.restChip, restLength === secs && s.restChipOn]} onPress={() => setRest(secs)}>
              <Text style={[s.restChipText, restLength === secs && { color: C.bg }]}>{secs / 60} min</Text>
            </Pressable>
          ))}
        </View>
        <View style={s.wall}>
          {route && (
            <SprayWallViewer
              imageSource={wallImage(route)}
              holds={parseVariations(route).original}
              style={{ flex: 1 }}
              freeGesture
              naturalSize={wallSize(route)}
            />
          )}
        </View>
        <View style={s.footerRow}>
          <Pressable onPress={undo} hitSlop={8}>
            <Text style={s.link}>Undo attempt</Text>
          </Pressable>
          <Pressable style={s.skipBtn} onPress={stopRest}>
            <Text style={s.skipText}>Skip rest</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 5. End: time's up / attempts done ───────────────────────────────────────────

  if (phase === "end") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={title} />
        <View style={[shared_styles.container, { justifyContent: "center", gap: 14 }]}>
          <Ionicons name={timeUp ? "alarm-outline" : "checkmark-circle-outline"} size={56} color={timeUp ? C.red : C.green} />
          <Text style={s.heading}>{timeUp ? "Time's up" : "Attempts done"}</Text>
          <Text style={s.hint}>{loggedTops} top{loggedTops !== 1 ? "s" : ""} in {loggedTries} attempt{loggedTries !== 1 ? "s" : ""}.</Text>
          <View style={{ width: "100%", gap: 12, marginTop: 12 }}>
            <CustomButton title="Finish block" onPress={finish} />
            <Pressable onPress={() => { setOvertime(true); setPhase("work") }} style={{ alignItems: "center" }} hitSlop={8}>
              <Text style={s.link}>One more attempt</Text>
            </Pressable>
            {loggedTries > 0 && (
              // The last attempt skips the rest screen, so its Undo lives here.
              <Pressable onPress={() => { undoLastAttempt?.(); setOvertime(true); setPhase("work") }} style={{ alignItems: "center" }} hitSlop={8}>
                <Text style={s.link}>Undo last attempt</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    )
  }

  // ── 6. Review ───────────────────────────────────────────────────────────────────

  return (
    <View style={shared_styles.screen}>
      <TopBar title="Review" onBack={reachedEnd ? undefined : () => setPhase(routeId ? "work" : "intro")} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={s.sectionLabel}>{title}</Text>
        {perRoute.length === 0 && <Text style={s.empty}>No sequences logged.</Text>}
        {perRoute.map((r) => (
          <View key={r.id} style={s.row}>
            <Text style={[s.rowName, { flex: 1 }]} numberOfLines={1}>{routes?.get(r.id)?.name ?? "Sequence"}</Text>
            <Text style={s.rowTops}>{r.sends}/{r.tries} tops</Text>
          </View>
        ))}
        <View style={{ marginTop: 8 }}>
          <CustomButton title={nextLabel} onPress={goToNextBlock} />
        </View>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: "800", color: C.textPrimary },
  hint: { fontSize: 14, color: C.textSecondary, lineHeight: 20, textAlign: "center" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  pillText: { fontSize: 14, fontWeight: "700", color: C.textPrimary },

  chooseContent: { padding: 20, gap: 10 },
  addBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: "center",
    borderWidth: 1, borderColor: C.green, borderStyle: "dashed", marginBottom: 10,
  },
  addBtnText: { fontSize: 16, fontWeight: "800", color: C.green },
  sectionLabel: { fontSize: 12, fontWeight: "800", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8 },
  empty: { fontSize: 14, color: C.textMuted, lineHeight: 20 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 14, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  rowName: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  rowRecord: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  rowTops: { fontSize: 14, fontWeight: "800", color: C.green },
  meta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  workHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
  routeName: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  chipUrgent: { backgroundColor: C.red },
  chipText: { fontSize: 18, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  chipSub: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  wall: { flex: 1, marginHorizontal: 12, borderRadius: 14, overflow: "hidden", backgroundColor: "#000" },
  actions: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingTop: 14 },
  bigBtn: { flex: 1, height: 84, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  topBtn: { backgroundColor: C.green },
  fellBtn: { backgroundColor: C.surface, borderWidth: 2, borderColor: C.border },
  pressed: { transform: [{ scale: 0.97 }] },
  topText: { fontSize: 26, fontWeight: "900", color: C.bg },
  fellText: { fontSize: 26, fontWeight: "900", color: C.textPrimary },
  footerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingTop: 14, paddingBottom: 36,
  },
  link: { fontSize: 15, fontWeight: "700", color: C.textSecondary },

  restHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, gap: 12 },
  restTitle: { fontSize: 28, fontWeight: "800", color: C.textPrimary },
  restTimer: { fontSize: 20, fontWeight: "800", color: C.textPrimary, fontVariant: ["tabular-nums"] },
  restOptions: { flexDirection: "row", gap: 8, paddingHorizontal: 24, paddingBottom: 12 },
  restChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  restChipOn: { backgroundColor: C.green, borderColor: C.green },
  restChipText: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  skipBtn: { backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  skipText: { fontSize: 15, fontWeight: "800", color: C.textPrimary },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: C.surface, borderRadius: 18, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  wallRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border },
  wallName: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  previewTop: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  previewActions: { flexDirection: "row", gap: 12, padding: 16 },
  previewBtn: { flex: 1, backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  previewBtnText: { fontSize: 15, fontWeight: "800", color: C.bg },
  previewBtnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border },
  previewBtnGhostText: { fontSize: 15, fontWeight: "800", color: C.textPrimary },
})
