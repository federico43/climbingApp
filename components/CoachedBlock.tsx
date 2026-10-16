import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { SprayWallBuilder } from "@/components/SprayWallBuilder"
import type { Attempt } from "@/hooks/WorkoutHook"
import {
  getSprayRoute, getSprayWalls, saveSprayRoute, type SprayWallRow,
} from "@/services/BoulderGraphService"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import type { RouteVariations } from "@/utils/sequenceVariations"
import { Ionicons } from "@expo/vector-icons"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

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
          <Text style={s.doneBtnText}>Done</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

// ─── The coach's sequences ───────────────────────────────────────────────────

// "Max bouldering" / "Base" — the route type the block's sequences are.
function routeTypeFor(blockName: string | undefined, assignedType: string | undefined): string {
  if (assignedType) return assignedType
  return /max/i.test(blockName ?? "") ? "max_bouldering" : "base"
}

function CoachSequences({ block, attempts, logAttempt }: Omit<Props, "goToNextBlock" | "goToPreviousBlock">) {
  const { User } = ConsumeAuth()
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

  // Names and levels: the ones saved here, else fetched (on resume).
  const [info, setInfo] = useState<Record<string, { name: string; level?: number }>>({})
  useEffect(() => {
    for (const { id } of logged) {
      if (info[id]) continue
      getSprayRoute(id)
        .then((r) => setInfo((p) => ({ ...p, [id]: { name: r.name, level: r.level ?? undefined } })))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- info is only a cache check; depending on it would refetch routes still in flight
  }, [logged])

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
      logAttempt({ success: i < sends, routeId: result.id, variation: "original", coached: true })
    }
    setResult(null)
  }

  return (
    <View style={s.seqBox}>
      <Text style={s.seqHeading}>{"Your coach's sequences"}</Text>
      {logged.length === 0 && (
        <Text style={s.seqEmpty}>Save each sequence your coach sets, with how it went — it counts toward your level.</Text>
      )}
      {logged.map((r, i) => (
        <View key={r.id} style={s.seqRow}>
          <Text style={s.seqNum}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.seqName} numberOfLines={1}>{info[r.id]?.name ?? "Sequence"}</Text>
            {info[r.id]?.level != null && <Text style={s.seqMeta}>Level {info[r.id]!.level}</Text>}
          </View>
          <Text style={s.seqSends}>{r.sends}/{r.tries} sent</Text>
        </View>
      ))}
      <Pressable style={[s.addBtn, !walls && { opacity: 0.5 }]} onPress={add} disabled={!walls}>
        {walls ? <Text style={s.addBtnText}>+ Add sequence</Text> : <ActivityIndicator color={C.green} />}
      </Pressable>

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
              initialType={routeTypeFor(block.blockName, assignedType)}
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
          onClose={() => setResult(null)}
        />
      )}
    </View>
  )
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
