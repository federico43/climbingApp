import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { SprayWallBuilder } from "@/components/SprayWallBuilder"
import type { Attempt } from "@/hooks/WorkoutHook"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import {
  getSessions, getSprayRoute, getSprayRoutes, getSprayWalls, saveSprayRoute, type SprayRouteRow, type SprayWallRow,
} from "@/services/BoulderGraphService"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { parseVariations, ROUTE_TYPE_LABEL, type RouteVariations } from "@/utils/sequenceVariations"
import { routeRecords, suggestSprayRoutes, type RouteRecord } from "@/utils/sprayBlocks"
import { Ionicons } from "@expo/vector-icons"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaView } from "react-native-safe-area-context"
import { useNextBlockLabel } from "@/utils/blockNav"
import { useBlockTimer } from "@/utils/blockTimer"

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")

// A block the coach runs in person (docs/training-plan-implementation.md
// §12b) — shown in the free-session screen's style: the block's title and
// Done, nothing logged but a { coached: true } marker. A coached sequence
// block (Max bouldering, Base 1 …) also lets the athlete save the sequences
// the coach made up — Original only, the level they're given — with the
// attempts and sends on each, which count for progression
// (utils/blockHistory.ts).

interface Props {
  block: { type: string; blockName?: string; routeId?: string; targetAttempts?: number }
  attempts: Attempt[] // this block's
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

export function CoachedBlock({ block, attempts, logAttempt, goToNextBlock, goToPreviousBlock }: Props) {
  const nextLabel = useNextBlockLabel("Done")
  const isSequence = block.type === "sequence"

  function done() {
    // A coached block with nothing else logged still needs a marker, so the
    // session shows it was done.
    if (attempts.length === 0) logAttempt({ success: true, coached: true })
    goToNextBlock()
  }

  return (
    <View style={shared_styles.screen}>
      <TopBar title={block.blockName || "Block"} onBack={goToPreviousBlock} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.badge}>
          <Ionicons name="person" size={14} color={C.green} />
          <Text style={s.badgeText}>Coached</Text>
        </View>
        <Text style={s.title}>{block.blockName || "Block"}</Text>
        {isSequence && <CoachSequences block={block} attempts={attempts} logAttempt={logAttempt} />}
        <Pressable style={s.doneBtn} onPress={done}>
          <Text style={s.doneBtnText}>{nextLabel}</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

// ─── Spray blocks ────────────────────────────────────────────────────────────

// Max bouldering, Base 1, Power boulders and Coordination boulders
// (utils/sprayBlocks.ts): the athlete adds the sequences they make up, or
// picks one of the suggested ones (sequences of this type they've logged,
// fewest sends first), and logs attempts and sends on each. Never coached.
export function SprayBlock({ block, routeType, attempts, logAttempt, goToNextBlock, goToPreviousBlock }: Props & {
  block: Props["block"] & { description?: string; timeLimit?: number }
  routeType: string
}) {
  const nextLabel = useNextBlockLabel("Done")

  function done() {
    // Nothing logged still needs a marker, so the session shows it was done.
    if (attempts.length === 0) logAttempt({ success: true })
    goToNextBlock()
  }

  return (
    <View style={shared_styles.screen}>
      <TopBar title={block.blockName || "Block"} onBack={goToPreviousBlock} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.badge}>
          <Ionicons name="grid-outline" size={14} color={C.green} />
          <Text style={s.badgeText}>Spray wall · {ROUTE_TYPE_LABEL[routeType] ?? routeType}</Text>
        </View>
        <Text style={s.title}>{block.blockName || "Block"}</Text>
        {(block.timeLimit ?? 0) > 0 && <SprayTimer minutes={block.timeLimit!} />}
        {!!block.description?.trim() && <Text style={s.description}>{block.description.trim()}</Text>}
        <CoachSequences
          block={block}
          attempts={attempts}
          logAttempt={logAttempt}
          routeType={routeType}
          suggest
          heading="Your sequences"
          emptyText="Make up a sequence and add it, or choose one of the suggested ones. Log how it went on each — it counts toward your level."
        />
        <Pressable style={s.doneBtn} onPress={done}>
          <Text style={s.doneBtnText}>{nextLabel}</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

// The block's time limit as a countdown the athlete starts. Red "Time's up"
// at zero; it never moves on by itself. Also arms the workout's own block
// timer (utils/blockTimer.ts), so the block's time counts from Start.
function SprayTimer({ minutes }: { minutes: number }) {
  const blockTimer = useBlockTimer()
  const total = Math.max(0, Math.round(minutes * 60))
  const [endAt, setEndAt] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(total)
  useEffect(() => {
    if (endAt === null) return
    const tick = () => {
      const r = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
      setRemaining(r)
      return r
    }
    tick()
    const id = setInterval(() => { if (tick() <= 0) clearInterval(id) }, 250)
    return () => clearInterval(id)
  }, [endAt])
  const over = endAt !== null && remaining <= 0
  const m = Math.floor(remaining / 60)
  const sec = remaining % 60
  return (
    <View style={[s.timerBox, over && s.timerBoxOver]}>
      <Ionicons name="time-outline" size={20} color={over ? C.bg : C.green} />
      <Text style={[s.timerText, over && { color: C.bg }]}>
        {over ? "Time's up" : `${m}:${String(sec).padStart(2, "0")}`}
      </Text>
      {endAt === null && (
        <Pressable style={s.timerBtn} onPress={() => { blockTimer.start(); setEndAt(Date.now() + total * 1000) }} hitSlop={6}>
          <Text style={s.timerBtnText}>Start</Text>
        </Pressable>
      )}
    </View>
  )
}

// ─── The coach's sequences ───────────────────────────────────────────────────

// "Max bouldering" / "Base" — the route type the block's sequences are.
function routeTypeFor(blockName: string | undefined, assignedType: string | undefined): string {
  if (assignedType) return assignedType
  return /max/i.test(blockName ?? "") ? "max_bouldering" : "base"
}

interface SequencesProps extends Omit<Props, "goToNextBlock" | "goToPreviousBlock"> {
  // Spray blocks (utils/sprayBlocks.ts): the route type their sequences are,
  // and the suggested sequences listed under "Add sequence".
  routeType?: string
  suggest?: boolean
  heading?: string
  emptyText?: string
}

export function CoachSequences({ block, attempts, logAttempt, routeType, suggest, heading, emptyText }: SequencesProps) {
  const { User } = ConsumeAuth()
  const athleteId = User?.$id
  // The sequences logged so far, in order, with their sends / attempts.
  const logged = useMemo(() => {
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

  // Sequences picked (from the suggestions, or saved without a result) that
  // have nothing logged yet — listed with "Log result".
  const [picked, setPicked] = useState<string[]>([])
  const pending = picked.filter((id) => !logged.some((r) => r.id === id))
  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p : [...p, id]))

  // Spray blocks: the routes (for the suggestions and the preview) and the
  // athlete's record on each.
  const [routeRows, setRouteRows] = useState<Map<string, SprayRouteRow> | null>(null)
  const [records, setRecords] = useState<Map<string, RouteRecord>>(new Map())
  useEffect(() => {
    if (!suggest) return
    let cancelled = false
    Promise.all([getSessions(), getSprayRoutes()])
      .then(([sessions, rows]) => {
        if (cancelled) return
        const visible = rows.filter((r) => !r.athleteId || r.athleteId === athleteId)
        setRouteRows(new Map(visible.map((r) => [r.$id, r])))
        setRecords(routeRecords(sessions))
      })
      .catch((e) => { console.error(e); if (!cancelled) setRouteRows(new Map()) })
    return () => { cancelled = true }
  }, [suggest, athleteId])

  const suggestions = useMemo(() => {
    if (!suggest || !routeType || !routeRows) return []
    const routes = new Map([...routeRows.values()].map((r) => [r.$id, { id: r.$id, type: r.type ?? undefined }]))
    return suggestSprayRoutes(records, routes, routeType as any, [...logged.map((r) => r.id), ...picked])
  }, [suggest, routeType, routeRows, records, logged, picked])

  // The preview of one sequence: a suggestion (Choose) or one of this block's (Log result).
  const [preview, setPreview] = useState<{ id: string; mode: "suggestion" | "mine" } | null>(null)
  const pendingLog = useRef<string | null>(null)

  // Names and levels: the ones saved here, else fetched (on resume).
  const [info, setInfo] = useState<Record<string, { name: string; level?: number }>>({})
  useEffect(() => {
    for (const id of [...logged.map((r) => r.id), ...pending]) {
      if (info[id]) continue
      const row = routeRows?.get(id)
      if (row) { setInfo((p) => ({ ...p, [id]: { name: row.name, level: row.level ?? undefined } })); continue }
      getSprayRoute(id)
        .then((r) => setInfo((p) => ({ ...p, [id]: { name: r.name, level: r.level ?? undefined } })))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- info is only a cache check; depending on it would refetch routes still in flight
  }, [logged, picked, routeRows])

  // The type the coach's sequences get: the assigned route's, else the block's name.
  const [assignedType, setAssignedType] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!block.routeId) return
    getSprayRoute(block.routeId).then((r) => setAssignedType(r.type ?? undefined)).catch(() => {})
  }, [block.routeId])

  const [walls, setWalls] = useState<SprayWallRow[] | null>(null)
  useEffect(() => { getSprayWalls().then(setWalls).catch(() => setWalls([])) }, [])
  const [choosingWall, setChoosingWall] = useState(false)
  const [building, setBuilding] = useState<{ wall: SprayWallRow | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ id: string; name: string; level: number } | null>(null)
  // iOS: opening the result sheet while the builder modal is still closing
  // drops it — wait for the builder's onDismiss (same race as SequenceBlock).
  const pendingResult = useRef<{ id: string; name: string; level: number } | null>(null)

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
        level: data.level, type: data.type, variations: { original: holds }, athleteId: User?.$id,
      })
      const next = { id: created.$id, name: created.name, level: data.level }
      setInfo((p) => ({ ...p, [created.$id]: { name: created.name, level: data.level } }))
      setRouteRows((m) => (m ? new Map(m).set(created.$id, created) : m))
      if (Platform.OS === "ios") { pendingResult.current = next; setBuilding(null) }
      else { setBuilding(null); setResult(next) }
    } catch (e) {
      console.error(e)
      Alert.alert("Error", "Could not save the sequence. Try again.")
    } finally {
      setSaving(false)
    }
  }

  function logResult(tries: number, sends: number) {
    if (!result) return
    for (let i = 0; i < tries; i++) {
      // Spray blocks aren't coached: the athlete runs them on their own.
      logAttempt({ success: i < sends, routeId: result.id, variation: "original", ...(suggest ? {} : { coached: true }) })
    }
    setResult(null)
  }

  // Closing the result sheet without logging keeps the sequence on the list.
  function closeResult() {
    if (result && suggest) pick(result.id)
    setResult(null)
  }

  function openResult(id: string) {
    setResult({ id, name: info[id]?.name ?? routeRows?.get(id)?.name ?? "Sequence", level: info[id]?.level ?? 0 })
  }

  const previewRow = preview ? routeRows?.get(preview.id) ?? null : null
  const previewWall = previewRow?.wallId ? walls?.find((w) => w.$id === previewRow.wallId) ?? null : null

  return (
    <View style={s.seqBox}>
      <Text style={s.seqHeading}>{heading ?? "Your coach's sequences"}</Text>
      {logged.length === 0 && pending.length === 0 && (
        <Text style={s.seqEmpty}>
          {emptyText ?? "Save each sequence your coach sets, with how it went — it counts toward your level."}
        </Text>
      )}
      {logged.map((r, i) => (
        <Pressable
          key={r.id}
          style={s.seqRow}
          disabled={!suggest || !routeRows?.has(r.id)}
          onPress={() => setPreview({ id: r.id, mode: "mine" })}
        >
          <Text style={s.seqNum}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.seqName} numberOfLines={1}>{info[r.id]?.name ?? "Sequence"}</Text>
            {info[r.id]?.level != null && <Text style={s.seqMeta}>Level {info[r.id]!.level}</Text>}
          </View>
          <Text style={s.seqSends}>{r.sends}/{r.tries} sent</Text>
        </Pressable>
      ))}
      {pending.map((id, i) => (
        <Pressable key={id} style={s.seqRow} onPress={() => setPreview({ id, mode: "mine" })}>
          <Text style={s.seqNum}>{logged.length + i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.seqName} numberOfLines={1}>{info[id]?.name ?? "Sequence"}</Text>
            {info[id]?.level != null && <Text style={s.seqMeta}>Level {info[id]!.level}</Text>}
          </View>
          <Pressable style={s.logPill} onPress={() => openResult(id)} hitSlop={6}>
            <Text style={s.logPillText}>Log result</Text>
          </Pressable>
        </Pressable>
      ))}
      <Pressable style={[s.addBtn, !walls && { opacity: 0.5 }]} onPress={add} disabled={!walls}>
        {walls ? <Text style={s.addBtnText}>+ Add sequence</Text> : <ActivityIndicator color={C.green} />}
      </Pressable>

      {suggest && (
        <View style={s.sugBox}>
          <Text style={s.seqHeading}>Suggested sequences</Text>
          {!routeRows && <ActivityIndicator color={C.green} />}
          {routeRows && suggestions.length === 0 && (
            <Text style={s.seqEmpty}>{"Sequences of this type you log show up here — the ones you’ve sent least first."}</Text>
          )}
          {suggestions.map((r) => {
            const row = routeRows?.get(r.routeId)
            return (
              <Pressable key={r.routeId} style={s.seqRow} onPress={() => setPreview({ id: r.routeId, mode: "suggestion" })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.seqName} numberOfLines={1}>{row?.name ?? "Sequence"}</Text>
                  {row?.level != null && <Text style={s.seqMeta}>Level {row.level}</Text>}
                </View>
                <Text style={s.sugRecord}>{r.sends}/{r.tries} sent before</Text>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </Pressable>
            )
          })}
        </View>
      )}

      {/* Preview of a sequence on its wall */}
      <Modal
        visible={preview !== null && !!previewRow}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPreview(null)}
        onDismiss={() => {
          const id = pendingLog.current
          pendingLog.current = null
          if (id) openResult(id)
        }}
      >
        {preview && previewRow && (
          <PreviewRoot>
            <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "bottom"]}>
              <View style={s.previewTop}>
                <Pressable onPress={() => setPreview(null)} hitSlop={10}>
                  <Ionicons name="chevron-back" size={24} color={C.textPrimary} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={s.previewName} numberOfLines={1}>{previewRow.name}</Text>
                  {previewRow.level != null && <Text style={s.seqMeta}>Level {previewRow.level}</Text>}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <SprayWallViewer
                  imageSource={previewWall?.imageUri ? { uri: previewWall.imageUri } : WALL_IMAGE}
                  holds={parseVariations(previewRow).original}
                  style={{ flex: 1 }}
                  freeGesture
                  naturalSize={previewWall?.width && previewWall?.height ? { w: previewWall.width, h: previewWall.height } : null}
                />
              </View>
              <View style={s.previewActions}>
                <Pressable style={[s.previewBtn, s.previewBtnGhost]} onPress={() => setPreview(null)}>
                  <Text style={s.previewBtnGhostText}>Back</Text>
                </Pressable>
                <Pressable
                  style={s.previewBtn}
                  onPress={() => {
                    const id = preview.id
                    setPreview(null)
                    if (preview.mode === "suggestion") pick(id)
                    else if (Platform.OS === "ios") pendingLog.current = id // after the preview has closed (onDismiss)
                    else openResult(id)
                  }}
                >
                  <Text style={s.previewBtnText}>{preview.mode === "suggestion" ? "Choose this one" : "Log result"}</Text>
                </Pressable>
              </View>
            </SafeAreaView>
          </PreviewRoot>
        )}
      </Modal>

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

      {/* The route builder: Original only, type from the block */}
      <Modal
        visible={building !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setBuilding(null)}
        onDismiss={() => {
          const next = pendingResult.current
          pendingResult.current = null
          if (next) setResult(next)
        }}
      >
        {building && (
          <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
            <SprayWallBuilder
              imageSource={building.wall?.imageUri ? { uri: building.wall.imageUri } : WALL_IMAGE}
              initialType={routeType ?? routeTypeFor(block.blockName, assignedType)}
              originalOnly
              saving={saving}
              onBack={() => setBuilding(null)}
              onSave={save}
            />
          </SafeAreaView>
        )}
      </Modal>

      {result && (
        <ResultSheet
          name={result.name}
          defaultTries={block.targetAttempts ?? 5}
          onSave={logResult}
          onClose={closeResult}
        />
      )}
    </View>
  )
}

// The preview modal on Android is its own native window, outside the app's
// GestureHandlerRootView — the wall's pinch / pan need their own root there
// (same as SprayWallBuilder).
function PreviewRoot({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "android") return <>{children}</>
  return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>
}

// How it went on one sequence: attempts and sends.
function ResultSheet({ name, defaultTries, onSave, onClose }: {
  name: string; defaultTries: number; onSave: (tries: number, sends: number) => void; onClose: () => void
}) {
  const [tries, setTries] = useState(Math.max(1, defaultTries))
  const [sends, setSends] = useState(0)
  const setT = (n: number) => { const t = Math.max(1, Math.min(50, n)); setTries(t); setSends((x) => Math.min(x, t)) }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <Text style={s.sheetTitle}>How did it go?</Text>
          <Text style={s.sheetSub} numberOfLines={1}>{name}</Text>
          <Stepper label="Attempts" value={tries} onChange={setT} min={1} max={50} />
          <Stepper label="Sends" value={sends} onChange={(n) => setSends(Math.max(0, Math.min(tries, n)))} min={0} max={tries} />
          <Pressable style={s.saveBtn} onPress={() => onSave(tries, sends)}>
            <Text style={s.saveBtnText}>Save</Text>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8}><Text style={s.cancelText}>{"Don't log a result"}</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function Stepper({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (n: number) => void; min: number; max: number
}) {
  return (
    <View style={s.stepRow}>
      <Text style={s.stepLabel}>{label}</Text>
      <Pressable style={[s.stepBtn, value <= min && { opacity: 0.3 }]} disabled={value <= min} onPress={() => onChange(value - 1)} hitSlop={6}>
        <Text style={s.stepBtnText}>−</Text>
      </Pressable>
      <Text style={s.stepValue}>{value}</Text>
      <Pressable style={[s.stepBtn, value >= max && { opacity: 0.3 }]} disabled={value >= max} onPress={() => onChange(value + 1)} hitSlop={6}>
        <Text style={s.stepBtnText}>+</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  content: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 24, gap: 16 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: `${C.green}22`,
  },
  badgeText: { fontSize: 12, fontWeight: "800", color: C.green, letterSpacing: 0.5, textTransform: "uppercase" },
  title: { fontSize: 26, fontWeight: "800", color: C.textPrimary, textAlign: "center" },
  timerBox: {
    flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "stretch", justifyContent: "center",
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: C.green,
  },
  timerBoxOver: { backgroundColor: C.red, borderColor: C.red },
  timerText: { fontSize: 28, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] },
  timerBtn: { marginLeft: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: C.green },
  timerBtnText: { fontSize: 14, fontWeight: "800", color: C.bg },
  description: { fontSize: 14, color: C.textSecondary, lineHeight: 20, textAlign: "center" },
  doneBtn: { width: "100%", backgroundColor: C.green, borderRadius: 16, paddingVertical: 18, alignItems: "center", marginTop: 8 },
  doneBtnText: { fontSize: 18, fontWeight: "700", color: C.bg, letterSpacing: 0.3 },

  seqBox: { width: "100%", gap: 10, marginTop: 8 },
  seqHeading: { fontSize: 13, fontWeight: "800", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  seqEmpty: { fontSize: 14, color: C.textMuted, lineHeight: 20 },
  seqRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  seqNum: { fontSize: 13, fontWeight: "800", color: C.textMuted, width: 16 },
  seqName: { fontSize: 15, fontWeight: "700", color: C.textPrimary },
  seqMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  seqSends: { fontSize: 13, fontWeight: "800", color: C.green },
  addBtn: {
    borderRadius: 12, paddingVertical: 13, alignItems: "center",
    borderWidth: 1, borderColor: C.green, borderStyle: "dashed",
  },
  addBtnText: { fontSize: 15, fontWeight: "800", color: C.green },
  logPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.green },
  logPillText: { fontSize: 12, fontWeight: "800", color: C.bg },
  sugBox: { width: "100%", gap: 10, marginTop: 12 },
  sugRecord: { fontSize: 12, fontWeight: "700", color: C.textSecondary },
  previewTop: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  previewName: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  previewActions: { flexDirection: "row", gap: 12, padding: 16 },
  previewBtn: { flex: 1, backgroundColor: C.green, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  previewBtnText: { fontSize: 15, fontWeight: "800", color: C.bg },
  previewBtnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.border },
  previewBtnGhostText: { fontSize: 15, fontWeight: "800", color: C.textPrimary },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: C.surface, borderRadius: 18, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  sheetSub: { fontSize: 13, color: C.textSecondary, marginTop: -6 },
  wallRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border },
  wallName: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepLabel: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  stepBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center" },
  stepBtnText: { fontSize: 22, color: C.textPrimary, fontWeight: "700" },
  stepValue: { fontSize: 20, fontWeight: "800", color: C.textPrimary, minWidth: 32, textAlign: "center", fontVariant: ["tabular-nums"] },
  saveBtn: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  saveBtnText: { fontSize: 15, fontWeight: "800", color: C.bg },
  cancelText: { fontSize: 14, fontWeight: "700", color: C.textSecondary, textAlign: "center", paddingVertical: 4 },
})
