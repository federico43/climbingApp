import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { ConsumeAuth } from "@/components/auth-context"
import { Ionicons } from "@expo/vector-icons"
import { groupByDate } from "@/utils/dateGroups"
import { amountLabel } from "@/utils/exerciseUnit"
import { ExerciseForm } from "@/components/ExerciseForm"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import { awaitNewRoute, cancelAwaitNewRoute } from "@/utils/pendingRouteSelection"
import { AiBlock, AssignmentSet, generatePlan } from "@/services/aiProtocol"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import {
  Adaptation,
  ADAPTATIONS,
  ADAPTATION_COLOR,
  ADAPTATION_LABEL,
  resolveAdaptation,
} from "@/utils/adaptations"

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")
import {
  AppUser,
  assignProtocol,
  BlockRow,
  createProtocol,
  deleteBlock,
  deleteProtocol,
  ExerciseRow,
  getAthletes,
  getSprayRoutes,
  getSprayWalls,
  SprayWallRow,
  listBlocks,
  listExercises,
  listProtocols,
  ProtocolRow,
  saveBlockToLibrary,
  upsertBlockTemplate,
  SprayRouteRow,
  updateProtocol,
} from "@/services/BoulderGraphService"
import { useRouter } from "expo-router"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator, Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text, TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockType = "project_bouldering" | "constraint_warmup" | "strength_conditioning" | "exploration_session" | "sequence" | "free_session" | "four_by_four"

interface BaseBlock {
  id: string
  type: BlockType
  blockName: string
  // Target training adaptation (technique/strength/power_endurance/...).
  // Optional — defaults are inferred from the block type in utils/adaptations.ts.
  adaptation?: string
}

interface ProjectBoulderingBlock extends BaseBlock {
  type: "project_bouldering"
  description: string; targetAttempts: number; restTime: number
}

interface ConstraintWarmupBlock extends BaseBlock {
  type: "constraint_warmup"
  description: string; level: string; targetAttempts: number
}

interface Exercise {
  id: string; type: "reps" | "both_sides" | "7/3s"; name: string; exerciseId?: string; unit?: "reps" | "seconds"; reps?: string; edge?: string; series?: number
}

interface StrengthConditioningBlock extends BaseBlock {
  type: "strength_conditioning"
  description: string; rounds: number; restBetweenRounds: number; exercises: Exercise[]
}

interface ExplorationSessionBlock extends BaseBlock {
  type: "exploration_session"
  description: string
  timeLimit?: number   // minutes, 0 = no timer
}

interface SequenceBlock extends BaseBlock {
  type: "sequence"
  description: string
  targetAttempts: number
  restTime: number
  routeId: string
  routeName: string
  routeHolds: string  // JSON stringified PlacedHold[]
  // Wall photo snapshot so the workout viewer can render it instantly (no
  // placeholder flash while the route → wall fetch resolves).
  wallImageUri?: string
  wallWidth?: number
  wallHeight?: number
}

interface FreeSessionBlock extends BaseBlock {
  type: "free_session"
  description: string
}

interface FourByFourBlock extends BaseBlock {
  type: "four_by_four"
  description: string
  sets: number            // number of sets (the first "4")
  bouldersPerSet: number  // boulders per set (the second "4")
  restTime: number        // rest between sets (seconds)
}

type Block = ProjectBoulderingBlock | ConstraintWarmupBlock | StrengthConditioningBlock | ExplorationSessionBlock | SequenceBlock | FreeSessionBlock | FourByFourBlock

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() { return Math.random().toString(36).slice(2) }

function makeDefaultBlock(type: BlockType, name: string = ""): Block {
  switch (type) {
    case "project_bouldering":
      return { id: generateId(), type, blockName: name, description: "", targetAttempts: 10, restTime: 120 }
    case "constraint_warmup":
      return { id: generateId(), type, blockName: name, description: "", level: "", targetAttempts: 1 }
    case "strength_conditioning":
      return { id: generateId(), type, blockName: name, description: "", rounds: 3, restBetweenRounds: 180, exercises: [] }
    case "exploration_session":
      return { id: generateId(), type, blockName: name, description: "", timeLimit: 0 }
    case "sequence":
      return { id: generateId(), type, blockName: name, description: "", targetAttempts: 5, restTime: 120, routeId: "", routeName: "", routeHolds: "[]" }
    case "free_session":
      return { id: generateId(), type, blockName: name, description: "" }
    case "four_by_four":
      return { id: generateId(), type, blockName: name, description: "", sets: 4, bouldersPerSet: 4, restTime: 240 }
  }
}

// Turn an AI-proposed block into a real editor Block. If it references a saved
// library block (and that id really exists), materialize the real saved block;
// otherwise start from the type's defaults and overlay the AI's fields.
function aiBlockToBlock(ab: AiBlock, libraryById?: Map<string, BlockRow>): Block {
  if (ab.libraryId && libraryById?.has(ab.libraryId)) {
    // Materialize the real saved block (keeps its description/content), then
    // overlay only the tunable fields the AI chose to override.
    const lib = blockFromLibraryRow(libraryById.get(ab.libraryId)!) as any
    if (ab.targetAttempts != null) lib.targetAttempts = ab.targetAttempts
    if (ab.restTime != null) lib.restTime = ab.restTime
    if (ab.level != null) lib.level = ab.level
    if (ab.timeLimit != null) lib.timeLimit = ab.timeLimit
    if (ab.adaptation) lib.adaptation = ab.adaptation
    return lib as Block
  }
  const base = makeDefaultBlock(ab.type, ab.blockName) as any
  base.description = ab.description
  if (ab.adaptation) base.adaptation = ab.adaptation
  if (ab.type === "project_bouldering") {
    base.targetAttempts = ab.targetAttempts ?? base.targetAttempts
    base.restTime = ab.restTime ?? base.restTime
  } else if (ab.type === "constraint_warmup") {
    base.targetAttempts = ab.targetAttempts ?? base.targetAttempts
    base.level = ab.level ?? base.level
  } else if (ab.type === "exploration_session") {
    base.timeLimit = ab.timeLimit ?? base.timeLimit
  } else if (ab.type === "sequence") {
    // routeId/routeName/routeHolds stay empty — the coach attaches the route.
    base.targetAttempts = ab.targetAttempts ?? base.targetAttempts
    base.restTime = ab.restTime ?? base.restTime
  }
  return base as Block
}

function stripLocalIds(blocks: Block[]): any[] {
  return blocks.map(({ id, ...rest }) => {
    if (rest.type === "strength_conditioning") {
      const sc = rest as Omit<StrengthConditioningBlock, "id">
      return { ...sc, exercises: sc.exercises.map(({ id: _eid, ...ex }) => ex) }
    }
    return rest
  })
}

function injectLocalIds(blocks: any[]): Block[] {
  return blocks.map((b) => ({
    ...b,
    id: generateId(),
    ...(b.type === "strength_conditioning"
      ? { exercises: (b.exercises ?? []).map((e: any) => ({ ...e, id: generateId() })) }
      : {}),
  }))
}

function blockFromLibraryRow(row: BlockRow): Block {
  const data = JSON.parse(row.data)
  return { ...data, id: generateId(), blockName: row.name }
}

const BLOCK_LABELS: Record<BlockType, string> = {
  project_bouldering: "Project bouldering",
  constraint_warmup: "Constraint warmup",
  strength_conditioning: "Strength & conditioning",
  exploration_session: "Boulder Logger",
  sequence: "Sequence",
  free_session: "Free session",
  four_by_four: "4×4",
}

const BLOCK_ICONS: Record<BlockType, keyof typeof Ionicons.glyphMap> = {
  project_bouldering: "flame",
  constraint_warmup: "thermometer",
  strength_conditioning: "barbell",
  exploration_session: "search",
  sequence: "footsteps",
  free_session: "time",
  four_by_four: "grid",
}

const BLOCK_DESCRIPTIONS: Record<BlockType, string> = {
  project_bouldering: "Work a single project with rest timers",
  constraint_warmup: "Climb with a movement constraint",
  strength_conditioning: "Rounds of exercises",
  exploration_session: "Log sends freely by grade",
  sequence: "Specific route on the spray wall",
  free_session: "Open-ended climbing time",
  four_by_four: "Sets of boulders for endurance",
}

// ─── Screen ───────────────────────────────────────────────────────────────────

type ScreenView = "list" | "editor"

export default function ProtocolDesignerScreen() {
  const router = useRouter()
  const { role } = ConsumeAuth()
  const workoutCtx = useWorkoutContext()
  const [view, setView] = useState<ScreenView>("list")
  const [protocols, setProtocols] = useState<ProtocolRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingProtocol, setEditingProtocol] = useState<ProtocolRow | null>(null)
  const [assigningProtocol, setAssigningProtocol] = useState<ProtocolRow | null>(null)
  const [athletes, setAthletes] = useState<AppUser[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(false)
  const [assigningTo, setAssigningTo] = useState<string | null>(null)

  useEffect(() => { fetchProtocols() }, [])

  async function fetchProtocols() {
    setLoading(true)
    try { setProtocols(await listProtocols()) }
    catch (e: any) { Alert.alert("Error", e?.message ?? "Could not load protocols.") }
    finally { setLoading(false) }
  }

  async function handleOpenAssign(protocol: ProtocolRow) {
    setAssigningProtocol(protocol)
    setLoadingAthletes(true)
    try { setAthletes(await getAthletes()) }
    catch (e: any) { Alert.alert("Error", e?.message ?? "Could not load athletes.") }
    finally { setLoadingAthletes(false) }
  }

  async function handleAssignToAthlete(athleteId: string) {
    if (!assigningProtocol) return
    setAssigningTo(athleteId)
    try {
      await assignProtocol(athleteId, assigningProtocol.$id)
      Alert.alert("Assigned", "Protocol assigned successfully.")
      setAssigningProtocol(null)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not assign protocol.")
    } finally { setAssigningTo(null) }
  }

  async function handleDeleteProtocol(id: string) {
    Alert.alert("Delete protocol", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { await deleteProtocol(id); fetchProtocols() } },
    ])
  }

  // Run the protocol yourself (as an athlete would) to sanity-check it. Opens
  // the workout overlay; nothing is logged against any athlete.
  function handleTestProtocol(p: ProtocolRow) {
    let blocks: any[] = []
    try { blocks = p.blocks ? JSON.parse(p.blocks) : [] } catch {}
    if (blocks.length === 0) {
      Alert.alert("Empty protocol", "This protocol has no blocks to test.")
      return
    }
    workoutCtx.openWorkout(blocks, p.name)
  }

  async function handleDuplicateProtocol(p: ProtocolRow) {
    const suffix = " (copy)"
    const maxLen = 16
    const base = p.name.slice(0, maxLen - suffix.length)
    const copyName = (base + suffix).slice(0, maxLen)
    try {
      await createProtocol({ name: copyName, blocks: JSON.parse(p.blocks ?? "[]") })
      fetchProtocols()
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not duplicate protocol.")
    }
  }

  if (view === "editor") {
    return (
      <ProtocolEditor
        protocol={editingProtocol}
        onDone={() => { setView("list"); fetchProtocols() }}
        onCancel={() => setView("list")}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safeContainer}>
      <View style={styles.listHeader}>
        <View style={styles.listHeaderLeft}>
          <Pressable style={styles.backButton} onPress={() => router.navigate("/(tabs)/(buttonTabs)/design" as any)}>
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Protocols</Text>
        </View>
        <View style={styles.listHeaderActions}>
          <Pressable style={styles.newButton} onPress={() => { setEditingProtocol(null); setView("editor") }}>
            <Text style={styles.newButtonText}>+ New</Text>
          </Pressable>
        </View>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} /> : protocols.length === 0 ? (
        <Text style={styles.emptyState}>No protocols yet. Create one!</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {groupByDate(protocols).map(({ group, items }) => (
            <View key={group} style={{ gap: 10, marginBottom: 14 }}>
              <Text style={styles.libraryGroupHeader}>{group}</Text>
              {items.map((p) => {
                const blocks = p.blocks ? JSON.parse(p.blocks) : []
                return (
                  <View key={p.$id} style={styles.protocolCard}>
                    <Pressable style={styles.protocolCardContent} onPress={() => { setEditingProtocol(p); setView("editor") }}>
                      <Text style={styles.protocolName}>{p.name}</Text>
                      <Text style={styles.protocolMeta}>{blocks.length} block{blocks.length !== 1 ? "s" : ""}</Text>
                    </Pressable>
                    <View style={styles.protocolActions}>
                      <Pressable style={styles.testButton} onPress={() => handleTestProtocol(p)}>
                        <Ionicons name="play" size={13} color={C.green} />
                        <Text style={styles.testButtonText}>Test</Text>
                      </Pressable>
                      <Pressable style={styles.assignButton} onPress={() => handleOpenAssign(p)}>
                        <Text style={styles.assignButtonText}>Assign</Text>
                      </Pressable>
                      <Pressable style={styles.duplicateButton} onPress={() => handleDuplicateProtocol(p)}>
                        <Text style={styles.duplicateButtonText}>⎘</Text>
                      </Pressable>
                      <Pressable style={styles.deleteButton} onPress={() => handleDeleteProtocol(p.$id)}>
                        <Text style={styles.deleteButtonText}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
                )
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Assign modal */}
      <Modal visible={assigningProtocol !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAssigningProtocol(null)}>
        <SafeAreaView style={styles.safeContainer}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setAssigningProtocol(null)} style={styles.iconBackBtn} hitSlop={10}>
              <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
            </Pressable>
            <Text style={[styles.modalTitle, { textAlign: "center", marginRight: 0 }]} numberOfLines={1}>
              Assign "{assigningProtocol?.name}"
            </Text>
            <View style={styles.iconBackBtn} />
          </View>
          {loadingAthletes ? <ActivityIndicator style={{ marginTop: 40 }} /> : athletes.length === 0 ? (
            <Text style={styles.emptyState}>No athletes found.</Text>
          ) : (
            <ScrollView>
              {athletes.map((athlete) => (
                <Pressable key={athlete.$id} style={styles.athleteRow} onPress={() => handleAssignToAthlete(athlete.$id)} disabled={assigningTo === athlete.$id}>
                  {assigningTo === athlete.$id ? <ActivityIndicator /> : (
                    <>
                      <Text style={styles.athleteName}>{athlete.username ?? athlete.$id}</Text>
                      {athlete.assignedProtocolId === assigningProtocol?.$id && (
                        <Text style={styles.assignedBadge}>Current</Text>
                      )}
                    </>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Protocol Editor ──────────────────────────────────────────────────────────

function ProtocolEditor({ protocol, onDone, onCancel }: { protocol: ProtocolRow | null; onDone: () => void; onCancel: () => void }) {
  const { width } = useWindowDimensions()
  const isWide = width >= 900   // PC / wide browser → permanent right sidebar
  const [name, setName] = useState(protocol?.name ?? "")
  const [blocks, setBlocks] = useState<Block[]>(protocol ? injectLocalIds(JSON.parse(protocol.blocks ?? "[]")) : [])
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)

  // AI draft flow
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState("")
  const [aiLoading, setAiLoading] = useState(false)
  const [assignmentSet, setAssignmentSet] = useState<AssignmentSet | null>(null)
  const [assignLibrary, setAssignLibrary] = useState<Map<string, BlockRow>>(new Map())

  function handleAddBlock(block: Block) {
    setBlocks((prev) => [...prev, block])
    setExpandedBlockId(block.id)
    setShowAddModal(false)
  }

  async function handleGenerate() {
    const prompt = aiPrompt.trim()
    if (!prompt) return
    setAiLoading(true)
    try {
      // Roster lets the AI assign per-athlete when names are mentioned; the
      // library lets it reuse saved blocks (by id) instead of always inventing.
      const [rosterRows, libraryRows] = await Promise.all([getAthletes(), listBlocks()])
      const roster = rosterRows.map((a) => ({ id: a.$id, name: a.username ?? a.$id }))
      const library = libraryRows.map((r) => {
        let description: string | undefined
        try { description = JSON.parse(r.data)?.description } catch {}
        return { id: r.$id, type: r.type, name: r.name, description }
      })
      const libraryById = new Map(libraryRows.map((r) => [r.$id, r]))

      const result = await generatePlan(prompt, blocks, roster, library)
      setAiOpen(false)
      setAiPrompt("")
      if (result.kind === "single") {
        const newBlocks = result.protocol.blocks.map((ab) => aiBlockToBlock(ab, libraryById))
        setBlocks((prev) => [...prev, ...newBlocks])
        if (!name.trim()) setName(result.protocol.name)
      } else {
        // Per-athlete plans → open the side-by-side assign editor.
        setAssignLibrary(libraryById)
        setAssignmentSet(result.set)
      }
    } catch (e: any) {
      Alert.alert("Couldn't generate", e?.message ?? "Please try again.")
    } finally {
      setAiLoading(false)
    }
  }

  function handleUpdateBlock(updatedBlock: Block) {
    setBlocks((prev) => prev.map((b) => (b.id === updatedBlock.id ? updatedBlock : b)))
  }

  function handleDeleteBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
    if (expandedBlockId === id) setExpandedBlockId(null)
  }

  // Reorder a block by swapping it with its neighbor (desktop ▲/▼ controls).
  function handleMoveBlock(index: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function handleSaveAsTemplate(block: Block) {
    if (!block.blockName?.trim()) {
      Alert.alert("Name required", "Give this block a name before saving as a template.")
      return
    }
    try {
      const { id, ...data } = block as any
      const { replaced } = await upsertBlockTemplate({
        name: block.blockName.trim(),
        type: block.type,
        data,
      })
      Alert.alert(
        replaced ? "Template updated" : "Template saved",
        replaced
          ? `Replaced existing "${block.blockName}" template.`
          : `Saved "${block.blockName}" to your block library.`
      )
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save template.")
    }
  }

  async function handleSave() {
    if (!name.trim()) { Alert.alert("Name required", "Please give this protocol a name."); return }
    setSaving(true)
    try {
      const payload = { name: name.trim(), blocks: stripLocalIds(blocks) }
      if (protocol) { await updateProtocol(protocol.$id, payload) } else { await createProtocol(payload) }
      onDone()
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save protocol.")
    } finally { setSaving(false) }
  }

  const renderItem = useCallback(({ item, drag, isActive }: RenderItemParams<Block>) => (
    <BlockEditorRow
      block={item}
      isExpanded={expandedBlockId === item.id}
      isActive={isActive}
      onToggleExpand={() => setExpandedBlockId((prev) => (prev === item.id ? null : item.id))}
      onDrag={drag}
      onUpdate={handleUpdateBlock}
      onDelete={() => handleDeleteBlock(item.id)}
      onSaveAsTemplate={() => handleSaveAsTemplate(item)}
    />
  ), [expandedBlockId])

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SafeAreaView style={styles.safeContainer}>
        <View style={styles.editorHeader}>
          <Pressable onPress={onCancel}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          <Text style={styles.editorTitle}>{protocol ? "Edit protocol" : "New protocol"}</Text>
          <Pressable onPress={handleSave} disabled={saving}><Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text></Pressable>
        </View>

        {/* Wide-screen split: protocol on left, block picker permanently on right.
            Narrow screen: single column, block picker opens as modal. */}
        <View style={isWide ? styles.splitRow : { flex: 1 }}>
          <View style={isWide ? styles.splitLeft : { flex: 1 }}>
            <TextInput
              style={styles.nameInput}
              placeholder="Protocol name"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#aaa"
            />
            <Pressable style={styles.aiGenerateBtn} onPress={() => setAiOpen(true)}>
              <Text style={styles.aiGenerateText}>✨  Generate with AI</Text>
            </Pressable>
            {isWide ? (
              // Desktop/web: DraggableFlatList doesn't scroll reliably here, so
              // use a plain ScrollView. Reordering is still available on touch
              // devices via the DraggableFlatList branch below.
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.blockList}
                keyboardShouldPersistTaps="handled"
              >
                {blocks.map((item, index) => (
                  <BlockEditorRow
                    key={item.id}
                    block={item}
                    isExpanded={expandedBlockId === item.id}
                    isActive={false}
                    onToggleExpand={() => setExpandedBlockId((prev) => (prev === item.id ? null : item.id))}
                    onDrag={() => {}}
                    onUpdate={handleUpdateBlock}
                    onDelete={() => handleDeleteBlock(item.id)}
                    onSaveAsTemplate={() => handleSaveAsTemplate(item)}
                    onMoveUp={index > 0 ? () => handleMoveBlock(index, -1) : undefined}
                    onMoveDown={index < blocks.length - 1 ? () => handleMoveBlock(index, 1) : undefined}
                  />
                ))}
              </ScrollView>
            ) : (
              <DraggableFlatList
                data={blocks}
                keyExtractor={(item) => item.id}
                onDragEnd={({ data }) => setBlocks(data)}
                renderItem={renderItem}
                contentContainerStyle={styles.blockList}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                ListFooterComponent={
                  <Pressable style={styles.addBlockButton} onPress={() => setShowAddModal(true)}>
                    <Text style={styles.addBlockText}>+ Add block</Text>
                  </Pressable>
                }
              />
            )}
          </View>

          {isWide && (
            <View style={styles.splitRight}>
              <BlockPickerModal
                onAdd={(b) => { handleAddBlock(b) }}
                onClose={() => {}}
                embedded
              />
            </View>
          )}
        </View>

        {/* Add block modal — only used on narrow screens */}
        {!isWide && (
          <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddModal(false)}>
            {showAddModal && (
              <BlockPickerModal onAdd={handleAddBlock} onClose={() => setShowAddModal(false)} />
            )}
          </Modal>
        )}

        {/* AI draft modal */}
        <Modal visible={aiOpen} animationType="fade" transparent onRequestClose={() => !aiLoading && setAiOpen(false)}>
          <KeyboardAvoidingView style={styles.aiOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.aiCard}>
              <Text style={styles.aiTitle}>Describe the session</Text>
              <Text style={styles.aiSub}>
                Plain language. Name athletes to assign per-person — e.g. “power-endurance day for Charlie and John, but warm up on blue for them; Mia gets a strength finisher.” Leave names out for a single protocol.
              </Text>
              <TextInput
                style={styles.aiInput}
                value={aiPrompt}
                onChangeText={setAiPrompt}
                placeholder="What's the session about?"
                placeholderTextColor={C.textMuted}
                multiline
                autoFocus
                editable={!aiLoading}
              />
              <View style={styles.aiActions}>
                <Pressable style={styles.aiCancel} onPress={() => !aiLoading && setAiOpen(false)} disabled={aiLoading}>
                  <Text style={styles.aiCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.aiGo, (!aiPrompt.trim() || aiLoading) && { opacity: 0.5 }]}
                  onPress={handleGenerate}
                  disabled={!aiPrompt.trim() || aiLoading}
                >
                  {aiLoading
                    ? <ActivityIndicator color={C.bg} />
                    : <Text style={styles.aiGoText}>Generate</Text>}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Per-athlete assign editor (side-by-side columns) */}
        <Modal visible={assignmentSet !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setAssignmentSet(null)}>
          {assignmentSet && (
            <AssignmentSetEditor
              set={assignmentSet}
              library={assignLibrary}
              onClose={() => setAssignmentSet(null)}
              onFinish={() => { setAssignmentSet(null); onDone() }}
            />
          )}
        </Modal>
      </SafeAreaView>
    </KeyboardAvoidingView>
  )
}

// ─── Assignment Set Editor — one editable protocol column per athlete ──────────

function AssignmentSetEditor({ set, library, onClose, onFinish }: { set: AssignmentSet; library: Map<string, BlockRow>; onClose: () => void; onFinish: () => void }) {
  const { width } = useWindowDimensions()
  const isWide = width >= 900
  const colWidth = isWide ? 360 : Math.max(280, width - 32)

  type Col = {
    athletes: { id: string; name: string }[]
    name: string
    blocks: Block[]
    assigned: boolean
    busy: boolean
  }

  const [cols, setCols] = useState<Col[]>(() =>
    set.groups.map((g) => ({
      athletes: g.athletes,
      name: g.protocolName,
      blocks: g.blocks.map((b) => aiBlockToBlock(b, library)),
      assigned: false,
      busy: false,
    }))
  )
  const [expanded, setExpanded] = useState<string | null>(null)
  // Measured height of the columns area — used to give each column a definite
  // height so its inner block list can scroll (percentage height is unreliable
  // inside a horizontal ScrollView).
  const [areaH, setAreaH] = useState(0)

  function patchCol(i: number, patch: Partial<Col>) {
    setCols((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function updateBlockIn(i: number, updated: Block) {
    setCols((prev) =>
      prev.map((c, idx) =>
        idx === i ? { ...c, blocks: c.blocks.map((b) => (b.id === updated.id ? updated : b)) } : c
      )
    )
  }
  function deleteBlockIn(i: number, id: string) {
    setCols((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, blocks: c.blocks.filter((b) => b.id !== id) } : c))
    )
  }

  async function assignCol(i: number) {
    const col = cols[i]
    if (col.assigned || col.busy) return
    if (!col.name.trim() || col.blocks.length === 0) {
      Alert.alert("Can't assign", "This protocol needs a name and at least one block.")
      return
    }
    patchCol(i, { busy: true })
    try {
      // One protocol row, assigned to everyone in the group.
      const protocol = await createProtocol({ name: col.name.trim(), blocks: stripLocalIds(col.blocks) })
      for (const a of col.athletes) {
        await assignProtocol(a.id, protocol.$id)
      }
      patchCol(i, { assigned: true, busy: false })
    } catch (e: any) {
      patchCol(i, { busy: false })
      Alert.alert("Couldn't assign", e?.message ?? "Please try again.")
    }
  }

  async function assignAll() {
    for (let i = 0; i < cols.length; i++) {
      if (!cols[i].assigned) await assignCol(i)
    }
  }

  const allAssigned = cols.every((c) => c.assigned)

  return (
    <SafeAreaView style={styles.safeContainer}>
      <View style={styles.editorHeader}>
        <Pressable onPress={allAssigned ? onFinish : onClose}><Text style={styles.cancelText}>{allAssigned ? "Done" : "Cancel"}</Text></Pressable>
        <Text style={styles.editorTitle}>Assign — {cols.length} group{cols.length !== 1 ? "s" : ""}</Text>
        <Pressable onPress={assignAll}><Text style={styles.saveText}>Assign all</Text></Pressable>
      </View>

      {set.unresolved.length > 0 && (
        <View style={styles.unresolvedBanner}>
          <Text style={styles.unresolvedText}>
            ⚠ Couldn't match: {set.unresolved.join(", ")}
          </Text>
        </View>
      )}

      <View style={{ flex: 1 }} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
      <ScrollView
        horizontal={isWide}
        style={{ flex: 1 }}
        contentContainerStyle={isWide ? styles.colRow : { padding: 12, gap: 16 }}
        showsHorizontalScrollIndicator={isWide}
      >
        {cols.map((col, i) => {
          const label = col.athletes.map((a) => a.name).join(", ")
          const blockRows = col.blocks.map((b) => (
            <BlockEditorRow
              key={b.id}
              block={b}
              isExpanded={expanded === `${i}:${b.id}`}
              isActive={false}
              onToggleExpand={() => setExpanded((p) => (p === `${i}:${b.id}` ? null : `${i}:${b.id}`))}
              onDrag={() => {}}
              onUpdate={(ub) => updateBlockIn(i, ub)}
              onDelete={() => deleteBlockIn(i, b.id)}
            />
          ))
          return (
          <View key={`col-${i}`} style={[styles.assignCol, { width: colWidth }, isWide && areaH ? { height: areaH - 32 } : null]}>
            <View style={styles.assignColHeader}>
              <Text style={styles.assignColName} numberOfLines={1}>{label}</Text>
              {col.assigned && <Text style={styles.assignedTag}>✓ Assigned</Text>}
            </View>
            <TextInput
              style={styles.assignNameInput}
              value={col.name}
              onChangeText={(v) => patchCol(i, { name: v })}
              placeholder="Protocol name"
              placeholderTextColor="#aaa"
              editable={!col.assigned}
            />
            {/* Wide: each column scrolls its own blocks (the page scrolls
                horizontally). Narrow: blocks flow in the outer vertical scroll. */}
            {isWide ? (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8, gap: 10 }} keyboardShouldPersistTaps="handled">
                {blockRows}
              </ScrollView>
            ) : (
              <View style={{ gap: 10 }}>{blockRows}</View>
            )}
            <Pressable
              style={[styles.assignColBtn, (col.assigned || col.busy) && { opacity: 0.5 }]}
              onPress={() => assignCol(i)}
              disabled={col.assigned || col.busy}
            >
              {col.busy
                ? <ActivityIndicator color={C.bg} />
                : <Text style={styles.assignColBtnText}>{col.assigned ? "Assigned" : `Assign to ${label}`}</Text>}
            </Pressable>
          </View>
          )
        })}
      </ScrollView>
      </View>
    </SafeAreaView>
  )
}

// ─── Block Picker Modal ───────────────────────────────────────────────────────

function BlockPickerModal({
  onAdd,
  onClose,
  embedded,
}: {
  onAdd: (block: Block) => void
  onClose: () => void
  /** When true, render without modal chrome (sidebar on PC). */
  embedded?: boolean
}) {
  const [tab, setTab] = useState<"library" | "new">("new")
  const [libraryBlocks, setLibraryBlocks] = useState<BlockRow[]>([])
  const [loadingLibrary, setLoadingLibrary] = useState(true)
  const [newBlockType, setNewBlockType] = useState<BlockType | null>(null)
  const [librarySearch, setLibrarySearch] = useState("")

  useEffect(() => {
    async function fetch() {
      try { setLibraryBlocks(await listBlocks()) }
      catch (e) { console.error(e) }
      finally { setLoadingLibrary(false) }
    }
    fetch()
  }, [])

  function handlePickFromLibrary(row: BlockRow) {
    onAdd(blockFromLibraryRow(row))
  }

  async function handleDeleteFromLibrary(id: string) {
  Alert.alert("Delete block", "Remove this block from the library?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Delete",
      style: "destructive",
      onPress: async () => {
        try {
          await deleteBlock(id)
          setLibraryBlocks((prev) => prev.filter((b) => b.$id !== id))
        } catch (e: any) {
          Alert.alert("Error", e?.message ?? "Could not delete block.")
        }
      },
    },
  ])
}

  async function handleSaveNew(block: Block, saveToLibrary: boolean) {
    if (saveToLibrary) {
      const { id, ...data } = block
      await saveBlockToLibrary({ name: block.blockName, type: block.type, data })
    }
    onAdd(block)
  }

  const Container: any = embedded ? View : SafeAreaView
  return (
    <Container style={styles.safeContainer}>
      <View style={styles.modalHeader}>
        {embedded ? (
          <View style={styles.iconBackBtn} />
        ) : (
          <Pressable onPress={onClose} style={styles.iconBackBtn} hitSlop={10}>
            <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
          </Pressable>
        )}
        <Text style={[styles.modalTitle, { textAlign: "center", marginRight: 0 }]}>Add block</Text>
        <View style={styles.iconBackBtn} />
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <Pressable style={[styles.tab, tab === "library" && styles.tabActive]} onPress={() => setTab("library")}>
          <Text style={[styles.tabText, tab === "library" && styles.tabTextActive]}>From library</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === "new" && styles.tabActive]} onPress={() => setTab("new")}>
          <Text style={[styles.tabText, tab === "new" && styles.tabTextActive]}>New block</Text>
        </Pressable>
      </View>

      {tab === "library" ? (
        loadingLibrary ? <ActivityIndicator style={{ marginTop: 40 }} /> : libraryBlocks.length === 0 ? (
          <Text style={styles.emptyState}>No blocks in library yet.</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
            {/* Search bar */}
            <View style={styles.librarySearchWrap}>
              <Ionicons name="search" size={16} color={C.textMuted} />
              <TextInput
                value={librarySearch}
                onChangeText={setLibrarySearch}
                placeholder="Search block library"
                placeholderTextColor={C.textMuted}
                style={styles.librarySearchInput}
              />
              {!!librarySearch && (
                <Pressable onPress={() => setLibrarySearch("")} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color={C.textMuted} />
                </Pressable>
              )}
            </View>
            {(() => {
              // Apply search filter, then group by type
              const q = librarySearch.trim().toLowerCase()
              const filtered = q
                ? libraryBlocks.filter((b) =>
                    b.name.toLowerCase().includes(q) ||
                    (BLOCK_LABELS[b.type as BlockType] ?? "").toLowerCase().includes(q)
                  )
                : libraryBlocks
              const grouped: Record<string, BlockRow[]> = {}
              for (const row of filtered) {
                if (!grouped[row.type]) grouped[row.type] = []
                grouped[row.type].push(row)
              }
              const orderedTypes = (Object.keys(BLOCK_LABELS) as BlockType[]).filter(
                (t) => grouped[t]?.length > 0
              )
              if (orderedTypes.length === 0) {
                return <Text style={styles.emptyState}>No blocks match.</Text>
              }
              return orderedTypes.map((type) => (
                <View key={type} style={{ marginBottom: 18 }}>
                  <Text style={styles.libraryGroupHeader}>{BLOCK_LABELS[type]}</Text>
                  <View style={styles.libraryGrid}>
                    {grouped[type].map((row) => (
                      <Pressable
                        key={row.$id}
                        style={styles.libraryCard}
                        onPress={() => handlePickFromLibrary(row)}
                      >
                        <View style={styles.libraryCardRow}>
                          <Ionicons
                            name={BLOCK_ICONS[row.type as BlockType]}
                            size={16}
                            color={C.green}
                          />
                          <Text style={styles.libraryCardName} numberOfLines={2}>
                            {row.name}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => handleDeleteFromLibrary(row.$id)}
                          style={styles.libraryCardDelete}
                          hitSlop={8}
                        >
                          <Ionicons name="close" size={14} color={C.textMuted} />
                        </Pressable>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            })()}
          </ScrollView>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
          {newBlockType === null ? (
            <>
              <Text style={styles.pickerPrompt}>Choose a block type</Text>
              <View style={styles.blockTypeGrid}>
                {(["project_bouldering", "constraint_warmup", "strength_conditioning", "exploration_session", "sequence", "four_by_four", "free_session"] as BlockType[]).map((type) => (
                  <Pressable key={type} style={styles.blockTypeCard} onPress={() => setNewBlockType(type)}>
                    <View style={styles.blockTypeIconWrap}>
                      <Ionicons name={BLOCK_ICONS[type]} size={22} color={C.green} />
                    </View>
                    <Text style={styles.blockTypeCardLabel}>{BLOCK_LABELS[type]}</Text>
                    <Text style={styles.blockTypeCardDesc}>{BLOCK_DESCRIPTIONS[type]}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <NewBlockForm
              type={newBlockType}
              onBack={() => setNewBlockType(null)}
              onSave={handleSaveNew}
            />
          )}
        </ScrollView>
      )}
    </Container>
  )
}

// ─── New Block Form ───────────────────────────────────────────────────────────

function NewBlockForm({ type, onBack, onSave }: {
  type: BlockType
  onBack: () => void
  onSave: (block: Block, saveToLibrary: boolean) => Promise<void>
}) {
  const [block, setBlock] = useState<Block>(makeDefaultBlock(type))
  const [saveToLibrary, setSaveToLibrary] = useState(true)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!block.blockName.trim()) { Alert.alert("Name required", "Give this block a name."); return }
    setSaving(true)
    try { await onSave(block, saveToLibrary) }
    catch (e: any) { Alert.alert("Error", e?.message ?? "Could not save block.") }
    finally { setSaving(false) }
  }

  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={onBack} style={[styles.iconBackBtn, { marginBottom: 8 }]} hitSlop={10}>
        <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
      </Pressable>

      <View style={styles.newBlockTypeHeader}>
        <Ionicons name={BLOCK_ICONS[type]} size={18} color={C.green} />
        <Text style={styles.newBlockTypeHeaderText}>{BLOCK_LABELS[type]}</Text>
      </View>

      <Text style={styles.fieldLabel}>Block name</Text>
      <TextInput
        style={styles.fieldInput}
        placeholder="e.g. Silent Feet warmup"
        value={block.blockName}
        onChangeText={(v) => setBlock((b) => ({ ...b, blockName: v }))}
        placeholderTextColor="#aaa"
      />

      {type === "project_bouldering" && (
        <ProjectBoulderingFields block={block as ProjectBoulderingBlock} onUpdate={setBlock} />
      )}
      {type === "constraint_warmup" && (
        <ConstraintWarmupFields block={block as ConstraintWarmupBlock} onUpdate={setBlock} />
      )}
      {type === "strength_conditioning" && (
        <StrengthConditioningFields block={block as StrengthConditioningBlock} onUpdate={setBlock} />
      )}
      {type === "exploration_session" && (
        <ExplorationSessionFields block={block as ExplorationSessionBlock} onUpdate={setBlock} />
      )}
      {type === "sequence" && (
        <SequenceFields block={block as SequenceBlock} onUpdate={setBlock} />
      )}
      {type === "four_by_four" && (
        <FourByFourFields block={block as FourByFourBlock} onUpdate={setBlock} />
      )}
      {type === "free_session" && (
        <>
          <FieldLabel label="Description" />
          <FieldInput
            value={(block as FreeSessionBlock).description}
            onChange={(v) => setBlock({ ...(block as FreeSessionBlock), description: v })}
            placeholder="What will athletes do during this session?"
            multiline
          />
        </>
      )}

      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>Save to library</Text>
        <Switch value={saveToLibrary} onValueChange={setSaveToLibrary} />
      </View>

      <CustomButton title={saving ? "Saving…" : "Add to protocol"} onPress={handleSave} />
    </View>
  )
}

// ─── Block Editor Row ─────────────────────────────────────────────────────────

function BlockEditorRow({ block, isExpanded, isActive, onToggleExpand, onDrag, onUpdate, onDelete, onSaveAsTemplate, onMoveUp, onMoveDown }: {
  block: Block; isExpanded: boolean; isActive: boolean
  onToggleExpand: () => void; onDrag: () => void; onUpdate: (b: Block) => void; onDelete: () => void
  onSaveAsTemplate?: () => void
  // Desktop reorder controls. When provided, replace the touch drag handle with
  // ▲/▼ buttons; an undefined callback means that direction is disabled (ends).
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const reorderButtons = onMoveUp !== undefined || onMoveDown !== undefined
  return (
    <View style={[styles.blockRow, isActive && styles.blockRowActive]}>
      <View style={styles.blockRowHeader}>
        {reorderButtons ? (
          <View style={styles.moveButtons}>
            <Pressable onPress={onMoveUp} disabled={!onMoveUp} style={styles.moveButton} hitSlop={6}>
              <Text style={[styles.moveButtonText, !onMoveUp && styles.moveButtonDisabled]}>▲</Text>
            </Pressable>
            <Pressable onPress={onMoveDown} disabled={!onMoveDown} style={styles.moveButton} hitSlop={6}>
              <Text style={[styles.moveButtonText, !onMoveDown && styles.moveButtonDisabled]}>▼</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onLongPress={onDrag} style={styles.dragHandle}>
            <Text style={styles.dragHandleText}>☰</Text>
          </Pressable>
        )}
        <Pressable style={styles.blockRowTitle} onPress={onToggleExpand}>
          <View>
            <Text style={styles.blockTypeLabel}>{block.blockName || BLOCK_LABELS[block.type]}</Text>
            <Text style={styles.blockTypeSubLabel}>{BLOCK_LABELS[block.type]}</Text>
          </View>
          <Text style={styles.expandChevron}>{isExpanded ? "▲" : "▼"}</Text>
        </Pressable>
        <Pressable onPress={onDelete} style={styles.blockDeleteButton}>
          <Text style={styles.deleteButtonText}>✕</Text>
        </Pressable>
      </View>
      {isExpanded && (
        <View style={styles.blockFields}>
          <Text style={styles.fieldLabel}>Block name</Text>
          <TextInput
            style={styles.fieldInput}
            value={block.blockName}
            onChangeText={(v) => onUpdate({ ...block, blockName: v })}
            placeholderTextColor="#aaa"
            placeholder="Block name"
          />
          <Text style={styles.fieldLabel}>Adaptation</Text>
          <AdaptationPicker
            value={resolveAdaptation(block)}
            onChange={(v) => onUpdate({ ...block, adaptation: v })}
          />
          {block.type === "project_bouldering" && <ProjectBoulderingFields block={block} onUpdate={onUpdate} />}
          {block.type === "constraint_warmup" && <ConstraintWarmupFields block={block} onUpdate={onUpdate} />}
          {block.type === "strength_conditioning" && <StrengthConditioningFields block={block} onUpdate={onUpdate} />}
          {block.type === "exploration_session" && <ExplorationSessionFields block={block} onUpdate={onUpdate} />}
          {block.type === "sequence" && <SequenceFields block={block as SequenceBlock} onUpdate={onUpdate} />}
          {block.type === "four_by_four" && <FourByFourFields block={block as FourByFourBlock} onUpdate={onUpdate} />}
          {block.type === "free_session" && (
            <>
              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.fieldInput, { minHeight: 72, textAlignVertical: "top" }]}
                value={(block as FreeSessionBlock).description}
                onChangeText={(v) => onUpdate({ ...block, description: v } as FreeSessionBlock)}
                placeholder="What will athletes do during this session?"
                placeholderTextColor="#aaa"
                multiline
              />
            </>
          )}

          {onSaveAsTemplate && (
            <Pressable style={styles.saveTemplateBtn} onPress={onSaveAsTemplate}>
              <Text style={styles.saveTemplateBtnText}>Save as template</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  )
}

// ─── Field Components ─────────────────────────────────────────────────────────

function AdaptationPicker({
  value,
  onChange,
}: {
  value: Adaptation
  onChange: (v: Adaptation) => void
}) {
  return (
    <View style={styles.adaptationRow}>
      {ADAPTATIONS.map((a) => {
        const selected = value === a
        const color = ADAPTATION_COLOR[a]
        return (
          <Pressable
            key={a}
            onPress={() => onChange(a)}
            style={[
              styles.adaptationChip,
              selected && { backgroundColor: color, borderColor: color },
            ]}
          >
            <View
              style={[
                styles.adaptationDot,
                { backgroundColor: color },
                selected && { backgroundColor: C.bg },
              ]}
            />
            <Text style={[styles.adaptationChipText, selected && { color: C.bg, fontWeight: "700" }]}>
              {ADAPTATION_LABEL[a]}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function GradePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <View style={styles.adaptationRow}>
      {BoulderLevelOptions.map((g) => {
        const selected = value === g.value
        return (
          <Pressable
            key={g.value}
            onPress={() => onChange(g.value)}
            style={[
              styles.adaptationChip,
              selected && { backgroundColor: g.color, borderColor: g.color },
            ]}
          >
            <View
              style={[
                styles.gradeDot,
                { backgroundColor: g.color },
                selected && { backgroundColor: g.on },
              ]}
            />
            <Text style={[styles.adaptationChipText, selected && { color: g.on, fontWeight: "700" }]}>
              {g.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>
}

function FieldInput({ value, onChange, placeholder, numeric, multiline }: {
  value: string; onChange: (v: string) => void; placeholder?: string; numeric?: boolean; multiline?: boolean
}) {
  return (
    <TextInput
      style={[styles.fieldInput, multiline && styles.fieldInputMultiline]}
      value={value} onChangeText={onChange} placeholder={placeholder}
      placeholderTextColor="#aaa" keyboardType={numeric ? "numeric" : "default"} multiline={multiline}
    />
  )
}

function ProjectBoulderingFields({ block, onUpdate }: { block: ProjectBoulderingBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<ProjectBoulderingBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <FieldLabel label="Target attempts" /><FieldInput value={String(block.targetAttempts)} onChange={(v) => update({ targetAttempts: parseInt(v) || 0 })} numeric />
      <FieldLabel label="Rest time (seconds)" /><FieldInput value={String(block.restTime)} onChange={(v) => update({ restTime: parseInt(v) || 0 })} numeric />
    </>
  )
}

function FourByFourFields({ block, onUpdate }: { block: FourByFourBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<FourByFourBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <FieldLabel label="Sets" /><FieldInput value={String(block.sets)} onChange={(v) => update({ sets: parseInt(v) || 0 })} numeric />
      <FieldLabel label="Boulders per set" /><FieldInput value={String(block.bouldersPerSet)} onChange={(v) => update({ bouldersPerSet: parseInt(v) || 0 })} numeric />
      <FieldLabel label="Rest between sets (seconds)" /><FieldInput value={String(block.restTime)} onChange={(v) => update({ restTime: parseInt(v) || 0 })} numeric />
    </>
  )
}

function ConstraintWarmupFields({ block, onUpdate }: { block: ConstraintWarmupBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<ConstraintWarmupBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <FieldLabel label="Grade" /><GradePicker value={block.level} onChange={(v) => update({ level: v })} />
      <FieldLabel label="Target attempts" /><FieldInput value={String(block.targetAttempts)} onChange={(v) => update({ targetAttempts: parseInt(v) || 0 })} numeric />
    </>
  )
}

function StrengthConditioningFields({ block, onUpdate }: { block: StrengthConditioningBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<StrengthConditioningBlock>) { onUpdate({ ...block, ...fields }) }

  function handleAddExercise(type: "reps" | "both_sides" | "7/3s") {
    const newEx: Exercise =
      type === "reps" ? { id: generateId(), type: "reps", name: "", reps: "4-6" }
      : type === "both_sides" ? { id: generateId(), type: "both_sides", name: "", reps: "4-6" }
      : { id: generateId(), type: "7/3s", name: "7/3s", edge: "20mm", series: 6 }
    update({ exercises: [...block.exercises, newEx] })
  }

  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <FieldLabel label="Rounds" /><FieldInput value={String(block.rounds)} onChange={(v) => update({ rounds: parseInt(v) || 0 })} numeric />
      <FieldLabel label="Rest between rounds (seconds)" /><FieldInput value={String(block.restBetweenRounds)} onChange={(v) => update({ restBetweenRounds: parseInt(v) || 0 })} numeric />
      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Exercises</Text>
      {block.exercises.map((ex) => (
        <ExerciseEditorRow
          key={ex.id} exercise={ex}
          onUpdate={(updated) => update({ exercises: block.exercises.map((e) => (e.id === updated.id ? updated : e)) })}
          onDelete={() => update({ exercises: block.exercises.filter((e) => e.id !== ex.id) })}
        />
      ))}
      <View style={styles.exerciseTypeRow}>
        <Pressable style={styles.addExerciseButton} onPress={() => handleAddExercise("reps")}><Text style={styles.addExerciseText}>+ Reps</Text></Pressable>
        <Pressable style={styles.addExerciseButton} onPress={() => handleAddExercise("both_sides")}><Text style={styles.addExerciseText}>+ Both sides</Text></Pressable>
        <Pressable style={styles.addExerciseButton} onPress={() => handleAddExercise("7/3s")}><Text style={styles.addExerciseText}>+ 7/3s</Text></Pressable>
      </View>
    </>
  )
}

function ExplorationSessionFields({ block, onUpdate }: { block: ExplorationSessionBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<ExplorationSessionBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" />
      <FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline placeholder="What should athletes know before starting?" />
      <FieldLabel label="Time limit (minutes, 0 = no timer)" />
      <FieldInput value={String(block.timeLimit ?? 0)} onChange={(v) => update({ timeLimit: parseInt(v) || 0 })} numeric placeholder="0" />
    </>
  )
}


function ExerciseEditorRow({ exercise, onUpdate, onDelete }: { exercise: Exercise; onUpdate: (e: Exercise) => void; onDelete: () => void }) {
  function update(fields: Partial<Exercise>) { onUpdate({ ...exercise, ...fields }) }
  const typeLabel = exercise.type === "reps" ? "Reps" : exercise.type === "both_sides" ? "Both sides" : "7/3s"
  const [showPicker, setShowPicker] = useState(false)

  return (
    <View style={styles.exerciseRow}>
      <View style={styles.exerciseRowHeader}>
        <Text style={styles.exerciseTypeTag}>{typeLabel}</Text>
        <Pressable onPress={onDelete}><Text style={styles.deleteButtonText}>✕</Text></Pressable>
      </View>

      {/* Exercise name picker */}
      <Pressable style={styles.exercisePickerButton} onPress={() => setShowPicker(true)}>
        <Text style={exercise.name ? styles.exercisePickerName : styles.exercisePickerPlaceholder}>
          {exercise.name || "Select exercise →"}
        </Text>
      </Pressable>

      {(exercise.type === "reps" || exercise.type === "both_sides") && (
        <>
          <FieldLabel label={exercise.unit === "seconds" ? "Seconds" : "Reps"} />
          <FieldInput value={exercise.reps ?? ""} onChange={(v) => update({ reps: v })} placeholder={exercise.unit === "seconds" ? "20-30" : "4-6"} />
        </>
      )}
      {exercise.type === "7/3s" && (
        <>
          <FieldLabel label="Edge size" /><FieldInput value={exercise.edge ?? ""} onChange={(v) => update({ edge: v })} placeholder="20mm" />
          <FieldLabel label="Series" /><FieldInput value={String(exercise.series ?? 6)} onChange={(v) => update({ series: parseInt(v) || 0 })} numeric />
        </>
      )}

      <Modal visible={showPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPicker(false)}>
        <ExercisePickerModal
          exerciseType={exercise.type}
          onSelect={(ex) => {
            update({
              name: ex.name,
              exerciseId: ex.$id,
              unit: ex.unit ?? "reps",
              ...(ex.defaultReps ? { reps: ex.defaultReps } : {}),
              ...(ex.defaultEdge ? { edge: ex.defaultEdge } : {}),
              ...(ex.defaultSeries ? { series: ex.defaultSeries } : {}),
            })
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      </Modal>
    </View>
  )
}

// ─── Sequence Fields ──────────────────────────────────────────────────────────

function SequenceFields({ block, onUpdate }: { block: SequenceBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<SequenceBlock>) { onUpdate({ ...block, ...fields }) }
  const router = useRouter()
  const [showRoutePicker, setShowRoutePicker] = useState(false)

  function selectRoute(route: SprayRouteRow, wall?: SprayWallRow) {
    update({
      routeId: route.$id, routeName: route.name, routeHolds: route.holds,
      ...(wall?.imageUri ? { wallImageUri: wall.imageUri } : {}),
      ...(wall?.width && wall?.height ? { wallWidth: wall.width, wallHeight: wall.height } : {}),
    })
    setShowRoutePicker(false)
  }

  // Build a new route on the spray-wall screen, then come back. The builder
  // publishes its result through the route bus: a saved route auto-selects
  // itself; backing out reopens the picker so an existing route can be chosen.
  function handleCreateNew(wall?: { id: string; imageUri?: string }) {
    setShowRoutePicker(false)
    awaitNewRoute((route) => {
      if (route) selectRoute(route)
      else setShowRoutePicker(true)
    })
    router.push({
      pathname: "/(tabs)/(buttonTabs)/sprayWallBuilder",
      params: {
        _new: Date.now().toString(),
        from: "protocolPicker",
        ...(wall ? { wallId: wall.id, wallImageUri: wall.imageUri ?? "" } : {}),
      },
    })
  }

  // If this field unmounts mid-flow (block collapsed/deleted), drop the listener
  // so a later builder result doesn't fire into a dead component.
  useEffect(() => cancelAwaitNewRoute, [])

  return (
    <>
      <FieldLabel label="Description" />
      <FieldInput
        value={block.description}
        onChange={(v) => update({ description: v })}
        multiline
        placeholder="What should athletes know before starting?"
      />
      <FieldLabel label="Target attempts" />
      <FieldInput value={String(block.targetAttempts)} onChange={(v) => update({ targetAttempts: parseInt(v) || 0 })} numeric />
      <FieldLabel label="Rest between attempts (seconds)" />
      <FieldInput value={String(block.restTime)} onChange={(v) => update({ restTime: parseInt(v) || 0 })} numeric />
      <FieldLabel label="Sequence route" />
      <Pressable style={styles.exercisePickerButton} onPress={() => setShowRoutePicker(true)}>
        <Text style={block.routeName ? styles.exercisePickerName : styles.exercisePickerPlaceholder}>
          {block.routeName || "Select route →"}
        </Text>
      </Pressable>

      <Modal visible={showRoutePicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRoutePicker(false)}>
        <RoutePickerModal
          onSelect={selectRoute}
          onClose={() => setShowRoutePicker(false)}
          onCreateNew={handleCreateNew}
        />
      </Modal>
    </>
  )
}

// ─── Route Picker Modal ───────────────────────────────────────────────────────

function RoutePickerModal({ onSelect, onClose, onCreateNew }: {
  onSelect: (route: SprayRouteRow, wall?: SprayWallRow) => void
  onClose: () => void
  onCreateNew: (wall?: { id: string; imageUri?: string }) => void
}) {
  const [routes, setRoutes] = useState<SprayRouteRow[]>([])
  const [walls, setWalls] = useState<SprayWallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [wallPickerVisible, setWallPickerVisible] = useState(false)

  // A new route must live on a wall: use the only wall, prompt to choose when
  // there are several, or proceed wall-less if none exist yet.
  function startCreateNew() {
    if (walls.length === 0) { onCreateNew(); return }
    if (walls.length === 1) { onCreateNew({ id: walls[0].$id, imageUri: walls[0].imageUri }); return }
    setWallPickerVisible(true)
  }

  useEffect(() => {
    Promise.all([getSprayRoutes(), getSprayWalls()])
      .then(([r, w]) => { setRoutes(r); setWalls(w) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Parse holds once per load (not on every render) and index walls by id so
  // each card is an O(1) lookup instead of a JSON.parse + walls.find.
  const holdsByRoute = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const r of routes) {
      try { m.set(r.$id, JSON.parse(r.holds)) } catch { m.set(r.$id, []) }
    }
    return m
  }, [routes])
  const wallsById = useMemo(() => new Map(walls.map((w) => [w.$id, w])), [walls])
  function routeImageSource(route: SprayRouteRow) {
    const uri = route.wallId ? wallsById.get(route.wallId)?.imageUri : undefined
    return uri ? { uri } : WALL_IMAGE
  }

  return (
    <SafeAreaView style={styles.safeContainer}>
      <View style={styles.modalHeader}>
        <Pressable onPress={onClose} style={styles.iconBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
        </Pressable>
        <Text style={[styles.modalTitle, { textAlign: "center", marginRight: 0 }]}>Select route</Text>
        <View style={styles.iconBackBtn} />
      </View>

      <Pressable style={styles.createNewRow} onPress={startCreateNew}>
        <View style={styles.createNewIconWrap}>
          <Ionicons name="add" size={20} color={C.green} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.createNewLabel}>Create new route</Text>
          <Text style={styles.createNewSub}>Build a sequence on the spray wall</Text>
        </View>
      </Pressable>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : routes.length === 0 ? (
        <Text style={styles.emptyState}>No routes saved yet.</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {routes.map((route) => {
            const holds = holdsByRoute.get(route.$id) ?? []
            return (
              <Pressable
                key={route.$id}
                style={styles.routePickerCard}
                onPress={() => onSelect(route, wallsById.get(route.wallId ?? ""))}
              >
                <View style={styles.routePickerThumb}>
                  <SprayWallViewer
                    imageSource={routeImageSource(route)}
                    holds={holds}
                    style={{ flex: 1 }}
                    interactive={false}
                    previewWidth={500}
                    naturalSize={(() => { const w = wallsById.get(route.wallId ?? ""); return w?.width && w?.height ? { w: w.width, h: w.height } : null })()}
                  />
                </View>
                <View style={styles.routePickerBody}>
                  <Text style={styles.exercisePickerRowName} numberOfLines={1}>{route.name}</Text>
                  <Text style={styles.exercisePickerRowMeta}>
                    {holds.length} hold{holds.length !== 1 ? "s" : ""} · {new Date(route.$createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
              </Pressable>
            )
          })}
        </ScrollView>
      )}

      {/* Wall chooser — a new route must live on a wall */}
      <Modal visible={wallPickerVisible} transparent animationType="fade" onRequestClose={() => setWallPickerVisible(false)}>
        <Pressable style={styles.aiOverlay} onPress={() => setWallPickerVisible(false)}>
          <Pressable style={styles.aiCard} onPress={() => {}}>
            <Text style={styles.aiTitle}>Add route to which wall?</Text>
            <Text style={styles.aiSub}>A route lives on a wall — pick one.</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {walls.map((wall) => (
                <Pressable
                  key={wall.$id}
                  style={styles.wallPickRow}
                  onPress={() => { setWallPickerVisible(false); onCreateNew({ id: wall.$id, imageUri: wall.imageUri }) }}
                >
                  <Text style={styles.wallPickName} numberOfLines={1}>{wall.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Exercise Picker Modal ────────────────────────────────────────────────────

const EXERCISE_TYPE_LABEL: Record<"reps" | "both_sides" | "7/3s", string> = {
  reps: "Reps", both_sides: "Both sides", "7/3s": "7/3s",
}

function ExercisePickerModal({
  exerciseType,
  onSelect,
  onClose,
}: {
  exerciseType: "reps" | "both_sides" | "7/3s"
  onSelect: (ex: ExerciseRow) => void
  onClose: () => void
}) {
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<"list" | "create">("list")

  useEffect(() => {
    listExercises()
      .then((all) => setExercises(all.filter((e) => e.type === exerciseType)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (mode === "create") {
    return (
      <ExerciseForm
        fixedType={exerciseType}
        title={`New ${EXERCISE_TYPE_LABEL[exerciseType]} exercise`}
        saveLabel="Create & select"
        onCancel={() => setMode("list")}
        onCreated={(ex) => onSelect(ex)}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safeContainer}>
      <View style={styles.modalHeader}>
        <Pressable onPress={onClose} style={styles.iconBackBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
        </Pressable>
        <Text style={[styles.modalTitle, { textAlign: "center", marginRight: 0 }]}>Select exercise</Text>
        <View style={styles.iconBackBtn} />
      </View>

      <Pressable style={styles.createNewRow} onPress={() => setMode("create")}>
        <View style={styles.createNewIconWrap}>
          <Ionicons name="add" size={20} color={C.green} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.createNewLabel}>Create new exercise</Text>
          <Text style={styles.createNewSub}>Add a {EXERCISE_TYPE_LABEL[exerciseType]} exercise to your library</Text>
        </View>
      </Pressable>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : exercises.length === 0 ? (
        <Text style={styles.emptyState}>No {EXERCISE_TYPE_LABEL[exerciseType]} exercises yet. Create one above.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {exercises.map((ex) => (
            <Pressable key={ex.$id} style={styles.exercisePickerRow} onPress={() => onSelect(ex)}>
              <Text style={styles.exercisePickerRowName}>{ex.name}</Text>
              {(ex.defaultReps || ex.defaultEdge) && (
                <Text style={styles.exercisePickerRowMeta}>
                  {ex.defaultReps ? amountLabel(ex.defaultReps, ex.unit) : ""}
                  {ex.defaultEdge ? `${ex.defaultEdge}` : ""}
                  {ex.defaultSeries ? ` · ${ex.defaultSeries} series` : ""}
                </Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}


// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: C.bg },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  listHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  backButton: { paddingRight: 4 },
  backButtonText: { fontSize: 34, color: C.textSecondary, lineHeight: 36 },
  title: { fontSize: 26, fontWeight: "700", color: C.textPrimary },
  newButton: { backgroundColor: C.green, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  newButtonText: { color: C.bg, fontWeight: "600", fontSize: 14 },
  listContent: { paddingHorizontal: 20, gap: 12, paddingBottom: 40 },
  emptyState: { textAlign: "center", marginTop: 60, color: C.textMuted, fontSize: 15 },
  protocolCard: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 14, padding: 16, gap: 10 },
  protocolCardContent: { flex: 1 },
  protocolName: { fontSize: 16, fontWeight: "600", color: C.textPrimary },
  protocolMeta: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  protocolActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  assignButton: { backgroundColor: C.green, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  assignButtonText: { color: C.bg, fontSize: 13, fontWeight: "600" },
  testButton: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    borderWidth: 1, borderColor: C.green,
  },
  testButtonText: { color: C.green, fontSize: 13, fontWeight: "600" },
  deleteButton: { padding: 8 },
  deleteButtonText: { fontSize: 14, color: C.textMuted },
  duplicateButton: { padding: 8 },
  duplicateButtonText: { fontSize: 18, color: C.textMuted },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 17, fontWeight: "600", flex: 1, marginRight: 12, color: C.textPrimary },
  athleteRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  athleteName: { fontSize: 16, color: C.textPrimary },
  assignedBadge: { fontSize: 12, color: C.green, fontWeight: "600", backgroundColor: C.surface, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tabRow: { flexDirection: "row", paddingHorizontal: 20, paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center", backgroundColor: C.surfaceHigh },
  tabActive: { backgroundColor: C.green },
  tabText: { fontSize: 14, fontWeight: "500", color: C.textSecondary },
  tabTextActive: { color: C.bg },
  libraryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8 },
  libraryBlockName: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  librarySearchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surface, borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 14,
  },
  librarySearchInput: {
    flex: 1, color: C.textPrimary, fontSize: 14,
    paddingVertical: 10, padding: 0,
  },
  libraryGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 10,
  },
  libraryCard: {
    width: "48%",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 12, gap: 8, minHeight: 60,
  },
  libraryCardRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingRight: 20,  // leave room for the delete icon
  },
  libraryCardName: {
    fontSize: 13, fontWeight: "600", color: C.textPrimary,
    flex: 1,
  },
  libraryCardDelete: {
    position: "absolute", top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
  },
  libraryGroupHeader: {
    fontSize: 12, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, paddingHorizontal: 4,
  },
  libraryAddText: { fontSize: 14, fontWeight: "600", color: C.green },
  editorHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  editorTitle: { fontSize: 16, fontWeight: "600", color: C.textPrimary },
  cancelText: { fontSize: 15, color: C.textSecondary },
  saveText: { fontSize: 15, fontWeight: "600", color: C.green },
  nameInput: { fontSize: 20, fontWeight: "600", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border, color: C.textPrimary },

  // AI draft
  aiGenerateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    paddingVertical: 12, borderRadius: 14,
    borderWidth: 1, borderColor: C.green, backgroundColor: C.surface,
  },
  aiGenerateText: { fontSize: 14, fontWeight: "700", color: C.green },
  aiOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  aiCard: {
    backgroundColor: C.surface, borderRadius: 18, padding: 20,
    width: "100%", maxWidth: 420, gap: 12,
  },
  aiTitle: { fontSize: 18, fontWeight: "800", color: C.textPrimary },
  aiSub: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  aiInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 12, fontSize: 15, color: C.textPrimary, backgroundColor: C.bg,
    minHeight: 110, maxHeight: 180, textAlignVertical: "top",
  },
  aiActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  aiCancel: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: C.surfaceHigh },
  aiCancelText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  aiGo: {
    paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12,
    backgroundColor: C.green, minWidth: 110, alignItems: "center", justifyContent: "center",
  },
  aiGoText: { fontSize: 14, fontWeight: "700", color: C.bg },
  wallPickRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  wallPickName: { fontSize: 15, fontWeight: "600", color: C.textPrimary, flex: 1 },

  // Assignment-set editor
  unresolvedBanner: {
    backgroundColor: C.surfaceHigh, paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  unresolvedText: { fontSize: 13, color: C.yellow, fontWeight: "600" },
  colRow: { flexDirection: "row", gap: 16, padding: 16 },
  assignCol: {
    backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, padding: 12, gap: 10,
  },
  assignColHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  assignColName: { fontSize: 17, fontWeight: "800", color: C.textPrimary, flex: 1 },
  assignedTag: { fontSize: 12, fontWeight: "700", color: C.green },
  assignNameInput: {
    fontSize: 15, fontWeight: "600", color: C.textPrimary,
    backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
  },
  assignColBtn: {
    backgroundColor: C.green, borderRadius: 12, paddingVertical: 12,
    alignItems: "center", justifyContent: "center",
  },
  assignColBtnText: { fontSize: 14, fontWeight: "700", color: C.bg },

  // Wide-screen split layout
  splitRow: { flex: 1, flexDirection: "row" },
  splitLeft: { flex: 1, borderRightWidth: 1, borderRightColor: C.border },
  splitRight: { width: 420, backgroundColor: C.bg },
  blockList: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 140, gap: 10 },
  blockRow: { backgroundColor: C.surface, borderRadius: 14, overflow: "hidden", marginBottom: 10 },
  blockRowActive: { opacity: 0.8, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 },
  blockRowHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  dragHandle: { padding: 4 },
  dragHandleText: { fontSize: 16, color: C.textMuted },
  moveButtons: { justifyContent: "center", gap: 2 },
  moveButton: { paddingHorizontal: 4, paddingVertical: 1 },
  moveButtonText: { fontSize: 12, color: C.textSecondary },
  moveButtonDisabled: { color: C.border },
  blockRowTitle: { flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  blockTypeLabel: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  blockTypeSubLabel: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  expandChevron: { fontSize: 11, color: C.textMuted },
  blockDeleteButton: { padding: 4 },
  blockFields: { paddingHorizontal: 14, paddingBottom: 14, gap: 6, borderTopWidth: 1, borderTopColor: C.border },
  adaptationRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    paddingVertical: 4,
  },
  adaptationChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.surfaceHigh, borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  adaptationDot: { width: 8, height: 8, borderRadius: 4 },
  // Grade swatch: a hairline border keeps dark grades (e.g. black) visible
  // against the dark chip background.
  gradeDot: {
    width: 10, height: 10, borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.45)",
  },
  adaptationChipText: { fontSize: 12, fontWeight: "600", color: C.textSecondary },
  saveTemplateBtn: {
    marginTop: 12,
    borderWidth: 1, borderColor: C.green, borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 9, alignSelf: "flex-start",
  },
  saveTemplateBtnText: { color: C.green, fontSize: 13, fontWeight: "700" },
  fieldLabel: { fontSize: 12, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10 },
  fieldInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, fontSize: 15, color: C.textPrimary, backgroundColor: C.surfaceHigh },
  fieldInputMultiline: { minHeight: 70, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  addBlockButton: { borderWidth: 1, borderColor: C.border, borderStyle: "dashed", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 8 },
  addBlockText: { fontSize: 15, color: C.textMuted, fontWeight: "500" },
  blockPicker: { backgroundColor: C.surface, borderRadius: 12, overflow: "hidden", gap: 1 },
  blockPickerOption: { padding: 14, backgroundColor: C.surfaceHigh, borderBottomWidth: 1, borderBottomColor: C.border },
  blockPickerOptionText: { fontSize: 15, fontWeight: "500", color: C.textPrimary },

  // ── New-block type picker (card grid)
  pickerPrompt: {
    fontSize: 13, fontWeight: "600", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6,
    marginBottom: 12, marginTop: 4,
  },
  blockTypeGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 12,
  },
  blockTypeCard: {
    width: "48%",
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    padding: 14, gap: 6, minHeight: 120,
  },
  blockTypeIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
    marginBottom: 2,
  },
  blockTypeCardLabel: {
    fontSize: 14, fontWeight: "700", color: C.textPrimary,
  },
  blockTypeCardDesc: {
    fontSize: 11, color: C.textSecondary, lineHeight: 15,
  },
  newBlockTypeHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: C.surface, borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 6,
  },
  newBlockTypeHeaderText: {
    fontSize: 14, fontWeight: "700", color: C.textPrimary,
  },

  // ── Centered vector back button
  iconBackBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },

  // ── "Create new" row inside route picker
  createNewRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 20, marginTop: 14, marginBottom: 4,
    padding: 14,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1, borderColor: C.green,
  },
  createNewIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  createNewLabel: { fontSize: 15, fontWeight: "700", color: C.green },
  createNewSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  exerciseTypeRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  addExerciseButton: { flex: 1, borderWidth: 1, borderColor: C.border, borderStyle: "dashed", borderRadius: 10, padding: 10, alignItems: "center" },
  addExerciseText: { fontSize: 13, color: C.textMuted },
  exerciseRow: { backgroundColor: C.surfaceHigh, borderRadius: 10, padding: 12, gap: 6, marginTop: 6 },
  exerciseRowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  exerciseTypeTag: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, color: C.textMuted },
  exercisePickerButton: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, backgroundColor: C.surfaceHigh },
  exercisePickerName: { fontSize: 15, color: C.textPrimary, fontWeight: "500" },
  exercisePickerPlaceholder: { fontSize: 15, color: C.textMuted },
  exercisePickerRow: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  exercisePickerRowName: { fontSize: 16, fontWeight: "600", color: C.textPrimary },

  routePickerCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.surface, borderRadius: 12, padding: 10,
    borderWidth: 1, borderColor: C.border,
  },
  routePickerThumb: {
    width: 80, height: 80, borderRadius: 8, overflow: "hidden",
    backgroundColor: C.surfaceHigh,
  },
  routePickerBody: { flex: 1, gap: 2 },
  exercisePickerRowMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  listHeaderActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  exercisesButton: { borderWidth: 1, borderColor: C.green, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  exercisesButtonText: { color: C.green, fontWeight: "600", fontSize: 13 },
})