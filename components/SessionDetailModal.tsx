import { C } from "@/utils/theme"
import { AdaptationDonut, AdaptationDonutLegend, DonutSlice } from "@/components/AdaptationDonut"
import { deleteSession, getSprayRoute, getSprayWall, SessionRow, updateSession } from "@/services/BoulderGraphService"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import { parseVariations, variationHolds, type RouteVariations, type VariationKey } from "@/utils/sequenceVariations"
import { Ionicons } from "@expo/vector-icons"
import React, { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00")
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function formatBlockType(type: string): string {
  return (type ?? "").split("_").map((w: string) => w[0].toUpperCase() + w.slice(1)).join(" ")
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
  }
  if (m === 0) return `${s}s`
  if (s === 0) return `${m}m`
  return `${m}m ${s}s`
}

function sessionDateKey(session: SessionRow): string {
  try {
    const attempts = JSON.parse(session.attempts)
    if (attempts[0]?.timestamp) return new Date(attempts[0].timestamp).toISOString().slice(0, 10)
  } catch {}
  return session.$createdAt.slice(0, 10)
}

// ─── Edit-time types ──────────────────────────────────────────────────────────

interface EditableBlock {
  key: string        // stable string id (original blockIndex as string)
  block: any
  blockName: string
  blockType: string
  duration: number   // seconds
}

// ─── View-time parse ──────────────────────────────────────────────────────────

interface ViewBlock {
  blockIndex: number
  blockName: string
  blockType: string
  block: any
  duration: number
}

function parseSession(session: SessionRow): {
  blocks: ViewBlock[]
  attempts: any[]
  startTime: string
  totalDuration: number
} {
  let protocol: any[] = []
  let attempts: any[] = []
  let durations: Record<number, number> = {}
  try { protocol = JSON.parse(session.protocol) } catch {}
  try { attempts = JSON.parse(session.attempts) } catch {}
  try { if (session.blockDurations) durations = JSON.parse(session.blockDurations) } catch {}

  const firstTs = attempts[0]?.timestamp
  const startTime = firstTs
    ? formatTime(firstTs)
    : new Date(session.$createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })

  const blocks: ViewBlock[] = protocol.map((block: any, blockIndex: number) => ({
    blockIndex,
    blockName: block.blockName ?? formatBlockType(block.type ?? ""),
    blockType: block.type ?? "",
    block,
    duration: Number(durations[blockIndex] ?? 0),
  }))

  return {
    blocks,
    attempts,
    startTime,
    totalDuration: blocks.reduce((s, b) => s + b.duration, 0),
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  date: string | null
  sessions: SessionRow[]
  onClose: () => void
  onDeleted: (id: string) => void
  onUpdated: (session: SessionRow) => void
}

// ─── Coached block view ───────────────────────────────────────────────────────

// A block the coach ran in person (docs/training-plan-implementation.md §12):
// nothing logged but Done — except sequences, where the athlete saved each
// sequence the coach set with its sends.
function CoachedBlockView({ blockType, attempts }: { blockType: string; attempts: any[] }) {
  const routes = useMemo(() => {
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
  const [info, setInfo] = useState<Record<string, { name: string; level?: number }>>({})
  useEffect(() => {
    for (const r of routes) {
      getSprayRoute(r.id)
        .then((row) => setInfo((p) => ({ ...p, [r.id]: { name: row.name, level: row.level ?? undefined } })))
        .catch(() => {})
    }
  }, [routes])

  if (blockType !== "sequence" || routes.length === 0) {
    return <Text style={styles.blockStats}>Run by the coach</Text>
  }
  return (
    <View style={styles.attemptList}>
      {routes.map((r, i) => (
        <View key={r.id} style={styles.coachedSeqRow}>
          <Ionicons name="footsteps" size={13} color={C.green} />
          <Text style={styles.routeName} numberOfLines={1}>
            {info[r.id]?.name ?? `Sequence ${i + 1}`}
            {info[r.id]?.level != null ? `  ·  level ${info[r.id]!.level}` : ""}
          </Text>
          <Text style={styles.coachedSeqSends}>{r.sends}/{r.tries} sent</Text>
        </View>
      ))}
    </View>
  )
}

// ─── S&C block view ───────────────────────────────────────────────────────────

// Exercises authored as loadMode "level" carry the container (what was
// actually prescribed) plus its harder-than chain. Find which prescribed
// exercise a logged round belongs to — same family-match reasoning as
// scHistory.ts's findLastScLog, just scoped to this one block's own
// exercises instead of searching session history.
function findPrescribedFor(sc: any, exercises: any[]): any | null {
  return (
    exercises.find((ex) => {
      if (ex.loadMode !== "level" || !ex.levels?.length) return false
      const candidateIds = [ex.exerciseId, ...ex.levels.map((l: any) => l.exerciseId)].filter(Boolean)
      if (candidateIds.length && sc.exerciseId) return candidateIds.includes(sc.exerciseId)
      return sc.exerciseName === ex.name
    }) ?? null
  )
}

// True when a round was logged under a level other than the prescribed
// container — i.e. the athlete actually progressed during this training,
// not just what the coach originally programmed.
function isProgression(sc: any, prescribed: any | null): boolean {
  return !!prescribed && !!sc.exerciseId && sc.exerciseId !== prescribed.exerciseId
}

function ScBlockView({ block, attempts }: { block: any; attempts: any[] }) {
  const exercises: any[] = block.exercises ?? []

  // Group scData entries by round number (1-indexed, as logged by StrengthConditioningBlock)
  const byRound: Record<number, any[]> = {}
  for (const a of attempts) {
    if (!a.scData) continue
    const r = a.scData.round ?? 1
    if (!byRound[r]) byRound[r] = []
    byRound[r].push(a.scData)
  }
  const loggedRounds = Object.keys(byRound).map(Number).sort((a, b) => a - b)

  // Distinct container→level jumps logged anywhere in this block, so the
  // coach can spot "progression happened this training" without reading
  // every round — the per-round badge below covers the "on which round, to
  // what" detail.
  const progressions = new Set<string>()
  for (const roundNum of loggedRounds) {
    for (const sc of byRound[roundNum]) {
      const prescribed = findPrescribedFor(sc, exercises)
      if (isProgression(sc, prescribed)) progressions.add(`${prescribed.name} → ${sc.exerciseName}`)
    }
  }

  return (
    <View style={{ gap: 10 }}>
      {progressions.size > 0 && (
        <View style={styles.progressionBanner}>
          <Ionicons name="trending-up" size={13} color={C.green} />
          <Text style={styles.progressionBannerText}>{[...progressions].join("  ·  ")}</Text>
        </View>
      )}
      {/* Prescribed exercises */}
      {exercises.length > 0 && (
        <View style={styles.scExerciseList}>
          {exercises.map((ex, i) => (
            <View key={i} style={styles.scExerciseRow}>
              <Text style={styles.scExerciseName}>{ex.name}</Text>
              <Text style={styles.scExerciseReps}>
                {ex.type === "7/3s"
                  ? `${ex.series} series · ${ex.edge}`
                  : ex.type === "both_sides"
                  ? `${ex.reps} each side`
                  : ex.reps}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Logged data by round */}
      {loggedRounds.length > 0 ? (
        <View style={styles.scLogSection}>
          {loggedRounds.map((roundNum) => (
            <View key={roundNum} style={styles.scRound}>
              <Text style={styles.scRoundLabel}>Round {roundNum}</Text>
              {byRound[roundNum].map((sc, i) => {
                const prescribed = findPrescribedFor(sc, exercises)
                const progressed = isProgression(sc, prescribed)
                return (
                <View key={i} style={styles.scLogRow}>
                  <View style={styles.scLogNameRow}>
                    <Text style={styles.scLogName}>{sc.exerciseName}</Text>
                    {progressed && (
                      <View style={styles.levelUpBadge}>
                        <Ionicons name="trending-up" size={10} color={C.green} />
                        <Text style={styles.levelUpBadgeText}>from {prescribed.name}</Text>
                      </View>
                    )}
                  </View>
                  {sc.repsCompleted != null ? (
                    <View style={styles.scLogFields}>
                      <Text style={styles.scLogDetail}>{sc.repsCompleted} reps</Text>
                      {!!sc.weight && <Text style={styles.scLogDetail}>{sc.weight}{sc.weightUnit ?? "kg"}</Text>}
                      {!!sc.rpe && <Text style={styles.scLogDetail}>RPE {sc.rpe}</Text>}
                    </View>
                  ) : sc.repsLeft != null ? (
                    <View style={styles.scLogFields}>
                      <Text style={styles.scLogDetail}>
                        {"L: "}{sc.repsLeft} reps{sc.weightLeft ? ` · ${sc.weightLeft}${sc.weightUnit ?? "kg"}` : ""}{sc.rpeLeft ? ` · RPE ${sc.rpeLeft}` : ""}
                      </Text>
                      <Text style={styles.scLogDetail}>
                        {"R: "}{sc.repsRight} reps{sc.weightRight ? ` · ${sc.weightRight}${sc.weightUnit ?? "kg"}` : ""}{sc.rpeRight ? ` · RPE ${sc.rpeRight}` : ""}
                      </Text>
                    </View>
                  ) : sc.seriesDone != null ? (
                    <View style={styles.scLogFields}>
                      <Text style={styles.scLogDetail}>{sc.seriesDone} series · {sc.edge}</Text>
                      {!!sc.rpe && <Text style={styles.scLogDetail}>RPE {sc.rpe}</Text>}
                    </View>
                  ) : (
                    <Text style={styles.scLogDetail}>—</Text>
                  )}
                  {!!sc.notes && <Text style={styles.scLogNotes}>&quot;{sc.notes}&quot;</Text>}
                </View>
                )
              })}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.blockStats}>No exercises logged</Text>
      )}
    </View>
  )
}

// ─── Free session block view ───────────────────────────────────────────────────

function FreeSessionBlockView({ block, attempts }: { block: any; attempts: any[] }) {
  const notedAttempts = attempts.filter((a) => !!a.notes)
  if (notedAttempts.length === 0) {
    return <Text style={styles.blockStats}>No note added</Text>
  }
  return (
    <View style={{ gap: 10 }}>
      {notedAttempts.map((a, i) => (
        <View key={i} style={styles.scLogRow}>
          <Text style={styles.scRoundLabel}>{block?.notePrompt || "Note"}</Text>
          <Text style={styles.attemptNotes}>{a.notes}</Text>
        </View>
      ))}
    </View>
  )
}

// ─── Sequence block view ──────────────────────────────────────────────────────

function SequenceBlockView({ block, attempts }: { block: any; attempts: any[] }) {
  const [variations, setVariations] = useState<RouteVariations>(() => {
    try { return { original: JSON.parse(block.routeHolds ?? "[]") } } catch { return { original: [] } }
  })
  const [wallImageSource, setWallImageSource] = useState<any>(
    block.wallImageUri ? { uri: block.wallImageUri } : WALL_IMAGE
  )
  const [wallSize, setWallSize] = useState<{ w: number; h: number } | null>(
    block.wallWidth && block.wallHeight ? { w: block.wallWidth, h: block.wallHeight } : null
  )

  // Refresh from the live route/wall in case they were edited since this
  // session was logged — falls back to the block's own snapshot on failure.
  useEffect(() => {
    if (!block.routeId) return
    let cancelled = false
    getSprayRoute(block.routeId)
      .then(async (row) => {
        if (cancelled) return
        setVariations(parseVariations(row))
        if (row.wallId) {
          const wall = await getSprayWall(row.wallId)
          if (cancelled) return
          if (wall?.imageUri) setWallImageSource({ uri: wall.imageUri })
          if (wall?.width && wall?.height) setWallSize({ w: wall.width, h: wall.height })
        }
      })
      .catch(() => {/* keep snapshot */})
    return () => { cancelled = true }
  }, [block.routeId])

  // Show the variation the athlete actually climbed (their most recent
  // logged attempt), defaulting to the original.
  const activeVariation: VariationKey =
    ([...attempts].reverse().find((a) => a.variation)?.variation as VariationKey) ?? "original"
  const holds = variationHolds(variations, activeVariation)

  return (
    <View style={[styles.sequenceWallWrap, { aspectRatio: wallSize ? wallSize.w / wallSize.h : 4 / 3 }]}>
      <SprayWallViewer
        imageSource={wallImageSource}
        holds={holds}
        style={{ flex: 1 }}
        interactive={false}
        previewWidth={700}
        naturalSize={wallSize}
      />
    </View>
  )
}

// ─── Attempt status row ────────────────────────────────────────────────────────

function AttemptStatusRow({
  attempt,
  blockType,
  editable,
  onToggle,
}: {
  attempt: any
  blockType: string
  editable: boolean
  onToggle?: () => void
}) {
  const isProjectBouldering = blockType === "project_bouldering"
  const isSequence = blockType === "sequence"
  const isConstraintWarmup = blockType === "constraint_warmup"
  const isFreeSession = blockType === "free_session"
  const sent = attempt.success

  if (isConstraintWarmup) {
    return <View style={styles.attemptStatusRow} />
  }

  if (isFreeSession) {
    // A free-session note isn't a send/fail attempt — just show when it was logged.
    return (
      <View style={styles.attemptStatusRow}>
        {attempt.timestamp && <Text style={styles.attemptTimestamp}>{formatTime(attempt.timestamp)}</Text>}
      </View>
    )
  }

  if (isProjectBouldering) {
    // Keep original dot + label style
    return (
      <View style={styles.attemptStatusRow}>
        {editable ? (
          <Pressable onPress={onToggle} hitSlop={8}>
            <View style={[styles.dot, styles.dotEditable, { backgroundColor: sent ? C.green : C.red }]} />
          </Pressable>
        ) : (
          <View style={[styles.dot, { backgroundColor: sent ? C.green : C.red }]} />
        )}
        <Pressable onPress={editable ? onToggle : undefined}>
          <Text style={[styles.attemptLabel, editable && { color: sent ? C.green : C.red }]}>
            {sent ? "Send" : "Fall"}
            {attempt.timestamp ? `  ·  ${formatTime(attempt.timestamp)}` : ""}
          </Text>
        </Pressable>
      </View>
    )
  }

  // Clean horizontal badge for all other block types
  return (
    <Pressable
      style={styles.attemptStatusRow}
      onPress={editable ? onToggle : undefined}
      disabled={!editable}
    >
      <View style={[styles.statusBadge, { backgroundColor: sent ? C.green + "22" : C.red + "22" }]}>
        <Text style={[styles.statusBadgeText, { color: sent ? C.green : C.red }]}>
          {sent ? "SEND" : "FAIL"}
        </Text>
      </View>
      {attempt.timestamp && (
        <Text style={styles.attemptTimestamp}>{formatTime(attempt.timestamp)}</Text>
      )}
      {isSequence && !sent && attempt.highPoint != null && (
        <View style={styles.highPointBadge}>
          <Text style={styles.highPointText}>fell move {attempt.highPoint}</Text>
        </View>
      )}
      {isSequence && !!attempt.variation && (
        <Text style={styles.variationTag}>{attempt.variation}</Text>
      )}
    </Pressable>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SessionDetailModal({ date, sessions, onClose, onDeleted, onUpdated }: Props) {
  const [editingId, setEditingId]                   = useState<string | null>(null)
  const [editedBlocks, setEditedBlocks]             = useState<EditableBlock[]>([])
  const [attemptsByKey, setAttemptsByKey]           = useState<Record<string, any[]>>({})
  const [durationsByKey, setDurationsByKey]         = useState<Record<string, string>>({}) // minutes as string
  const [saving, setSaving]                         = useState(false)
  const [deleting, setDeleting]                     = useState<string | null>(null)

  const daySessions = date ? sessions.filter((s) => sessionDateKey(s) === date) : []

  // ── Edit lifecycle ──────────────────────────────────────────────────────────

  function startEditing(session: SessionRow) {
    const { blocks, attempts } = parseSession(session)

    const eb: EditableBlock[] = blocks.map((b) => ({
      key: String(b.blockIndex),
      block: b.block,
      blockName: b.blockName,
      blockType: b.blockType,
      duration: b.duration,
    }))

    const byKey: Record<string, any[]> = {}
    const durByKey: Record<string, string> = {}
    for (const b of eb) {
      byKey[b.key] = []
      // store as whole minutes string for editing
      durByKey[b.key] = b.duration > 0 ? String(Math.round(b.duration / 60)) : ""
    }
    for (const a of attempts) {
      const k = String(a.blockIndex)
      if (byKey[k]) byKey[k] = [...byKey[k], { ...a }]
    }

    setEditedBlocks(eb)
    setAttemptsByKey(byKey)
    setDurationsByKey(durByKey)
    setEditingId(session.$id)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditedBlocks([])
    setAttemptsByKey({})
    setDurationsByKey({})
  }

  async function saveEdits(session: SessionRow) {
    setSaving(true)
    try {
      const protocol = editedBlocks.map((eb) => eb.block)
      const attempts: any[] = []
      const blockDurationsOut: Record<number, number> = {}

      editedBlocks.forEach((eb, newIdx) => {
        for (const a of attemptsByKey[eb.key] ?? []) {
          attempts.push({ ...a, blockIndex: newIdx })
        }
        const mins = parseFloat(durationsByKey[eb.key] ?? "")
        if (!isNaN(mins) && mins > 0) {
          blockDurationsOut[newIdx] = Math.round(mins * 60)
        }
      })

      const updated = await updateSession(session.$id, {
        protocol: JSON.stringify(protocol),
        attempts: JSON.stringify(attempts),
        blockDurations: JSON.stringify(blockDurationsOut),
      })
      onUpdated(updated)
      setEditingId(null)
      setEditedBlocks([])
      setAttemptsByKey({})
      setDurationsByKey({})
    } finally {
      setSaving(false)
    }
  }

  // ── Block mutations ─────────────────────────────────────────────────────────

  function moveBlock(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= editedBlocks.length) return
    setEditedBlocks((prev) => {
      const arr = [...prev]
      ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
      return arr
    })
  }

  function deleteBlock(key: string) {
    Alert.alert(
      "Delete block",
      "This will also remove all attempts logged for this block.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setEditedBlocks((prev) => prev.filter((b) => b.key !== key))
            setAttemptsByKey((prev) => { const n = { ...prev }; delete n[key]; return n })
            setDurationsByKey((prev) => { const n = { ...prev }; delete n[key]; return n })
          },
        },
      ]
    )
  }

  // ── Attempt mutations ───────────────────────────────────────────────────────

  function toggleSuccess(blockKey: string, aidx: number) {
    setAttemptsByKey((prev) => ({
      ...prev,
      [blockKey]: prev[blockKey].map((a, i) =>
        i === aidx ? { ...a, success: !a.success } : a
      ),
    }))
  }

  function updateNotes(blockKey: string, aidx: number, notes: string) {
    setAttemptsByKey((prev) => ({
      ...prev,
      [blockKey]: prev[blockKey].map((a, i) =>
        i === aidx ? { ...a, notes } : a
      ),
    }))
  }

  function deleteAttempt(blockKey: string, aidx: number) {
    setAttemptsByKey((prev) => ({
      ...prev,
      [blockKey]: prev[blockKey].filter((_, i) => i !== aidx),
    }))
  }

  function addAttempt(eb: EditableBlock) {
    setAttemptsByKey((prev) => ({
      ...prev,
      [eb.key]: [
        ...(prev[eb.key] ?? []),
        {
          blockIndex: 0,
          type: eb.blockType,
          success: false,
          timestamp: Date.now(),
          notes: "",
        },
      ],
    }))
  }

  // ── Session delete ──────────────────────────────────────────────────────────

  function handleDelete(session: SessionRow) {
    Alert.alert("Delete session", "Remove this session permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(session.$id)
          try {
            await deleteSession(session.$id)
            onDeleted(session.$id)
            if (daySessions.length === 1) onClose()
          } finally {
            setDeleting(null)
          }
        },
      },
    ])
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={date !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {/* React Native Modal renders outside the app's SafeAreaProvider, so
          re-establish one here or insets read as zero and the header slides
          under the iOS status bar / notch. */}
      <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeBtnText}>‹</Text>
          </Pressable>
          <Text style={styles.headerDate}>{date ? formatDate(date) : ""}</Text>
        </View>

        {daySessions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No sessions recorded this day.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {daySessions.map((session, si) => {
              const { blocks: viewBlocks, attempts: rawAttempts, startTime, totalDuration } = parseSession(session)
              const isEditing = editingId === session.$id

              const donutSlices: DonutSlice[] = viewBlocks
                .filter((b) => b.duration > 0)
                .map((b) => ({ id: b.blockIndex, block: b.block, value: b.duration }))

              return (
                <View key={session.$id} style={styles.sessionCard}>
                  {/* Session header */}
                  <View style={styles.sessionTopRow}>
                    <Text style={styles.sessionTime}>
                      {daySessions.length > 1 ? `Session ${si + 1}  ·  ` : ""}
                      {startTime}
                    </Text>
                    <View style={styles.actionRow}>
                      {isEditing ? (
                        <>
                          <Pressable onPress={cancelEditing}>
                            <Text style={styles.cancelText}>Cancel</Text>
                          </Pressable>
                          <Pressable
                            style={styles.saveBtn}
                            onPress={() => saveEdits(session)}
                            disabled={saving}
                          >
                            <Text style={styles.saveBtnText}>{saving ? "…" : "Save"}</Text>
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable style={styles.editBtn} onPress={() => startEditing(session)}>
                            <Text style={styles.editBtnText}>Edit</Text>
                          </Pressable>
                          <Pressable
                            style={styles.deleteBtn}
                            onPress={() => handleDelete(session)}
                            disabled={deleting === session.$id}
                          >
                            <Text style={styles.deleteBtnText}>
                              {deleting === session.$id ? "…" : "Delete"}
                            </Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>

                  {/* Donut — view mode only */}
                  {!isEditing && donutSlices.length > 0 && (
                    <View style={styles.donutWrap}>
                      <AdaptationDonut
                        slices={donutSlices}
                        size={200}
                        thickness={28}
                        centerLabel={formatDuration(totalDuration)}
                        centerSubLabel="total time"
                      />
                      <AdaptationDonutLegend
                        slices={donutSlices}
                        total={totalDuration}
                        formatValue={(v) => formatDuration(v)}
                      />
                    </View>
                  )}

                  {/* ── VIEW MODE blocks ── */}
                  {!isEditing && viewBlocks.map((block) => {
                    const blockAttempts = rawAttempts.filter((a) => a.blockIndex === block.blockIndex)
                    const sends = blockAttempts.filter((a) => a.success).length
                    const total = blockAttempts.length
                    const coached = !!block.block?.coached

                    return (
                      <View key={block.blockIndex} style={styles.blockCard}>
                        <View style={styles.blockHeader}>
                          <View style={styles.typePill}>
                            <Text style={styles.typePillText}>{formatBlockType(block.blockType)}</Text>
                          </View>
                          <Text style={styles.blockName} numberOfLines={1}>{block.blockName}</Text>
                          {coached && (
                            <View style={styles.coachedPill}>
                              <Text style={styles.coachedPillText}>Coached</Text>
                            </View>
                          )}
                          {block.duration > 0 && (
                            <Text style={styles.blockDuration}>{formatDuration(block.duration)}</Text>
                          )}
                        </View>
                        {!coached && block.blockType === "sequence" && !!block.block?.routeName && (
                          <View style={styles.routeRow}>
                            <Ionicons name="footsteps" size={13} color={C.green} />
                            <Text style={styles.routeName} numberOfLines={1}>{block.block.routeName}</Text>
                          </View>
                        )}
                        {!coached && block.blockType === "sequence" && (
                          <SequenceBlockView block={block.block} attempts={blockAttempts} />
                        )}
                        {coached ? (
                          <CoachedBlockView blockType={block.blockType} attempts={blockAttempts} />
                        ) : block.blockType === "strength_conditioning" ? (
                          <ScBlockView block={block.block} attempts={blockAttempts} />
                        ) : block.blockType === "free_session" ? (
                          <FreeSessionBlockView block={block.block} attempts={blockAttempts} />
                        ) : block.blockType !== "constraint_warmup" && (
                          <>
                            <Text style={styles.blockStats}>
                              {total === 0
                                ? "No attempts logged"
                                : `${sends} send${sends !== 1 ? "s" : ""}  /  ${total} attempt${total !== 1 ? "s" : ""}`}
                            </Text>
                            {blockAttempts.length > 0 && (
                              <View style={styles.attemptList}>
                                {blockAttempts.map((attempt, aidx) => (
                                  <View
                                    key={aidx}
                                    style={[styles.attemptRow, aidx === blockAttempts.length - 1 && { borderBottomWidth: 0 }]}
                                  >
                                    <View style={styles.attemptBody}>
                                      <AttemptStatusRow
                                        attempt={attempt}
                                        blockType={block.blockType}
                                        editable={false}
                                      />
                                      {attempt.notes ? <Text style={styles.attemptNotes}>{attempt.notes}</Text> : null}
                                    </View>
                                  </View>
                                ))}
                              </View>
                            )}
                          </>
                        )}
                      </View>
                    )
                  })}

                  {/* ── EDIT MODE blocks ── */}
                  {isEditing && editedBlocks.map((eb, ebIdx) => {
                    const blockAttempts = attemptsByKey[eb.key] ?? []
                    const sends = blockAttempts.filter((a) => a.success).length
                    const total = blockAttempts.length
                    const isFirst = ebIdx === 0
                    const isLast  = ebIdx === editedBlocks.length - 1

                    return (
                      <View key={eb.key} style={styles.blockCard}>
                        {/* Block header with reorder + delete controls */}
                        <View style={styles.blockEditHeader}>
                          <View style={styles.reorderBtns}>
                            <Pressable
                              onPress={() => moveBlock(ebIdx, -1)}
                              disabled={isFirst}
                              hitSlop={6}
                              style={[styles.arrowBtn, isFirst && styles.arrowBtnDisabled]}
                            >
                              <Ionicons name="chevron-up" size={16} color={isFirst ? C.textMuted : C.textSecondary} />
                            </Pressable>
                            <Pressable
                              onPress={() => moveBlock(ebIdx, 1)}
                              disabled={isLast}
                              hitSlop={6}
                              style={[styles.arrowBtn, isLast && styles.arrowBtnDisabled]}
                            >
                              <Ionicons name="chevron-down" size={16} color={isLast ? C.textMuted : C.textSecondary} />
                            </Pressable>
                          </View>

                          <View style={styles.blockLabelWrap}>
                            <View style={styles.typePill}>
                              <Text style={styles.typePillText}>{formatBlockType(eb.blockType)}</Text>
                            </View>
                            <Text style={styles.blockName} numberOfLines={1}>{eb.blockName}</Text>
                          </View>

                          <Pressable
                            onPress={() => deleteBlock(eb.key)}
                            hitSlop={8}
                            style={styles.deleteBlockBtn}
                          >
                            <Ionicons name="trash-outline" size={16} color={C.red} />
                          </Pressable>
                        </View>

                        {/* Duration editor */}
                        <View style={styles.durationRow}>
                          <Ionicons name="time-outline" size={14} color={C.textMuted} />
                          <TextInput
                            style={styles.durationInput}
                            value={durationsByKey[eb.key] ?? ""}
                            onChangeText={(t) =>
                              setDurationsByKey((prev) => ({ ...prev, [eb.key]: t }))
                            }
                            placeholder="—"
                            placeholderTextColor={C.textMuted}
                            keyboardType="decimal-pad"
                            selectTextOnFocus
                          />
                          <Text style={styles.durationUnit}>min</Text>
                        </View>

                        {eb.blockType !== "constraint_warmup" && (
                          <>
                            {eb.blockType !== "free_session" && (
                              <Text style={styles.blockStats}>
                                {total === 0
                                  ? "No attempts logged"
                                  : `${sends} send${sends !== 1 ? "s" : ""}  /  ${total} attempt${total !== 1 ? "s" : ""}`}
                              </Text>
                            )}

                            {blockAttempts.length > 0 && (
                              <View style={styles.attemptList}>
                                {blockAttempts.map((attempt, aidx) => (
                                  <View
                                    key={aidx}
                                    style={[styles.attemptRow, aidx === blockAttempts.length - 1 && { borderBottomWidth: 0 }]}
                                  >
                                    <View style={styles.attemptBody}>
                                      <AttemptStatusRow
                                        attempt={attempt}
                                        blockType={eb.blockType}
                                        editable
                                        onToggle={() => toggleSuccess(eb.key, aidx)}
                                      />
                                      <TextInput
                                        style={styles.notesInput}
                                        value={attempt.notes ?? ""}
                                        onChangeText={(t) => updateNotes(eb.key, aidx, t)}
                                        placeholder={eb.blockType === "free_session" ? (eb.block?.notePrompt || "Add a note…") : "Add a note…"}
                                        placeholderTextColor={C.textMuted}
                                        multiline
                                      />
                                    </View>
                                    <Pressable onPress={() => deleteAttempt(eb.key, aidx)} hitSlop={8} style={styles.deleteAttemptBtn}>
                                      <Ionicons name="trash-outline" size={15} color={C.textMuted} />
                                    </Pressable>
                                  </View>
                                ))}
                              </View>
                            )}

                            <Pressable style={styles.addAttemptBtn} onPress={() => addAttempt(eb)}>
                              <Ionicons name="add" size={15} color={C.green} />
                              <Text style={styles.addAttemptText}>{eb.blockType === "free_session" ? "Add note" : "Add attempt"}</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    )
                  })}
                </View>
              )
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  coachedPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: C.green + "22" },
  coachedPillText: { fontSize: 11, fontWeight: "800", color: C.green },
  coachedSeqRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  coachedSeqSends: { marginLeft: "auto", fontSize: 13, fontWeight: "800", color: C.green },
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14, gap: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  closeBtn: { paddingRight: 4 },
  closeBtnText: { fontSize: 34, color: C.textSecondary, lineHeight: 36 },
  headerDate: { fontSize: 17, fontWeight: "700", color: C.textPrimary, flex: 1 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 15, color: C.textMuted },

  scroll: { padding: 16, gap: 16 },

  // ── Session card ──
  sessionCard: {
    backgroundColor: C.surface, borderRadius: 18,
    borderWidth: 1, borderColor: C.border,
    padding: 16, gap: 12,
  },
  donutWrap: {
    alignItems: "center", paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4,
  },
  sessionTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sessionTime: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBtn: { backgroundColor: C.surfaceHigh, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  editBtnText: { fontSize: 12, fontWeight: "600", color: C.textPrimary },
  deleteBtn: { backgroundColor: C.surfaceHigh, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  deleteBtnText: { fontSize: 12, fontWeight: "600", color: C.red },
  cancelText: { fontSize: 13, color: C.textSecondary },
  saveBtn: { backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
  saveBtnText: { fontSize: 13, fontWeight: "700", color: C.bg },

  // ── Block card ──
  blockCard: { backgroundColor: C.surfaceHigh, borderRadius: 12, padding: 12, gap: 8 },

  blockHeader: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  blockDuration: { fontSize: 12, color: C.textMuted, marginLeft: "auto" as any },

  blockEditHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  reorderBtns: { flexDirection: "column", gap: 2 },
  arrowBtn: { padding: 2 },
  arrowBtnDisabled: { opacity: 0.3 },
  blockLabelWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  deleteBlockBtn: { padding: 4 },

  // Duration editor
  durationRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 4,
  },
  durationInput: {
    fontSize: 14, color: C.textPrimary,
    backgroundColor: C.bg, borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 10, paddingVertical: 4,
    minWidth: 56, textAlign: "center",
  },
  durationUnit: { fontSize: 13, color: C.textMuted },

  typePill: { backgroundColor: C.border, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  typePillText: { fontSize: 11, fontWeight: "600", color: C.textSecondary },
  blockName: { fontSize: 14, fontWeight: "700", color: C.textPrimary, flex: 1 },
  blockStats: { fontSize: 12, color: C.textSecondary },

  // ── Attempt list ──
  attemptList: { marginTop: 4, borderTopWidth: 1, borderTopColor: C.border },
  attemptRow: {
    flexDirection: "row", alignItems: "flex-start",
    paddingVertical: 10, gap: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  dotEditable: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  attemptBody: { flex: 1, gap: 4 },
  attemptLabel: { fontSize: 13, fontWeight: "500", color: C.textPrimary },
  attemptNotes: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  notesInput: {
    fontSize: 13, color: C.textPrimary,
    backgroundColor: C.bg, borderRadius: 8,
    borderWidth: 1, borderColor: C.border,
    padding: 8, minHeight: 36,
  },
  deleteAttemptBtn: { padding: 4, alignSelf: "center" },

  // ── Attempt status row ──
  attemptStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  attemptTimestamp: { fontSize: 12, color: C.textMuted },
  highPointBadge: {
    backgroundColor: C.surfaceHigh,
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 6,
  },
  highPointText: { fontSize: 11, color: C.textSecondary, fontWeight: "600" },

  routeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  routeName: { fontSize: 13, fontWeight: "600", color: C.green, flex: 1 },
  sequenceWallWrap: {
    width: "100%", marginTop: 8, borderRadius: 10, overflow: "hidden",
    backgroundColor: C.surfaceHigh,
  },
  variationTag: {
    fontSize: 10, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.5,
    backgroundColor: C.surfaceHigh, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
  },

  // ── S&C view ──
  progressionBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.green + "1a", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  progressionBannerText: { fontSize: 12, fontWeight: "700", color: C.green, flex: 1 },
  scExerciseList: { gap: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  scExerciseRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 3 },
  scExerciseName: { fontSize: 13, fontWeight: "600", color: C.textPrimary, flex: 1, marginRight: 8 },
  scExerciseReps: { fontSize: 13, color: C.textSecondary, fontWeight: "500" },
  scLogSection: { gap: 10 },
  scRound: { gap: 4 },
  scRoundLabel: { fontSize: 11, fontWeight: "700", color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  scLogRow: { gap: 2, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: C.border },
  scLogNameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  scLogName: { fontSize: 13, fontWeight: "600", color: C.textPrimary },
  levelUpBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.green + "22", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  levelUpBadgeText: { fontSize: 10, fontWeight: "700", color: C.green },
  scLogFields: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  scLogDetail: { fontSize: 12, color: C.textSecondary },
  scLogNotes: { fontSize: 12, color: C.textMuted, fontStyle: "italic" as const },

  // ── Add attempt ──
  addAttemptBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  addAttemptText: { fontSize: 13, fontWeight: "600", color: C.green },
})
