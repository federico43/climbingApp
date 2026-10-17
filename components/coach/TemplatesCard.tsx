import { C } from "@/utils/theme"
import { AthleteWorkoutBuilder } from "@/components/AthleteWorkoutBuilder"
import { card } from "@/components/coach/styles"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import {
  AppUser,
  ProtocolRow,
  copyProtocolToAthlete,
  deleteProtocol,
  listAthleteTemplates,
} from "@/services/BoulderGraphService"
import { normalizeProjectBlock } from "@/utils/progression/projectBouldering"
import { Ionicons } from "@expo/vector-icons"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native"

// Number of blocks in a protocol's serialized blocks JSON.
function blockCount(p: ProtocolRow): number {
  try { return JSON.parse(p.blocks ?? "[]").length } catch { return 0 }
}

const BLOCK_TYPE_LABEL: Record<string, string> = {
  project_bouldering: "Project", constraint_warmup: "Warmup", strength_conditioning: "S&C",
  exploration_session: "Explore", sequence: "Sequence", free_session: "Free",
  four_by_four: "4×4", intervals: "Intervals",
}

// Block previews in workout order: name (custom, else a short type label) plus
// the time limit in minutes when the block has one.
function blockPreviews(p: ProtocolRow): { name: string; timeLimit?: number }[] {
  try {
    return (JSON.parse(p.blocks ?? "[]") as any[]).map((b) => ({
      name: (b?.blockName ?? "").toString().trim() || BLOCK_TYPE_LABEL[b?.type] || b?.type || "Block",
      timeLimit: b?.type === "project_bouldering" ? normalizeProjectBlock(b).timeLimit  // always timed (v2)
        : typeof b?.timeLimit === "number" && b.timeLimit > 0 ? b.timeLimit : undefined,
    }))
  } catch { return [] }
}

// The athlete's coach-assigned templates: Test / Edit / ⋮ (copy, delete) and
// + Add. Block chips only when there's room (`wide`).
export function TemplatesCard({ athlete, roster, wide }: { athlete: AppUser; roster: AppUser[]; wide: boolean }) {
  const workoutCtx = useWorkoutContext()
  const [templates, setTemplates] = useState<ProtocolRow[]>([])
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [editProtocol, setEditProtocol] = useState<ProtocolRow | null>(null)
  const [copyFor, setCopyFor] = useState<ProtocolRow | null>(null)
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)

  // (An athlete's own library-derived saves live in a separate pool and
  // don't show up in this admin view; homework / split-off S&C neither.)
  const load = useCallback(() => {
    setLoading(true)
    listAthleteTemplates(athlete.$id)
      .then((rows) => setTemplates(rows.filter((r) => r.source !== "library" && r.planPart !== "homework")))
      .catch((e) => { console.error(e); setTemplates([]) })
      .finally(() => setLoading(false))
  }, [athlete.$id])

  useEffect(() => { load() }, [load])

  function handleTest(p: ProtocolRow) {
    let blocks: any[] = []
    try { blocks = p.blocks ? JSON.parse(p.blocks) : [] } catch {}
    if (blocks.length === 0) { Alert.alert("Empty workout", "This workout has no blocks to test."); return }
    workoutCtx.openWorkout(blocks, p.name)
  }

  function confirmDelete(p: ProtocolRow) {
    Alert.alert("Delete template", `Delete "${p.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteProtocol(p.$id)
            setTemplates((prev) => prev.filter((x) => x.$id !== p.$id))
          } catch (e: any) { Alert.alert("Error", e?.message ?? "Could not delete the template.") }
        },
      },
    ])
  }

  function openMenu(p: ProtocolRow) {
    Alert.alert(p.name, undefined, [
      { text: "Copy to another athlete", onPress: () => { setCopyFor(p); setCopyTargets(new Set()) } },
      { text: "Delete", style: "destructive", onPress: () => confirmDelete(p) },
      { text: "Cancel", style: "cancel" },
    ])
  }

  async function doCopy() {
    if (!copyFor) return
    const ids = [...copyTargets]
    if (ids.length === 0) { setCopyFor(null); return }
    setCopying(true)
    try {
      for (const id of ids) await copyProtocolToAthlete(copyFor, id)
      setCopyFor(null)
      Alert.alert("Copy complete", `Copied to ${ids.length} athlete${ids.length !== 1 ? "s" : ""}.`)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not copy the template.")
    } finally {
      setCopying(false)
    }
  }

  const others = roster.filter((a) => a.$id !== athlete.$id)

  return (
    <View style={card.card}>
      <View style={card.headerRow}>
        <Text style={card.title}>Templates · {templates.length}</Text>
        <Pressable style={card.primaryBtn} onPress={() => { setEditProtocol(null); setBuilding(true) }}>
          <Ionicons name="add" size={15} color={C.bg} />
          <Text style={card.primaryBtnText}>Add</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={C.green} />
      ) : templates.length === 0 ? (
        <Text style={card.empty}>No templates yet — add one to get started.</Text>
      ) : templates.map((p) => (
        <View key={p.$id} style={styles.row}>
          <View style={styles.rowTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              <Text style={card.sub}>{blockCount(p)} block{blockCount(p) !== 1 ? "s" : ""}</Text>
            </View>
            <Pressable style={styles.iconBtn} onPress={() => handleTest(p)} accessibilityLabel="Test">
              <Ionicons name="play" size={15} color={C.green} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => { setEditProtocol(p); setBuilding(true) }} accessibilityLabel="Edit">
              <Ionicons name="create-outline" size={15} color={C.green} />
            </Pressable>
            <Pressable style={styles.menuBtn} onPress={() => openMenu(p)} hitSlop={6} accessibilityLabel="More">
              <Ionicons name="ellipsis-vertical" size={16} color={C.textSecondary} />
            </Pressable>
          </View>
          {wide && (
            <View style={styles.previewWrap}>
              {blockPreviews(p).map((b, i) => (
                <View key={i} style={styles.previewChip}>
                  <Text style={styles.previewIndex}>{i + 1}</Text>
                  <Text style={styles.previewChipText} numberOfLines={1}>{b.name}</Text>
                  {b.timeLimit != null && <Text style={styles.previewTime}>⏱{b.timeLimit}m</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      ))}

      <Modal visible={building} transparent animationType="fade" onRequestClose={() => setBuilding(false)}>
        <AthleteWorkoutBuilder
          athlete={athlete}
          roster={roster}
          protocol={editProtocol}
          onClose={() => setBuilding(false)}
          onSaved={load}
        />
      </Modal>

      {/* Copy a template to other athletes */}
      <Modal visible={copyFor !== null} transparent animationType="fade" onRequestClose={() => setCopyFor(null)}>
        <Pressable style={styles.copyBackdrop} onPress={() => setCopyFor(null)}>
          <Pressable style={styles.copyCard} onPress={() => {}}>
            <Text style={styles.copyTitle} numberOfLines={1}>Copy “{copyFor?.name}” to</Text>
            <Text style={styles.copySub}>Each athlete gets their own copy.</Text>
            <View style={styles.copyPills}>
              {others.length === 0 ? (
                <Text style={card.sub}>No other athletes.</Text>
              ) : others.map((a) => {
                const sel = copyTargets.has(a.$id)
                return (
                  <Pressable
                    key={a.$id}
                    style={[styles.copyPill, sel && styles.copyPillSel]}
                    onPress={() => setCopyTargets((prev) => {
                      const n = new Set(prev); if (n.has(a.$id)) n.delete(a.$id); else n.add(a.$id); return n
                    })}
                  >
                    <Text style={[styles.copyPillText, sel && styles.copyPillTextSel]}>{a.username ?? a.$id}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Pressable
              style={[styles.copyConfirm, (copyTargets.size === 0 || copying) && { opacity: 0.5 }]}
              disabled={copyTargets.size === 0 || copying}
              onPress={doCopy}
            >
              {copying ? <ActivityIndicator color={C.bg} /> : (
                <Text style={styles.copyConfirmText}>
                  Copy to {copyTargets.size || ""} athlete{copyTargets.size !== 1 ? "s" : ""}
                </Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 14.5, fontWeight: "700", color: C.textPrimary },
  iconBtn: { borderWidth: 1, borderColor: C.green, borderRadius: 10, padding: 7 },
  menuBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  previewWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  previewChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.surfaceHigh, borderRadius: 8, paddingLeft: 6, paddingRight: 9, paddingVertical: 4,
  },
  previewIndex: { fontSize: 10, fontWeight: "800", color: C.green },
  previewChipText: { fontSize: 11, color: C.textSecondary, fontWeight: "600", maxWidth: 120 },
  previewTime: { fontSize: 10, color: C.green, fontWeight: "800" },

  copyBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  copyCard: { width: "100%", maxWidth: 420, backgroundColor: C.surface, borderRadius: 18, padding: 20, gap: 8 },
  copyTitle: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  copySub: { fontSize: 13, color: C.textSecondary, marginBottom: 8 },
  copyPills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  copyPill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border },
  copyPillSel: { backgroundColor: C.green, borderColor: C.green },
  copyPillText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  copyPillTextSel: { color: C.bg },
  copyConfirm: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  copyConfirmText: { fontSize: 15, fontWeight: "800", color: C.bg },
})
