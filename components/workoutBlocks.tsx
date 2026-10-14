import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { Ionicons } from "@expo/vector-icons"
import { ExerciseForm } from "@/components/ExerciseForm"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import { applyRouteFilters, EMPTY_ROUTE_FILTERS, RouteFilterBar, RouteFilters } from "@/components/RouteFilterBar"
import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import { SprayWallBuilder } from "@/components/SprayWallBuilder"
import {
  RouteVariations,
  VariationKey,
  VARIATION_LABEL,
  parseVariations,
  availableVariations,
  variationHolds,
} from "@/utils/sequenceVariations"
import {
  Adaptation,
  ADAPTATIONS,
  ADAPTATION_COLOR,
  ADAPTATION_LABEL,
  resolveAdaptation,
} from "@/utils/adaptations"
import { MOVEMENT_TYPE_COLOR, MOVEMENT_TYPE_LABEL, MovementType } from "@/utils/movementTypes"
import { Focus, FOCUSES, FOCUS_LABEL, FOCUS_REP_RANGE, LevelStep } from "@/utils/scProgression"
import { authoredGrades, fitGrades, suggestNextFourByFour, type FourByFourSuggestion } from "@/utils/progression/fourByFour"
import { INTERVALS_KIND_LABEL, intervalsDescription, suggestNextIntervals, type IntervalsKind, type IntervalsSuggestion } from "@/utils/progression/intervals"
import { INTERVALS_RULES, type ColourRange, type ConstraintRotation, type WarmupPillar } from "@/utils/progression/profiles"
import { COLOUR_RANGE_LABEL, defaultRotation, rotationFor, WARMUP_PILLAR_LABEL } from "@/utils/progression/constraintWarmup"

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")
import {
  AppUser,
  assignProtocol,
  unassignProtocol,
  BlockRow,
  createProtocol,
  deleteBlock,
  deleteProtocol,
  ExerciseRow,
  getAthletes,
  getSessionsByUserId,
  getUsers,
  listBlocksByType,
  getSprayRoute,
  getSprayRoutes,
  getSprayWall,
  getSprayWalls,
  SprayWallRow,
  listBlocks,
  listExercises,
  listProtocols,
  ProtocolRow,
  saveBlockToLibrary,
  saveSprayRoute,
  SessionRow,
  upsertBlockTemplate,
  SprayRouteRow,
  updateBlock,
  updateProtocol,
} from "@/services/BoulderGraphService"
import { findLastScSession, findScSessions } from "@/utils/scHistory"
import { planNextForFocus, type NextFlags } from "@/utils/scNext"
import { getExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { chainIds, chainIndexOf, findLibraryRow, resolveExerciseChain, type ChainMember } from "@/utils/levelChain"
import { exerciseDraftFromLibrary } from "@/utils/scPlanBuilder"
import { findBlockRuns } from "@/utils/blockHistory"
import { routesVisibleTo, suggestNextSequence, type SequenceSuggestion } from "@/utils/progression/sequence"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator, Alert,
  FlatList,
  Image,
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
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import ReAnimated, { LinearTransition, runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated"
import { SafeAreaView } from "react-native-safe-area-context"
import { LinearGradient } from "expo-linear-gradient"

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlockType = "project_bouldering" | "constraint_warmup" | "strength_conditioning" | "exploration_session" | "sequence" | "free_session" | "four_by_four" | "intervals"

interface BaseBlock {
  id: string
  type: BlockType
  blockName: string
  // Target training adaptation (technique/strength/power_endurance/...).
  // Optional — defaults are inferred from the block type in utils/adaptations.ts.
  adaptation?: string
  // Optional time constraint for the block, in minutes (0 / undefined = none).
  // Shown as a countdown while the block runs.
  timeLimit?: number
  // The library row ($id) this block was cloned from, if any. Rides along in
  // the session's protocol JSON so progression history can find "the same
  // block" across sessions without depending on its name (renames would
  // break a name match) — see utils/blockHistory.ts. Never saved into a
  // library row's own data (see withoutLibraryRef).
  libraryBlockId?: string
  // Run by the coach in person, not the app (docs/training-plan-implementation.md
  // §12): set by the coach in the builder or by the athlete mid-workout
  // ("Coach is here"). The workout shows it as a title + Done (sequence
  // blocks: + the coach's sequences); progression skips it (except
  // sequences — utils/blockHistory.ts).
  coached?: boolean
}

interface ProjectBoulderingBlock extends BaseBlock {
  type: "project_bouldering"
  description: string; targetAttempts: number; restTime: number
}

interface ConstraintWarmupBlock extends BaseBlock {
  type: "constraint_warmup"
  description: string; level: string; targetAttempts: number
  // Warm-up rotation settings (utils/progression/constraintWarmup.ts):
  // which pillars this constraint warms up for and which colours it may be
  // done on. Unset → the default table by name. Kept in sync with the
  // library block, which is what the rotation reads.
  rotation?: ConstraintRotation
}

export interface Exercise {
  id: string; type: "reps" | "both_sides" | "7/3s"; name: string; exerciseId?: string; unit?: "reps" | "seconds"; reps?: string; edge?: string; series?: number; photoUri?: string; notes?: string
  // Copied from the library entry when added (see exerciseFromLibrary) — an
  // intrinsic property of the exercise, not something re-picked per block.
  movementType?: string   // MovementType, see utils/movementTypes.ts
  loadMode?: "weight" | "level"
  levels?: LevelStep[]    // ordered easiest → hardest; only used when loadMode is "level"
  loadStep?: number       // weight mode: smallest jump (kg); the live library's value wins at workout time
  settingHarder?: string  // adjustable-setting hints (bench height, lean…); the live library's wins
  settingEasier?: string
  // Programmed fresh each time this exercise is placed in a block — the same
  // exercise can be max force this cycle and hypertrophy next cycle.
  focus?: Focus
}

export interface StrengthConditioningBlock extends BaseBlock {
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
  // Which variation the athlete starts on. Defaults to "original" (try the
  // base climb first, then calibrate) — the coach can override this to have
  // the athlete start on Easy or Hard instead.
  startingVariation?: VariationKey
  // When true, no route is fixed at authoring time — the athlete picks or
  // builds their own sequence the moment they reach this block. routeId etc.
  // stay empty on the authored block; startingVariation doesn't apply since
  // the coach doesn't know in advance which route's variations it'd refer to.
  athleteChoosesRoute?: boolean
}

interface FreeSessionBlock extends BaseBlock {
  type: "free_session"
  description: string
  // Prompt shown to the athlete above the notes field once the session ends,
  // e.g. "What did you try?" — lets a coach reuse this block as a simple,
  // no-project version of Project bouldering (time + one guided note).
  notePrompt?: string
  // Example text shown as the notes field's placeholder, e.g. "e.g. Tried
  // the blue overhang, fell on the last move".
  noteExample?: string
  // Optional attached sequence — shown to the athlete during the session for
  // reference, with no attempt tracking (that's what the "sequence" block
  // type is for).
  routeId?: string
  routeName?: string
  routeHolds?: string  // JSON stringified PlacedHold[]
  wallImageUri?: string
  wallWidth?: number
  wallHeight?: number
}

interface FourByFourBlock extends BaseBlock {
  type: "four_by_four"
  description: string
  sets: number            // number of sets (the first "4")
  bouldersPerSet: number  // boulders per set (the second "4")
  restTime: number        // rest between sets (seconds)
  // One colour per boulder slot (length bouldersPerSet), easiest → hardest
  // as the progression raises them first → last. Optional: unset means the
  // first session starts at the athlete's flash level − 1 (or the athlete
  // picks one colour when no flash level is set). See utils/progression/fourByFour.ts.
  boulderGrades?: string[]
}

interface IntervalsBlock extends BaseBlock {
  type: "intervals"
  description: string
  series: number     // number of work/rest rounds
  workTime: number   // work duration per round (seconds)
  restTime: number   // rest duration between rounds (seconds)
  // Which progression rule applies (utils/progression/intervals.ts). Unset →
  // no suggestion until the coach picks one.
  kind?: IntervalsKind
}

export type Block = ProjectBoulderingBlock | ConstraintWarmupBlock | StrengthConditioningBlock | ExplorationSessionBlock | SequenceBlock | FreeSessionBlock | FourByFourBlock | IntervalsBlock

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() { return Math.random().toString(36).slice(2) }

export function makeDefaultBlock(type: BlockType, name: string = ""): Block {
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
    case "intervals":
      return { id: generateId(), type, blockName: name, description: "", series: 6, workTime: 30, restTime: 60 }
  }
}

// Turn an AI-proposed block into a real editor Block. If it references a saved

export function stripLocalIds(blocks: Block[]): any[] {
  return blocks.map(({ id, ...rest }) => {
    if (rest.type === "strength_conditioning") {
      const sc = rest as Omit<StrengthConditioningBlock, "id">
      return { ...sc, exercises: sc.exercises.map(({ id: _eid, ...ex }) => ex) }
    }
    return rest
  })
}

export function injectLocalIds(blocks: any[]): Block[] {
  return blocks.map((b) => ({
    ...b,
    id: generateId(),
    ...(b.type === "strength_conditioning"
      ? { exercises: (b.exercises ?? []).map((e: any) => ({ ...e, id: generateId() })) }
      : {}),
  }))
}

export function blockFromLibraryRow(row: BlockRow): Block {
  const data = JSON.parse(row.data)
  return { ...data, id: generateId(), blockName: row.name, libraryBlockId: row.$id }
}

// A block's data as it should be stored on a library row: no local id, and no
// libraryBlockId (a template doesn't point at itself, and a block saved as a
// new template mustn't keep pointing at the template it was cloned from).
function withoutLibraryRef(block: Block) {
  const { id, libraryBlockId, ...data } = block
  return data
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  project_bouldering: "Project bouldering",
  constraint_warmup: "Constraint warmup",
  strength_conditioning: "Strength & conditioning",
  exploration_session: "Boulder Logger",
  sequence: "Sequence",
  free_session: "Free session",
  four_by_four: "4×4",
  intervals: "Intervals",
}

export const BLOCK_ICONS: Record<BlockType, keyof typeof Ionicons.glyphMap> = {
  project_bouldering: "flame",
  constraint_warmup: "thermometer",
  strength_conditioning: "barbell",
  exploration_session: "search",
  sequence: "footsteps",
  free_session: "time",
  four_by_four: "grid",
  intervals: "timer",
}

const BLOCK_DESCRIPTIONS: Record<BlockType, string> = {
  project_bouldering: "Work a single project with rest timers",
  constraint_warmup: "Climb with a movement constraint",
  strength_conditioning: "Rounds of exercises",
  exploration_session: "Log sends freely by grade",
  sequence: "Specific route on the spray wall",
  free_session: "Open-ended climbing time",
  four_by_four: "Sets of boulders for power endurance",
  intervals: "Timed work / rest rounds",
}

// ─── Block Picker Modal ───────────────────────────────────────────────────────

const LIBRARY_FILTER_VISIBLE_COUNT = 3

export function BlockPickerModal({
  onAdd,
  onClose,
  embedded,
  initialTab = "new",
  allowSaveToLibrary = true,
}: {
  onAdd: (block: Block) => void
  onClose: () => void
  /** When true, render without modal chrome (sidebar on PC). */
  embedded?: boolean
  /** Which tab opens first — callers browsing an existing library want "library". */
  initialTab?: "library" | "new"
  /** Passed through to the "New block" form's save-to-library toggle. */
  allowSaveToLibrary?: boolean
}) {
  const [tab, setTab] = useState<"library" | "new">(initialTab)
  const [libraryBlocks, setLibraryBlocks] = useState<BlockRow[]>([])
  const [loadingLibrary, setLoadingLibrary] = useState(true)
  const [newBlockType, setNewBlockType] = useState<BlockType | null>(null)
  const [librarySearch, setLibrarySearch] = useState("")
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<BlockType | null>(null)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [libraryCardMenuId, setLibraryCardMenuId] = useState<string | null>(null)
  const [editingRow, setEditingRow] = useState<BlockRow | null>(null)
  const [editingBlock, setEditingBlock] = useState<Block | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  // Types actually present in the library — keeps the filter row from showing
  // chips for types with nothing in them.
  const availableTypes = useMemo(() => {
    const present = new Set(libraryBlocks.map((b) => b.type as BlockType))
    return (Object.keys(BLOCK_LABELS) as BlockType[]).filter((t) => present.has(t))
  }, [libraryBlocks])

  const filteredLibraryBlocks = useMemo(() => {
    const q = librarySearch.trim().toLowerCase()
    return libraryBlocks
      .filter((b) => !libraryTypeFilter || b.type === libraryTypeFilter)
      .filter((b) => !q || b.name.toLowerCase().includes(q) || (BLOCK_LABELS[b.type as BlockType] ?? "").toLowerCase().includes(q))
      .slice()
      // Case-insensitive A→Z (Appwrite's sort is case-sensitive).
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
  }, [libraryBlocks, librarySearch, libraryTypeFilter])

  const groupedLibraryBlocks = useMemo(() => {
    const grouped: Record<string, BlockRow[]> = {}
    for (const row of filteredLibraryBlocks) {
      if (!grouped[row.type]) grouped[row.type] = []
      grouped[row.type].push(row)
    }
    return (Object.keys(BLOCK_LABELS) as BlockType[])
      .filter((t) => grouped[t]?.length > 0)
      .map((type) => ({ type, rows: grouped[type] }))
  }, [filteredLibraryBlocks])

  async function loadLibrary() {
    setLoadingLibrary(true)
    try { setLibraryBlocks(await listBlocks()) }
    catch (e) { console.error(e) }
    finally { setLoadingLibrary(false) }
  }
  // Load once on mount. Saving a new block to the library (handleSaveNew)
  // refreshes the list itself, so switching tabs doesn't need to re-fetch.
  useEffect(() => { loadLibrary() }, [])

  function handlePickFromLibrary(row: BlockRow) {
    onAdd(blockFromLibraryRow(row))
  }

  async function handleDeleteFromLibrary(id: string, onDeleted?: () => void) {
  Alert.alert("Delete block", "Remove this block from the library?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Delete",
      style: "destructive",
      onPress: async () => {
        try {
          await deleteBlock(id)
          setLibraryBlocks((prev) => prev.filter((b) => b.$id !== id))
          onDeleted?.()
        } catch (e: any) {
          Alert.alert("Error", e?.message ?? "Could not delete block.")
        }
      },
    },
  ])
}

  function handleEditFromLibrary(row: BlockRow) {
    setEditingRow(row)
    setEditingBlock(blockFromLibraryRow(row))
  }

  async function handleSaveEdit() {
    if (!editingRow || !editingBlock) return
    setSavingEdit(true)
    try {
      const updated = await updateBlock(editingRow.$id, { name: editingBlock.blockName, type: editingBlock.type, data: withoutLibraryRef(editingBlock) })
      setLibraryBlocks((prev) => prev.map((b) => (b.$id === updated.$id ? updated : b)))
      setEditingRow(null)
      setEditingBlock(null)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save changes.")
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleSaveNew(block: Block, saveToLibrary: boolean) {
    if (saveToLibrary) {
      const row = await saveBlockToLibrary({ name: block.blockName, type: block.type, data: withoutLibraryRef(block) })
      loadLibrary() // so the new template shows in the library tab
      // Link the copy going into this workout to its new template, same as
      // picking it from the library would.
      onAdd({ ...block, libraryBlockId: row.$id })
      return
    }
    onAdd(block)
  }

  const Container: any = embedded ? View : SafeAreaView
  return (
    <>
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
        {tab === "library" ? (
          <Pressable onPress={loadLibrary} style={styles.iconBackBtn} hitSlop={10}>
            <Ionicons name="refresh" size={18} color={C.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.iconBackBtn} />
        )}
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
            {/* Type filter chips — so 79 blocks don't all have to be scrolled
                through to find one kind. Collapsed to a few + "+N" so this
                doesn't itself become a wall to scan. */}
            {availableTypes.length > 1 && (
              <View style={styles.libraryFilterRow}>
                {(filtersExpanded ? availableTypes : availableTypes.slice(0, LIBRARY_FILTER_VISIBLE_COUNT)).map((type) => {
                  const active = libraryTypeFilter === type
                  return (
                    <Pressable
                      key={type}
                      style={[styles.libraryFilterChip, active && styles.libraryFilterChipActive]}
                      onPress={() => setLibraryTypeFilter(active ? null : type)}
                    >
                      <Ionicons name={BLOCK_ICONS[type]} size={13} color={active ? C.bg : C.textSecondary} />
                      <Text style={[styles.libraryFilterChipText, active && styles.libraryFilterChipTextActive]}>
                        {BLOCK_LABELS[type]}
                      </Text>
                    </Pressable>
                  )
                })}
                {!filtersExpanded && availableTypes.length > LIBRARY_FILTER_VISIBLE_COUNT && (
                  <Pressable style={styles.libraryFilterChip} onPress={() => setFiltersExpanded(true)}>
                    <Text style={styles.libraryFilterChipText}>+{availableTypes.length - LIBRARY_FILTER_VISIBLE_COUNT}</Text>
                  </Pressable>
                )}
                {filtersExpanded && availableTypes.length > LIBRARY_FILTER_VISIBLE_COUNT && (
                  <Pressable style={styles.libraryFilterChip} onPress={() => setFiltersExpanded(false)}>
                    <Text style={styles.libraryFilterChipText}>Less</Text>
                  </Pressable>
                )}
              </View>
            )}

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
            {groupedLibraryBlocks.length === 0 ? (
              <Text style={styles.emptyState}>No blocks match.</Text>
            ) : (
              groupedLibraryBlocks.map(({ type, rows }) => (
                <View key={type} style={{ marginBottom: 18 }}>
                  <Text style={styles.libraryGroupHeader}>{BLOCK_LABELS[type]}</Text>
                  <View style={styles.libraryGrid}>
                    {rows.map((row) => (
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
                          onPress={() => setLibraryCardMenuId(row.$id)}
                          style={styles.libraryCardMenuBtn}
                          hitSlop={8}
                        >
                          <Ionicons name="ellipsis-horizontal" size={15} color={C.textMuted} />
                        </Pressable>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            )}
            <Text style={styles.libraryResultsFooter}>
              {filteredLibraryBlocks.length} result{filteredLibraryBlocks.length !== 1 ? "s" : ""}
            </Text>
          </ScrollView>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
          {/* Embedded (PC sidebar): the type grid stays put — details open in
              their own modal instead of taking over this narrow pane. */}
          {embedded || newBlockType === null ? (
            <>
              <Text style={styles.pickerPrompt}>Choose a block type</Text>
              <View style={styles.blockTypeGrid}>
                {(["project_bouldering", "constraint_warmup", "strength_conditioning", "exploration_session", "sequence", "four_by_four", "intervals", "free_session"] as BlockType[]).map((type) => (
                  <Pressable
                    key={type}
                    style={styles.blockTypeCard}
                    onPress={() => {
                      // S&C skips the create-then-add form — it drops straight
                      // into the protocol (auto-expanded there) since its fields
                      // are the same ones the block editor already shows.
                      if (type === "strength_conditioning") onAdd(makeDefaultBlock(type))
                      else setNewBlockType(type)
                    }}
                  >
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
              allowSaveToLibrary={allowSaveToLibrary}
            />
          )}
        </ScrollView>
      )}
    </Container>

    {embedded && !!newBlockType && (
    <Modal visible transparent animationType="fade" onRequestClose={() => setNewBlockType(null)}>
      <Pressable style={styles.editBackdrop} onPress={() => setNewBlockType(null)}>
        <Pressable style={styles.editCard} onPress={() => {}}>
          <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
            <NewBlockForm
              type={newBlockType}
              onBack={() => setNewBlockType(null)}
              onSave={async (block, saveToLibrary) => { await handleSaveNew(block, saveToLibrary); setNewBlockType(null) }}
              allowSaveToLibrary={allowSaveToLibrary}
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
    )}

    {!!editingRow && (
    <Modal visible transparent animationType="fade" onRequestClose={() => setEditingRow(null)}>
      <Pressable style={styles.editBackdrop} onPress={() => setEditingRow(null)}>
        <Pressable style={styles.editCard} onPress={() => {}}>
          <View style={styles.editorHeader}>
            <Pressable onPress={() => setEditingRow(null)} hitSlop={10}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.editorTitle}>Edit block</Text>
            <Pressable onPress={handleSaveEdit} disabled={savingEdit} hitSlop={10}>
              <Text style={[styles.saveText, savingEdit && { opacity: 0.5 }]}>
                {savingEdit ? "Saving…" : "Save"}
              </Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
            {editingBlock && (
              <BlockEditorRow
                block={editingBlock}
                isExpanded
                isActive={false}
                standalone
                onToggleExpand={() => {}}
                onDrag={() => {}}
                onUpdate={setEditingBlock}
                onDelete={() => editingRow && handleDeleteFromLibrary(editingRow.$id, () => setEditingRow(null))}
              />
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
    )}

    {!!libraryCardMenuId && (
    <Modal visible transparent animationType="fade" onRequestClose={() => setLibraryCardMenuId(null)}>
      <Pressable style={styles.actionSheetBackdrop} onPress={() => setLibraryCardMenuId(null)}>
        <View style={styles.actionSheet}>
          <Pressable
            style={styles.actionSheetItem}
            onPress={() => {
              const row = libraryBlocks.find((b) => b.$id === libraryCardMenuId)
              setLibraryCardMenuId(null)
              if (row) handleEditFromLibrary(row)
            }}
          >
            <Text style={styles.actionSheetItemText}>Edit</Text>
          </Pressable>
          <Pressable
            style={styles.actionSheetItem}
            onPress={() => {
              const id = libraryCardMenuId
              setLibraryCardMenuId(null)
              if (id) handleDeleteFromLibrary(id)
            }}
          >
            <Text style={[styles.actionSheetItemText, { color: C.red }]}>Delete</Text>
          </Pressable>
          <View style={styles.actionSheetDivider} />
          <Pressable style={styles.actionSheetItem} onPress={() => setLibraryCardMenuId(null)}>
            <Text style={styles.actionSheetItemText}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
    )}
    </>
  )
}

// ─── New Block Form ───────────────────────────────────────────────────────────

function NewBlockForm({ type, onBack, onSave, allowSaveToLibrary = true }: {
  type: BlockType
  onBack: () => void
  onSave: (block: Block, saveToLibrary: boolean) => Promise<void>
  // When false, this block is a one-off (e.g. an athlete describing a past
  // session) — hide the toggle entirely instead of polluting the shared
  // coach-facing library with it.
  allowSaveToLibrary?: boolean
}) {
  const [block, setBlock] = useState<Block>(makeDefaultBlock(type))
  const [saveToLibrary, setSaveToLibrary] = useState(allowSaveToLibrary)
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

      <View style={styles.nameRow}>
        <View style={styles.nameField}>
          <Text style={styles.fieldLabel}>Block name</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="e.g. Silent Feet warmup"
            value={block.blockName}
            onChangeText={(v) => setBlock((b) => ({ ...b, blockName: v }))}
            placeholderTextColor="#aaa"
          />
        </View>
        <BlockNumerics block={block} onUpdate={setBlock} />
      </View>
      <TimeLimitField block={block} onUpdate={setBlock} />

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
      {type === "intervals" && (
        <IntervalsFields block={block as IntervalsBlock} onUpdate={setBlock} />
      )}
      {type === "free_session" && (
        <FreeSessionFields block={block as FreeSessionBlock} onUpdate={setBlock} />
      )}

      {allowSaveToLibrary && (
        <View style={styles.switchRow}>
          <Text style={styles.fieldLabel}>Save to library</Text>
          <Switch value={saveToLibrary} onValueChange={setSaveToLibrary} />
        </View>
      )}

      <CustomButton title={saving ? "Saving…" : "Add to protocol"} onPress={handleSave} />
    </View>
  )
}

// ─── Block Editor Row ─────────────────────────────────────────────────────────

export function BlockEditorRow({ block, isExpanded, isActive, onToggleExpand, onDrag, onUpdate, onDelete, onSaveAsTemplate, onMoveUp, onMoveDown, standalone, card }: {
  block: Block; isExpanded: boolean; isActive: boolean
  onToggleExpand: () => void; onDrag: () => void; onUpdate: (b: Block) => void; onDelete: () => void
  onSaveAsTemplate?: () => void
  // Desktop reorder controls. When provided, replace the touch drag handle with
  // ▲/▼ buttons; an undefined callback means that direction is disabled (ends).
  onMoveUp?: () => void; onMoveDown?: () => void
  // Editing a single block on its own (e.g. from the template library) rather
  // than as a row in a reorderable list — drops the drag handle and the title/
  // chevron bar (nothing to reorder or collapse), and swaps the bare "✕" for a
  // labeled, still-confirmed delete action so it can't be hit by accident.
  standalone?: boolean
  // Protocol builder: dress the row like the library's "Edit block" modal.
  // With `standalone` it's a card for the wide grid (drag lives on the grid
  // cell); without, a list row with its own drag handle for narrow screens.
  // Both collapse via onToggleExpand.
  card?: boolean
}) {
  if (card) {
    return (
      <BlockEditorCard
        block={block} isExpanded={isExpanded} isActive={isActive} inGrid={!!standalone}
        onToggleExpand={onToggleExpand} onDrag={onDrag} onUpdate={onUpdate} onDelete={onDelete}
        onSaveAsTemplate={onSaveAsTemplate}
      />
    )
  }
  const reorderButtons = onMoveUp !== undefined || onMoveDown !== undefined
  const showFields = standalone || isExpanded
  const editingBorder = !standalone && isExpanded
  return (
    <View style={[
      standalone ? styles.blockRowStandalone : styles.blockRow,
      isActive && styles.blockRowActive,
      editingBorder && styles.blockRowEditing,
    ]}>
      {standalone ? (
        <StandaloneHeader block={block} onSaveAsTemplate={onSaveAsTemplate} onDelete={onDelete} />
      ) : (
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
              <DragGripIcon />
            </Pressable>
          )}
          <View style={[styles.blockRowDot, { backgroundColor: ADAPTATION_COLOR[resolveAdaptation(block)] }]} />
          <Text style={styles.blockRowCompactName} numberOfLines={1}>
            {block.blockName || BLOCK_LABELS[block.type]}
          </Text>
          <Pressable onPress={onToggleExpand} style={styles.blockRowEditBtn} hitSlop={8}>
            <Ionicons name={isExpanded ? "chevron-up" : "pencil"} size={16} color={isExpanded ? C.green : C.textSecondary} />
          </Pressable>
        </View>
      )}
      {showFields && (
        standalone ? (
          <StandaloneBlockFields block={block} onUpdate={onUpdate} />
        ) : (
          <View style={styles.blockFields}>
            <View style={styles.nameRow}>
              <View style={styles.nameField}>
                <Text style={styles.fieldLabel}>Block name</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={block.blockName}
                  onChangeText={(v) => onUpdate({ ...block, blockName: v })}
                  placeholderTextColor="#aaa"
                  placeholder="Block name"
                />
              </View>
              <BlockNumerics block={block} onUpdate={onUpdate} />
            </View>
            <TimeLimitToggle block={block} onUpdate={onUpdate} />
            {block.type !== "strength_conditioning" && (
              <>
                <Text style={styles.fieldLabel}>
                  Adaptation <Text style={styles.fieldLabelHint}>· one</Text>
                </Text>
                <AdaptationPicker
                  value={resolveAdaptation(block)}
                  onChange={(v) => onUpdate({ ...block, adaptation: v })}
                />
              </>
            )}
            <TypeSpecificFields block={block} onUpdate={onUpdate} />
            {onSaveAsTemplate && (
              <Pressable style={styles.saveTemplateBtn} onPress={onSaveAsTemplate}>
                <Text style={styles.saveTemplateBtnText}>Save as template</Text>
              </Pressable>
            )}
            <Pressable style={styles.blockDeleteFooterBtn} onPress={onDelete}>
              <Ionicons name="trash-outline" size={14} color={C.red} />
              <Text style={styles.blockDeleteFooterBtnText}>Delete block</Text>
            </Pressable>
          </View>
        )
      )}
    </View>
  )
}

// What identifies a block in the builder's card/row header. S&C blocks have
// no meaningful name of their own there — they're defined by their exercises.
function builderBlockTitle(block: Block): string {
  if (block.type === "strength_conditioning") {
    return block.exercises.length
      ? block.exercises.map((e) => e.name || "Unnamed").join("\n")
      : "No exercises yet"
  }
  return block.blockName || "Untitled block"
}

// An S&C title lists every exercise, one per line, so it isn't clipped to one
// line like a block name — the card grows taller to show them all.
function builderTitleLines(block: Block): number | undefined {
  return block.type === "strength_conditioning" ? undefined : 1
}

function BlockEditorCard({ block, isExpanded, isActive, inGrid, onToggleExpand, onDrag, onUpdate, onDelete, onSaveAsTemplate }: {
  block: Block; isExpanded: boolean; isActive: boolean; inGrid: boolean
  onToggleExpand: () => void; onDrag: () => void; onUpdate: (b: Block) => void; onDelete: () => void
  onSaveAsTemplate?: () => void
}) {
  return (
    <View style={[styles.blockCard, !inGrid && styles.blockCardListItem, isActive && styles.blockRowActive]}>
      {inGrid ? (
        // Drag/number live on the grid cell; the card itself is the modal's content.
        <View style={styles.blockCardHeaderClearGrip}>
          <StandaloneHeader
            block={block} onSaveAsTemplate={onSaveAsTemplate} onDelete={onDelete}
            expanded={isExpanded} onToggleExpand={onToggleExpand}
            onRename={(v) => onUpdate({ ...block, blockName: v })}
          />
        </View>
      ) : (
        <Pressable style={styles.blockCardListHeader} onPress={onToggleExpand}>
          <Pressable onLongPress={onDrag} style={styles.dragHandle}>
            <DragGripIcon />
          </Pressable>
          <View style={[styles.standaloneDot, { backgroundColor: ADAPTATION_COLOR[resolveAdaptation(block)] }]} />
          <View style={styles.blockCardListTitles}>
            <Text style={styles.blockCardListType}>{BLOCK_LABELS[block.type]}</Text>
            <Text style={styles.blockCardListName} numberOfLines={builderTitleLines(block)}>{builderBlockTitle(block)}</Text>
          </View>
          <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={18} color={isExpanded ? C.green : C.textSecondary} />
        </Pressable>
      )}
      {isExpanded && (
        <>
          {!inGrid && <View style={styles.blockCardDivider} />}
          {inGrid ? (
            <CompactFieldsContext.Provider value={true}>
              <StandaloneBlockFields block={block} onUpdate={onUpdate} />
            </CompactFieldsContext.Provider>
          ) : (
            <StandaloneBlockFields block={block} onUpdate={onUpdate} hideName={block.type === "strength_conditioning"} />
          )}
          {!inGrid && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              {onSaveAsTemplate && (
                <Pressable style={styles.saveTemplateBtn} onPress={onSaveAsTemplate}>
                  <Text style={styles.saveTemplateBtnText}>Save as template</Text>
                </Pressable>
              )}
              <Pressable style={[styles.blockDeleteFooterBtn, { marginTop: 0 }]} onPress={onDelete}>
                <Ionicons name="trash-outline" size={14} color={C.red} />
                <Text style={styles.blockDeleteFooterBtnText}>Delete block</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </View>
  )
}

// The block-type-specific fields (plus the free-session description), shared
// between the compact list row and the standalone editor.
function TypeSpecificFields({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
  return (
    <>
      {block.type === "project_bouldering" && <ProjectBoulderingFields block={block} onUpdate={onUpdate} />}
      {block.type === "constraint_warmup" && <ConstraintWarmupFields block={block} onUpdate={onUpdate} />}
      {block.type === "strength_conditioning" && <StrengthConditioningFields block={block} onUpdate={onUpdate} />}
      {block.type === "exploration_session" && <ExplorationSessionFields block={block} onUpdate={onUpdate} />}
      {block.type === "sequence" && <SequenceFields block={block as SequenceBlock} onUpdate={onUpdate} />}
      {block.type === "four_by_four" && <FourByFourFields block={block as FourByFourBlock} onUpdate={onUpdate} />}
      {block.type === "intervals" && <IntervalsFields block={block as IntervalsBlock} onUpdate={onUpdate} />}
      {block.type === "free_session" && (
        <FreeSessionFields block={block as FreeSessionBlock} onUpdate={onUpdate} />
      )}
    </>
  )
}

// ─── Standalone editor (template library) ──────────────────────────────────────

// Dot + type label + "···" actions, replacing the list row's drag handle and
// bare "✕" — neither means anything when there's only one block on screen.
// With `onToggleExpand` (protocol-builder grid cards) the title becomes a
// collapse toggle and, while collapsed, also shows the block's name.
// With `onRename` (grid cards) it's the dense version: small type label with
// the block name under it — editable in place while expanded, replacing the
// fields' separate "Block name" input.
function StandaloneHeader({ block, onSaveAsTemplate, onDelete, expanded = true, onToggleExpand, onRename }: {
  block: Block; onSaveAsTemplate?: () => void; onDelete: () => void
  expanded?: boolean; onToggleExpand?: () => void; onRename?: (name: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const color = ADAPTATION_COLOR[resolveAdaptation(block)]
  const dense = !!onRename
  const fitWidth = useContext(CardFitWidthContext)
  const scNames = block.type === "strength_conditioning" && block.exercises.length
    ? block.exercises.map((e) => e.name || "Unnamed")
    : null
  // Room the title has vs. what its longest exercise name needs unwrapped —
  // the difference is how much wider the grid cell has to get.
  const [titleW, setTitleW] = useState(0)
  const [namesW, setNamesW] = useState(0)
  useEffect(() => {
    if (fitWidth && scNames && !expanded && titleW > 0 && namesW > 0) fitWidth(Math.ceil(namesW - titleW))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleW, namesW, expanded, !!scNames])
  const nameStyle = dense ? styles.blockCardListName : styles.standaloneHeaderName
  return (
    <>
      <View style={[styles.standaloneHeaderRow, dense && styles.standaloneHeaderRowCompact]}>
        <Pressable style={[styles.standaloneHeaderLeft, { flex: 1 }]} onPress={onToggleExpand} disabled={!onToggleExpand}>
          <View style={[styles.standaloneDot, { backgroundColor: color }]} />
          <View style={{ flex: 1 }} onLayout={(e) => setTitleW(e.nativeEvent.layout.width)}>
            <Text style={dense ? styles.blockCardListType : styles.standaloneHeaderTitle}>{BLOCK_LABELS[block.type]}</Text>
            {!expanded && (scNames ? (
              <>
                {scNames.map((n, i) => <Text key={i} style={nameStyle} numberOfLines={1}>{n}</Text>)}
                {/* Invisible, unconstrained copy — measures the names' natural width. */}
                {fitWidth && (
                  <View style={styles.titleMeasureWrap} pointerEvents="none">
                    <View style={{ alignSelf: "flex-start" }} onLayout={(e) => setNamesW(e.nativeEvent.layout.width)}>
                      {scNames.map((n, i) => <Text key={i} style={nameStyle}>{n}</Text>)}
                    </View>
                  </View>
                )}
              </>
            ) : (
              <Text style={nameStyle} numberOfLines={1}>{builderBlockTitle(block)}</Text>
            ))}
          </View>
          {onToggleExpand && (
            <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={expanded ? C.green : C.textSecondary} />
          )}
        </Pressable>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} style={styles.standaloneMenuBtn}>
          <Ionicons name="ellipsis-horizontal" size={18} color={C.textSecondary} />
        </Pressable>
      </View>
      {/* Outside the toggle Pressable — on web a click in a nested input
          would also collapse the card. */}
      {dense && expanded && block.type !== "strength_conditioning" && (
        <TextInput
          style={styles.standaloneHeaderNameInput}
          value={block.blockName}
          onChangeText={onRename}
          placeholder="Block name"
          placeholderTextColor={C.textMuted}
        />
      )}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.actionSheetBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.actionSheet}>
            {onSaveAsTemplate && (
              <Pressable
                style={styles.actionSheetItem}
                onPress={() => { setMenuOpen(false); onSaveAsTemplate() }}
              >
                <Text style={styles.actionSheetItemText}>Save as template</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.actionSheetItem}
              onPress={() => { setMenuOpen(false); onDelete() }}
            >
              <Text style={[styles.actionSheetItemText, { color: C.red }]}>Delete block</Text>
            </Pressable>
            <View style={styles.actionSheetDivider} />
            <Pressable style={styles.actionSheetItem} onPress={() => setMenuOpen(false)}>
              <Text style={styles.actionSheetItemText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

function StandaloneBlockFields({ block, onUpdate, hideName }: { block: Block; onUpdate: (b: Block) => void; hideName?: boolean }) {
  const compact = useContext(CompactFieldsContext)
  if (compact) {
    // Name lives in the card header; time limit rides along with the numerics.
    return (
      <View style={styles.standaloneFieldsCompact}>
        <BlockNumerics block={block} onUpdate={onUpdate} standalone />
        {block.type !== "strength_conditioning" && (
          <AdaptationPicker
            value={resolveAdaptation(block)}
            onChange={(v) => onUpdate({ ...block, adaptation: v })}
          />
        )}
        <TypeSpecificFields block={block} onUpdate={onUpdate} />
      </View>
    )
  }
  return (
    <View style={styles.standaloneFields}>
      {!hideName && (
        <>
          <Text style={styles.fieldLabel}>Block name</Text>
          <TextInput
            style={styles.fieldInput}
            value={block.blockName}
            onChangeText={(v) => onUpdate({ ...block, blockName: v })}
            placeholderTextColor="#aaa"
            placeholder="Block name"
          />
        </>
      )}

      <BlockNumerics block={block} onUpdate={onUpdate} standalone />

      <TimeLimitToggle block={block} onUpdate={onUpdate} />

      {block.type !== "strength_conditioning" && (
        <>
          <Text style={styles.fieldLabel}>
            Adaptation <Text style={styles.fieldLabelHint}>· one</Text>
          </Text>
          <AdaptationPicker
            value={resolveAdaptation(block)}
            onChange={(v) => onUpdate({ ...block, adaptation: v })}
          />
        </>
      )}

      <TypeSpecificFields block={block} onUpdate={onUpdate} />
    </View>
  )
}

// ─── Field Components ─────────────────────────────────────────────────────────

// "general"/"test" are fallback-only buckets (used when a block has no real
// adaptation) — never offered as a pick.
const PICKABLE_ADAPTATIONS = ADAPTATIONS.filter((a) => a !== "general" && a !== "test")

function AdaptationPicker({
  value,
  onChange,
}: {
  value: Adaptation
  onChange: (v: Adaptation) => void
}) {
  const compact = useContext(CompactFieldsContext)
  const [open, setOpen] = useState(false)
  if (compact) {
    // One pill for the current pick; the full set only while choosing.
    const color = ADAPTATION_COLOR[value]
    return (
      <View style={{ gap: 6 }}>
        <Pressable style={[styles.adaptationPill, { borderColor: color, backgroundColor: color + "22" }]} onPress={() => setOpen((o) => !o)}>
          <View style={[styles.adaptationDot, { backgroundColor: color }]} />
          <Text style={[styles.adaptationPillText, { color }]}>{ADAPTATION_LABEL[value]}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={13} color={color} />
        </Pressable>
        {open && (
          <View style={styles.adaptationRow}>
            {PICKABLE_ADAPTATIONS.filter((a) => a !== value).map((a) => (
              <Pressable key={a} style={styles.adaptationChip} onPress={() => { onChange(a); setOpen(false) }}>
                <View style={[styles.adaptationDot, { backgroundColor: ADAPTATION_COLOR[a] }]} />
                <Text style={styles.adaptationChipText}>{ADAPTATION_LABEL[a]}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    )
  }
  return (
    <View style={styles.adaptationRowStandalone}>
      {PICKABLE_ADAPTATIONS.map((a) => {
        const selected = value === a
        const color = ADAPTATION_COLOR[a]
        return (
          <Pressable
            key={a}
            onPress={() => onChange(a)}
            style={[styles.adaptationChipStandalone, selected && { borderColor: color, backgroundColor: color + "22" }]}
          >
            {selected ? (
              <Ionicons name="checkmark" size={15} color={color} />
            ) : (
              <View style={[styles.adaptationDot, { backgroundColor: color }]} />
            )}
            <Text style={[styles.adaptationChipTextStandalone, selected && { color, fontWeight: "700" }]}>
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
  const compact = useContext(CompactFieldsContext)
  const [open, setOpen] = useState(false)
  if (compact) {
    // Same as the compact AdaptationPicker: one pill for the current grade,
    // the full set only while choosing.
    const current = BoulderLevelOptions.find((g) => g.value === value)
    return (
      <View style={{ gap: 6 }}>
        <Pressable
          style={[
            styles.adaptationPill,
            current ? { backgroundColor: current.color, borderColor: current.color } : { borderColor: C.border, backgroundColor: C.bg },
          ]}
          onPress={() => setOpen((o) => !o)}
        >
          {current && <View style={[styles.gradeDot, { backgroundColor: current.on }]} />}
          <Text style={[styles.adaptationPillText, { color: current ? current.on : C.textSecondary }]}>
            {current ? current.label : "Pick a grade"}
          </Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={13} color={current ? current.on : C.textSecondary} />
        </Pressable>
        {open && (
          <View style={styles.adaptationRow}>
            {BoulderLevelOptions.filter((g) => g.value !== value).map((g) => (
              <Pressable key={g.value} style={styles.adaptationChip} onPress={() => { onChange(g.value); setOpen(false) }}>
                <View style={[styles.gradeDot, { backgroundColor: g.color }]} />
                <Text style={styles.adaptationChipText}>{g.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    )
  }
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

// A 2×3 dot grid reads as "drag me" more clearly than a "☰" glyph.
function DragGripIcon() {
  return (
    <View style={styles.dragGrip}>
      {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={styles.dragGripDot} />)}
    </View>
  )
}

function FieldLabel({ label }: { label: string }) {
  const compact = useContext(CompactFieldsContext)
  return <Text style={[styles.fieldLabel, compact && styles.fieldLabelCompact]}>{label}</Text>
}

// Collapsed description preview: ~3 lines of 14px text.
const FIELD_PREVIEW_LINE_HEIGHT = 19
const FIELD_PREVIEW_TEXT_HEIGHT = FIELD_PREVIEW_LINE_HEIGHT * 3

function FieldInput({ value, onChange, placeholder, numeric, multiline }: {
  value: string; onChange: (v: string) => void; placeholder?: string; numeric?: boolean; multiline?: boolean
}) {
  const compact = useContext(CompactFieldsContext)
  // Compact: long text shows as a short preview until tapped, fading out
  // at the bottom when it runs past the preview's height.
  const [editing, setEditing] = useState(false)
  const [overflows, setOverflows] = useState(false)
  if (compact && multiline && !editing) {
    return (
      <Pressable style={[styles.fieldInput, styles.fieldInputCompact, styles.fieldPreview]} onPress={() => setEditing(true)}>
        {/* Not clamped with numberOfLines — its full height is what tells us
            whether it overflows the preview box. */}
        <Text
          style={value ? styles.fieldPreviewText : styles.fieldPreviewPlaceholder}
          onLayout={(e) => setOverflows(e.nativeEvent.layout.height > FIELD_PREVIEW_TEXT_HEIGHT + 1)}
        >
          {value || placeholder || "Add a description…"}
        </Text>
        {overflows && (
          <LinearGradient
            pointerEvents="none"
            colors={[C.bg + "00", C.bg]}
            style={styles.fieldPreviewFade}
          />
        )}
      </Pressable>
    )
  }
  return (
    <TextInput
      style={[styles.fieldInput, multiline && styles.fieldInputMultiline, compact && styles.fieldInputCompact]}
      value={value} onChangeText={onChange} placeholder={placeholder}
      placeholderTextColor="#aaa" keyboardType={numeric ? "numeric" : "default"} multiline={multiline}
      autoFocus={compact && multiline}
      onBlur={() => setEditing(false)}
    />
  )
}

// A labelled numeric field that shares a row with siblings instead of taking
// a full-width row on its own.
function NumField({ label, value, onChange }: {
  label: string; value: number; onChange: (n: number) => void
}) {
  return (
    <View style={styles.numField}>
      <FieldLabel label={label} />
      <FieldInput value={String(value)} onChange={(v) => onChange(parseInt(v) || 0)} numeric />
    </View>
  )
}

// m:ss is far more scannable mid-workout than a raw second count.
function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// Accepts "3:00" or a bare "180" (seconds) so quick edits still work.
function parseDuration(text: string): number {
  const trimmed = text.trim()
  if (trimmed.includes(":")) {
    const [m, s] = trimmed.split(":")
    return (parseInt(m) || 0) * 60 + (parseInt(s) || 0)
  }
  return parseInt(trimmed) || 0
}

// A rest/duration field displayed as m:ss instead of raw seconds. Keeps its
// own text while typing so "3:0…" isn't reformatted out from under the user;
// commits (and reformats) on blur.
function RestField({ label, value, onChange }: {
  label: string; value: number; onChange: (n: number) => void
}) {
  const [text, setText] = useState(formatDuration(value))
  useEffect(() => { setText(formatDuration(value)) }, [value])
  return (
    <View style={styles.numField}>
      <FieldLabel label={label} />
      <TextInput
        style={styles.fieldInput}
        value={text}
        onChangeText={setText}
        onBlur={() => { const secs = parseDuration(text); setText(formatDuration(secs)); onChange(secs) }}
        placeholder="0:00"
        placeholderTextColor="#aaa"
        keyboardType="numbers-and-punctuation"
      />
    </View>
  )
}

// Same idea as NumField, but as a −/value/+ stepper instead of a raw text
// box — used by the standalone editor, where there's room and the mockup
// calls for it.
function StepperField({ label, value, onChange, min = 0, step = 1 }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; step?: number
}) {
  const compact = useContext(CompactFieldsContext)
  if (compact) return <CompactStepper label={label} display={String(value)} onMinus={() => onChange(Math.max(min, value - step))} onPlus={() => onChange(value + step)} />
  return (
    <View style={styles.stepperField}>
      <FieldLabel label={label} />
      <View style={styles.stepperControl}>
        <Pressable onPress={() => onChange(Math.max(min, value - step))} style={styles.stepperBtn} hitSlop={8}>
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue} numberOfLines={1}>{value}</Text>
        <Pressable onPress={() => onChange(value + step)} style={styles.stepperBtn} hitSlop={8}>
          <Text style={styles.stepperBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

// StepperField's duration counterpart — steps in 15s increments, shown as m:ss.
function StepperRestField({ label, value, onChange, min = 0, step = 15 }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; step?: number
}) {
  const compact = useContext(CompactFieldsContext)
  if (compact) return <CompactStepper label={label} display={formatDuration(value)} onMinus={() => onChange(Math.max(min, value - step))} onPlus={() => onChange(value + step)} />
  return (
    <View style={styles.stepperField}>
      <FieldLabel label={label} />
      <View style={styles.stepperControl}>
        <Pressable onPress={() => onChange(Math.max(min, value - step))} style={styles.stepperBtn} hitSlop={8}>
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue} numberOfLines={1}>{formatDuration(value)}</Text>
        <Pressable onPress={() => onChange(value + step)} style={styles.stepperBtn} hitSlop={8}>
          <Text style={styles.stepperBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

// Dense stepper for grid cards: "Label  −  value  +" in one 34px pill.
function CompactStepper({ label, display, onMinus, onPlus }: {
  label: string; display: string; onMinus: () => void; onPlus: () => void
}) {
  return (
    <View style={styles.compactStepper}>
      <Text style={styles.compactStepperLabel} numberOfLines={1}>{label}</Text>
      <Pressable onPress={onMinus} style={styles.compactStepperBtn} hitSlop={6}>
        <Text style={styles.compactStepperBtnText}>−</Text>
      </Pressable>
      <Text style={styles.compactStepperValue} numberOfLines={1}>{display}</Text>
      <Pressable onPress={onPlus} style={styles.compactStepperBtn} hitSlop={6}>
        <Text style={styles.compactStepperBtnText}>+</Text>
      </Pressable>
    </View>
  )
}

// Grid cards' time limit: a chip when off, a ⏱ stepper when on (stepping
// below 1 minute turns it back off).
function TimeLimitChip({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
  const mins = block.timeLimit ?? 0
  if (mins <= 0) {
    return (
      <Pressable style={styles.compactStepper} onPress={() => onUpdate({ ...block, timeLimit: 10 })}>
        <Text style={styles.compactStepperLabel}>⏱ No limit</Text>
        <Ionicons name="add" size={14} color={C.textSecondary} />
      </Pressable>
    )
  }
  return (
    <CompactStepper
      label="⏱" display={`${mins}m`}
      onMinus={() => onUpdate({ ...block, timeLimit: Math.max(0, mins - 1) })}
      onPlus={() => onUpdate({ ...block, timeLimit: mins + 1 })}
    />
  )
}

// The short numeric fields for a block, rendered as a compact row so they can
// sit beside the Block name input. Returns null for types with no numerics.
function BlockNumerics({ block, onUpdate, standalone }: { block: Block; onUpdate: (b: Block) => void; standalone?: boolean }) {
  const compact = useContext(CompactFieldsContext)
  function update(fields: any) { onUpdate({ ...block, ...fields } as Block) }
  const Field = standalone ? StepperField : NumField
  const Rest = standalone ? StepperRestField : RestField
  let fields: React.ReactNode = null
  switch (block.type) {
    case "project_bouldering":
      fields = (<>
        <Field label="Attempts" value={block.targetAttempts} onChange={(n) => update({ targetAttempts: n })} min={1} />
        <Rest label="Rest" value={block.restTime} onChange={(n) => update({ restTime: n })} />
      </>); break
    case "four_by_four":
      fields = (<>
        <Field label="Sets" value={block.sets} onChange={(n) => update({ sets: n })} min={1} />
        <Field label="Per set" value={block.bouldersPerSet} onChange={(n) => update({ bouldersPerSet: n })} min={1} />
        <Rest label="Rest" value={block.restTime} onChange={(n) => update({ restTime: n })} />
      </>); break
    case "intervals":
      fields = (<>
        <Field label="Series" value={block.series} onChange={(n) => update({ series: n })} min={1} />
        <Rest label={standalone ? "Work" : "Work (s)"} value={block.workTime} onChange={(n) => update({ workTime: n })} />
        <Rest label="Rest" value={block.restTime} onChange={(n) => update({ restTime: n })} />
      </>); break
    case "strength_conditioning":
      fields = (<>
        <Field label="Rounds" value={block.rounds} onChange={(n) => update({ rounds: n })} min={1} />
        <Rest label="Rest" value={block.restBetweenRounds} onChange={(n) => update({ restBetweenRounds: n })} />
      </>); break
    case "sequence":
      fields = (<>
        <Field label="Attempts" value={block.targetAttempts} onChange={(n) => update({ targetAttempts: n })} min={1} />
        <Rest label="Rest" value={block.restTime} onChange={(n) => update({ restTime: n })} />
      </>); break
    case "constraint_warmup":
      fields = (
        <Field label="Attempts" value={block.targetAttempts} onChange={(n) => update({ targetAttempts: n })} min={1} />
      ); break
    default:
      if (!compact) return null
  }
  if (compact) {
    return (
      <View style={styles.numericsRowCompact}>
        {fields}
        <TimeLimitChip block={block} onUpdate={onUpdate} />
      </View>
    )
  }
  return <View style={standalone ? styles.numericsRowStandalone : styles.numericsRow}>{fields}</View>
}

// Universal time-constraint field — every block can optionally cap its duration.
function TimeLimitField({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
  return (
    <View style={styles.timeLimitRow}>
      <FieldLabel label="Time limit (min · 0 = none)" />
      <FieldInput
        value={String(block.timeLimit ?? 0)}
        onChange={(v) => onUpdate({ ...block, timeLimit: parseInt(v) || 0 })}
        numeric
        placeholder="0"
      />
    </View>
  )
}

// Standalone editor's Time limit row: an Off/On switch, with a minutes
// stepper that only appears once it's on.
function TimeLimitToggle({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
  const enabled = (block.timeLimit ?? 0) > 0
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.timeLimitToggleRow}>
        <Text style={styles.timeLimitToggleLabel}>Time limit</Text>
        <View style={styles.timeLimitToggleRight}>
          <Text style={styles.timeLimitToggleStatus}>{enabled ? `${block.timeLimit} min` : "Off"}</Text>
          <Switch
            value={enabled}
            onValueChange={(v) => onUpdate({ ...block, timeLimit: v ? (block.timeLimit || 10) : 0 })}
            trackColor={{ true: C.green, false: C.surfaceHigh }}
            thumbColor={C.textPrimary}
          />
        </View>
      </View>
      {enabled && (
        <StepperField
          label="Minutes"
          value={block.timeLimit ?? 10}
          onChange={(n) => onUpdate({ ...block, timeLimit: Math.max(1, n) })}
          min={1}
        />
      )}
    </View>
  )
}

function ProjectBoulderingFields({ block, onUpdate }: { block: ProjectBoulderingBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<ProjectBoulderingBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
    </>
  )
}

// A 4×4 block's boulder slots as numbered colour circles. With `onSelect`,
// tapping a slot selects it (the editor then recolours the selected slot).
function BoulderSlots({ grades, selected, onSelect }: {
  grades: (string | null)[]
  selected?: number
  onSelect?: (i: number) => void
}) {
  return (
    <View style={styles.boulderSlotRow}>
      {grades.map((g, i) => {
        const opt = BoulderLevelOptions.find((o) => o.value === g)
        return (
          <Pressable
            key={i}
            disabled={!onSelect}
            onPress={() => onSelect?.(i)}
            style={[
              styles.boulderSlot,
              opt ? { backgroundColor: opt.color, borderColor: opt.color } : styles.boulderSlotEmpty,
              selected === i && styles.boulderSlotSelected,
            ]}
          >
            <Text style={[styles.boulderSlotText, { color: opt ? opt.on : C.textMuted }]}>{i + 1}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function FourByFourFields({ block, onUpdate }: { block: FourByFourBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<FourByFourBlock>) { onUpdate({ ...block, ...fields }) }
  const n = block.bouldersPerSet ?? 4
  const grades = authoredGrades(block)
  const [slot, setSlot] = useState(0)

  // Recolour the selected slot. With no colours set yet, the first pick
  // colours every slot, so the coach only has to adjust the ones that differ.
  function pickColour(colour: string) {
    update({ boulderGrades: grades ? grades.map((g, i) => (i === slot ? colour : g)) : fitGrades([colour], n)! })
  }

  // When authoring for a specific athlete, show what the progression rule
  // suggests for them next (the same suggestion FourByFourBlock.tsx shows
  // the athlete — utils/progression/fourByFour.ts), with a one-tap way to use it.
  const athleteId = useContext(AuthoringAthleteContext)
  const [suggestion, setSuggestion] = useState<FourByFourSuggestion | null>(null)
  useEffect(() => {
    setSuggestion(null)
    if (!athleteId) return
    let cancelled = false
    Promise.all([getSessionsByUserId(athleteId), getUsers(athleteId)])
      .then(([sessions, user]) => {
        if (cancelled) return
        const runs = findBlockRuns(sessions, { type: "four_by_four", blockName: block.blockName, libraryBlockId: block.libraryBlockId })
        // Judged against the block as saved, not the colours being edited —
        // otherwise the first-session suggestion would vanish mid-edit.
        setSuggestion(suggestNextFourByFour(runs, { bouldersPerSet: n, flashLevel: (user as any)?.flashLevel, authored: null }))
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [athleteId, block.blockName, block.libraryBlockId, n])
  const suggestionApplied = !!suggestion && !!grades && suggestion.grades.join() === grades.join()

  return (
    <>
      {!!suggestion && (
        <View style={styles.progressionFlag}>
          <Text style={styles.progressionFlagTitle}>Progression for this athlete</Text>
          <Text style={styles.progressionFlagLast}>{suggestion.lastTime}</Text>
          <Text style={styles.progressionFlagText}>{suggestion.note}</Text>
          <BoulderSlots grades={suggestion.grades} />
          {suggestionApplied ? (
            <Text style={styles.progressionFlagText}>✓ Using it</Text>
          ) : (
            <Pressable onPress={() => update({ boulderGrades: suggestion.grades })} hitSlop={6}>
              <Text style={styles.progressionFlagAction}>Use these colours</Text>
            </Pressable>
          )}
        </View>
      )}
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <Text style={styles.fieldLabel}>
        Boulder colours{" "}
        <Text style={styles.fieldLabelHint}>· blank = one below the athlete&apos;s flash level</Text>
      </Text>
      <BoulderSlots grades={grades ?? Array(n).fill(null)} selected={grades ? slot : undefined} onSelect={setSlot} />
      <GradePicker value={grades?.[slot] ?? ""} onChange={pickColour} />
      {!!grades && (
        <Pressable onPress={() => update({ boulderGrades: undefined })} hitSlop={6}>
          <Text style={styles.boulderSlotClear}>Clear colours</Text>
        </Pressable>
      )}
    </>
  )
}

function IntervalsFields({ block, onUpdate }: { block: IntervalsBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<IntervalsBlock>) { onUpdate({ ...block, ...fields }) }

  // When authoring for a specific athlete, show what the progression rule
  // suggests for them next (the same suggestion IntervalsBlock.tsx shows the
  // athlete — utils/progression/intervals.ts), with a one-tap way to use it.
  const athleteId = useContext(AuthoringAthleteContext)
  const [suggestion, setSuggestion] = useState<IntervalsSuggestion | null>(null)
  useEffect(() => {
    setSuggestion(null)
    if (!athleteId || !block.kind) return
    let cancelled = false
    getSessionsByUserId(athleteId)
      .then((sessions) => {
        if (cancelled) return
        const runs = findBlockRuns(sessions, { type: "intervals", blockName: block.blockName, libraryBlockId: block.libraryBlockId })
        setSuggestion(suggestNextIntervals(runs, block.kind))
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [athleteId, block.blockName, block.libraryBlockId, block.kind])

  return (
    <>
      {!!suggestion && (
        <View style={styles.progressionFlag}>
          <Text style={styles.progressionFlagTitle}>Progression for this athlete</Text>
          <Text style={styles.progressionFlagLast}>{suggestion.lastTime}</Text>
          <Text style={styles.progressionFlagText}>{suggestion.note}</Text>
          {block.workTime === suggestion.workTime && block.series === suggestion.series ? (
            <Text style={styles.progressionFlagText}>✓ Using it</Text>
          ) : (
            <Pressable onPress={() => update({ workTime: suggestion.workTime, series: suggestion.series })} hitSlop={6}>
              <Text style={styles.progressionFlagAction}>Use {suggestion.series} × {suggestion.workTime} s</Text>
            </Pressable>
          )}
        </View>
      )}
      <Text style={styles.fieldLabel}>
        Kind{" "}
        <Text style={styles.fieldLabelHint}>· sets the progression rule</Text>
      </Text>
      <View style={styles.adaptationRow}>
        {(Object.keys(INTERVALS_KIND_LABEL) as IntervalsKind[]).map((k) => {
          const selected = block.kind === k
          return (
            <Pressable
              key={k}
              onPress={() => update(
                selected ? { kind: undefined }
                // Warm-up intervals are always 4 rounds (coach's rule).
                : k === "warmup" ? { kind: k, series: INTERVALS_RULES.warmupSeries }
                : { kind: k }
              )}
              style={[styles.adaptationChip, selected && { backgroundColor: C.green, borderColor: C.green }]}
            >
              <Text style={[styles.adaptationChipText, selected && { color: C.bg, fontWeight: "700" }]}>
                {INTERVALS_KIND_LABEL[k]}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <FieldLabel label="Description" />
      <Text style={styles.generatedDesc}>{intervalsDescription(block)}</Text>
      <Text style={styles.fieldLabel}>
        Notes{" "}
        <Text style={styles.fieldLabelHint}>· optional, shown under the description</Text>
      </Text>
      <FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
    </>
  )
}

function ConstraintWarmupFields({ block, onUpdate }: { block: ConstraintWarmupBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<ConstraintWarmupBlock>) { onUpdate({ ...block, ...fields }) }
  const rotation = rotationFor(block)
  const isDefault = !block.rotation
  const hasDefault = !!defaultRotation(block.blockName)
  const [savingRotation, setSavingRotation] = useState(false)

  // Rotation settings apply to the constraint everywhere, so they're written
  // straight to its library block (what the rotation reads) as well as this
  // copy — the coach can tune them from any editor.
  async function setRotation(next: ConstraintRotation | undefined) {
    update({ rotation: next })
    if (!block.libraryBlockId) return
    setSavingRotation(true)
    try {
      const row = (await listBlocksByType("constraint_warmup")).find((r) => r.$id === block.libraryBlockId)
      if (!row) return
      let data: any = {}
      try { data = JSON.parse(row.data || "{}") } catch { /* overwrite below */ }
      if (next) data.rotation = next
      else delete data.rotation
      await updateBlock(row.$id, { name: row.name, type: row.type, data })
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "The rotation settings weren't saved to the library block.")
    } finally {
      setSavingRotation(false)
    }
  }
  function togglePillar(p: WarmupPillar) {
    const cur = rotation?.pillars ?? []
    const pillars = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
    // No pillars left = out of the rotation (kept as own settings so a
    // constraint with a default can be taken out too).
    setRotation({ pillars, colours: rotation?.colours ?? block.rotation?.colours ?? "below_flash" })
  }
  function setColours(c: ColourRange) {
    if (!rotation) return
    setRotation({ pillars: rotation.pillars, colours: c })
  }

  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <FieldLabel label="Grade" /><GradePicker value={block.level} onChange={(v) => update({ level: v })} />

      <Text style={styles.fieldLabel}>
        Warm-up rotation{" "}
        <Text style={styles.fieldLabelHint}>
          · {!rotation ? "not in the rotation — pick a pillar to add it"
            : isDefault ? "default settings" : "your settings"}
          {savingRotation ? " · saving…" : ""}
        </Text>
      </Text>
      <View style={styles.adaptationRow}>
        {(Object.keys(WARMUP_PILLAR_LABEL) as WarmupPillar[]).map((p) => {
          const on = !!rotation?.pillars.includes(p)
          return (
            <Pressable key={p} onPress={() => togglePillar(p)} style={[styles.adaptationChip, on && { backgroundColor: C.green, borderColor: C.green }]}>
              <Text style={[styles.adaptationChipText, on && { color: C.bg, fontWeight: "700" }]}>{WARMUP_PILLAR_LABEL[p]}</Text>
            </Pressable>
          )
        })}
      </View>
      {!!rotation && (
        <>
          <Text style={styles.fieldLabel}>Colours <Text style={styles.fieldLabelHint}>· relative to the athlete&apos;s flash level</Text></Text>
          <View style={styles.adaptationRow}>
            {(Object.keys(COLOUR_RANGE_LABEL) as ColourRange[]).map((c) => {
              const on = rotation.colours === c
              return (
                <Pressable key={c} onPress={() => setColours(c)} style={[styles.adaptationChip, on && { backgroundColor: C.green, borderColor: C.green }]}>
                  <Text style={[styles.adaptationChipText, on && { color: C.bg, fontWeight: "700" }]}>{COLOUR_RANGE_LABEL[c]}</Text>
                </Pressable>
              )
            })}
          </View>
        </>
      )}
      {!isDefault && hasDefault && (
        <Pressable onPress={() => setRotation(undefined)} hitSlop={6}>
          <Text style={styles.boulderSlotClear}>Back to default</Text>
        </Pressable>
      )}
      {!block.libraryBlockId && (
        <Text style={styles.fieldLabelHint}>Only constraints saved in the library are used by the rotation.</Text>
      )}
    </>
  )
}

const SC_TYPES: { type: "reps" | "both_sides" | "7/3s"; label: string }[] = [
  { type: "reps", label: "Reps" },
  { type: "both_sides", label: "Both sides" },
  { type: "7/3s", label: "7/3s" },
]

// When present, an ancestor (the workout builder) hosts the exercise library
// as an overlay over the protocol-detail pane. S&C fields then show a trigger
// button instead of an inline library.
// True inside the protocol builder's grid cards — fields render in their
// dense variant (inline-labelled steppers, collapsed descriptions, smaller
// labels) so a card stays close to exercise-card size.
const CompactFieldsContext = createContext(false)

export type SCLibraryController = { open: (blockId: string) => void }
export const SCLibraryContext = createContext<SCLibraryController | null>(null)

// When present, the coach is authoring for a specific athlete — lets
// StrengthConditioningFields flag when that athlete has already progressed
// past a level-mode exercise being authored, without prop-drilling athleteId
// through every intermediate editor layer (same reasoning as SCLibraryContext).
export const AuthoringAthleteContext = createContext<string | null>(null)

// Build a block Exercise from a library row, applying its defaults.
export function exerciseFromLibrary(ex: ExerciseRow): Exercise {
  return { id: generateId(), ...exerciseDraftFromLibrary(ex) }
}

// Exercise library: grouped by type, items as wrapping chips sized to their
// name; one tap adds. `inline` renders a bordered side card; `overlay` fills
// its parent (used as a pane on top of the protocol detail) with a close button.
export function ExerciseLibraryPane({ onAdd, wide = false, variant = "inline", onClose }: {
  onAdd: (ex: ExerciseRow) => void
  wide?: boolean
  variant?: "inline" | "overlay"
  onClose?: () => void
}) {
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createType, setCreateType] = useState<"reps" | "both_sides" | "7/3s" | null>(null)
  const [search, setSearch] = useState("")
  const overlay = variant === "overlay"
  const containerStyle = overlay ? styles.libOverlayInner : [styles.libPane, wide && styles.libPaneWide]
  const query = search.trim().toLowerCase()

  function reload() {
    setLoading(true)
    listExercises().then(setExercises).catch(console.error).finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [])

  if (createType) {
    return (
      <View style={containerStyle}>
        <ExerciseForm
          fixedType={createType}
          title={`New ${EXERCISE_TYPE_LABEL[createType]} exercise`}
          saveLabel="Create & add"
          onCancel={() => setCreateType(null)}
          onCreated={(ex) => { setCreateType(null); reload(); onAdd(ex) }}
        />
      </View>
    )
  }

  const totalMatches = query ? exercises.filter((e) => e.name.toLowerCase().includes(query)).length : exercises.length

  return (
    <View style={containerStyle}>
      <View style={styles.libHeader}>
        <Text style={styles.libTitle}>Exercise library</Text>
        {overlay && (
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={C.textSecondary} />
          </Pressable>
        )}
      </View>
      {!loading && exercises.length > 0 && (
        <View style={styles.libSearchWrap}>
          <Ionicons name="search" size={14} color={C.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search exercises"
            placeholderTextColor={C.textMuted}
            style={styles.libSearchInput}
            autoCorrect={false}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")} hitSlop={10}>
              <Ionicons name="close-circle" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      )}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} />
      ) : query && totalMatches === 0 ? (
        <Text style={styles.libEmpty}>No exercises match “{search.trim()}”.</Text>
      ) : (
        <ScrollView
          style={overlay ? undefined : styles.libScroll}
          contentContainerStyle={overlay ? { paddingBottom: 20 } : undefined}
          nestedScrollEnabled keyboardShouldPersistTaps="handled"
        >
          {SC_TYPES.map((g) => {
            const items = exercises.filter((e) => e.type === g.type && (!query || e.name.toLowerCase().includes(query)))
            // While searching, skip a type entirely once it has no matches —
            // showing "None yet" here would misleadingly imply the type has
            // no exercises at all, rather than just none matching the search.
            if (query && items.length === 0) return null
            return (
              <View key={g.type} style={styles.libGroup}>
                <View style={styles.libGroupHeader}>
                  <Text style={styles.libGroupLabel}>{g.label}</Text>
                  <Pressable onPress={() => setCreateType(g.type)} hitSlop={6}>
                    <Text style={styles.libNew}>+ New</Text>
                  </Pressable>
                </View>
                {items.length === 0 ? (
                  <Text style={styles.libEmpty}>None yet</Text>
                ) : (
                  <View style={styles.libChips}>
                    {items.map((ex) => (
                      <Pressable key={ex.$id} style={styles.libChip} onPress={() => onAdd(ex)}>
                        <Ionicons name="add" size={15} color={C.green} />
                        <Text style={styles.libChipText}>{ex.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}

// ─── Exercise card grid (wide screens) ─────────────────────────────────────────
// Renders the block's exercises as reorderable, numbered cards that wrap into
// a grid instead of one long vertical stack. Reordering is a long-press drag
// on the grip handle: the dragged card is lifted out of flow and follows the
// finger while its siblings slide into place (Reanimated's layout transition
// handles that automatically); the array is reordered live as it crosses into
// a neighboring card's bounds, so what you see while dragging is already the
// real order.
// Lets a grid card ask its cell to grow by `extra` px (negative shrinks back
// toward the column width) so content that shouldn't wrap fits. Null outside
// the card grid.
const CardFitWidthContext = createContext<((extra: number) => void) | null>(null)

const EXERCISE_CARD_GAP = 12
const EXERCISE_CARD_MIN_WIDTH = 260
const EXERCISE_CARD_MAX_COLUMNS = 3
// Narrowest card grid that still fits the full column count.
export const CARD_GRID_FULL_COLUMNS_WIDTH = EXERCISE_CARD_MAX_COLUMNS * EXERCISE_CARD_MIN_WIDTH + (EXERCISE_CARD_MAX_COLUMNS - 1) * EXERCISE_CARD_GAP

// Generic over the item type so the protocol builder can lay its blocks out
// the same way (see BlockCard).
// With `onResize`, each card also gets a handle on its right edge: drag to
// set that card's width (`widths`, by id), double-click/tap to reset it to
// the auto column width.
const CARD_RESIZE_MIN_WIDTH = 220

// Column count + stretched card width for a grid `gridWidth` wide.
function gridColumns(gridWidth: number) {
  const columns = Math.max(1, Math.min(EXERCISE_CARD_MAX_COLUMNS, Math.floor((gridWidth + EXERCISE_CARD_GAP) / (EXERCISE_CARD_MIN_WIDTH + EXERCISE_CARD_GAP))))
  return { columns, cardWidth: (gridWidth - EXERCISE_CARD_GAP * (columns - 1)) / columns }
}

// Each card's rendered width: a dragged width or the column width, widened to
// what its content asked for, capped at the grid.
function gridCellWidth(gridWidth: number, cardWidth: number, custom?: number, fit?: number) {
  const base = custom != null ? Math.min(custom, gridWidth) : cardWidth
  return fit != null && fit > base ? Math.min(fit, gridWidth) : base
}

// Width the grid needs to show its cards exactly as they'd wrap in
// `available` px — the widest row. Cards widened past the column width (long
// S&C names) break rows early and leave a gap at their ends; hugging the
// widest row drops the part of that gap shared by every row. A single row is
// just a partial row, so it keeps the full width.
function huggedGridWidth(available: number, ids: string[], widths: Record<string, number> | undefined, fits: Record<string, number>) {
  const { cardWidth } = gridColumns(available)
  let rows = 0
  let rowUsed = 0
  let widest = 0
  for (const id of ids) {
    const w = gridCellWidth(available, cardWidth, widths?.[id], fits[id])
    if (rows === 0 || rowUsed + EXERCISE_CARD_GAP + w > available + 0.5) { rows++; rowUsed = w }
    else rowUsed += EXERCISE_CARD_GAP + w
    widest = Math.max(widest, rowUsed)
  }
  return rows > 1 ? Math.ceil(widest) : available
}

export function ReorderableCardGrid<T extends { id: string }>({ items: exercises, renderCard, onReorder, widths, onResize, fitWithin }: {
  items: T[]
  renderCard: (item: T) => React.ReactNode
  onReorder: (next: T[]) => void
  widths?: Record<string, number>
  onResize?: (id: string, width: number | null) => void
  // Host-sized grid (protocol builder): lay out for `available` px but take
  // only the width the wrapped rows use (see huggedGridWidth), reported via
  // `onWidth` so the host can hand the leftover to something else. Columns
  // stay uniform — content that wants a wider card (long S&C names) instead
  // raises `onNeed`, the grid width at which every column fits it, for the
  // host to make room; short of that, the content truncates.
  fitWithin?: { available: number; onWidth: (w: number) => void; onNeed: (w: number) => void }
}) {
  const [measuredWidth, setMeasuredWidth] = useState(0)
  // Width each card asked for to fit content that shouldn't wrap.
  const [fits, setFits] = useState<Record<string, number>>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Card being resized + its width when the drag began.
  const [resizingId, setResizingId] = useState<string | null>(null)
  // Frozen mid-drag/resize so the grid doesn't reflow under the pointer.
  const fitWidthRef = useRef(0)
  // Columns and caps come from the full width; the grid itself may be narrower.
  const layoutWidth = fitWithin ? fitWithin.available : measuredWidth
  // Fits widen individual cards only in a self-sized grid.
  const cardFits = fitWithin ? {} : fits
  if (fitWithin && layoutWidth > 0 && !draggingId && !resizingId) {
    fitWidthRef.current = huggedGridWidth(layoutWidth, exercises.map((e) => e.id), widths, cardFits)
  }
  const gridWidth = fitWithin ? fitWidthRef.current : measuredWidth
  const onFitWidth = fitWithin?.onWidth
  useEffect(() => { if (onFitWidth && gridWidth > 0) onFitWidth(gridWidth) }, [onFitWidth, gridWidth])
  const widestFit = Math.max(EXERCISE_CARD_MIN_WIDTH, ...exercises.map((e) => fits[e.id] ?? 0))
  const neededWidth = EXERCISE_CARD_MAX_COLUMNS * widestFit + (EXERCISE_CARD_MAX_COLUMNS - 1) * EXERCISE_CARD_GAP
  const onNeed = fitWithin?.onNeed
  useEffect(() => { onNeed?.(neededWidth) }, [onNeed, neededWidth])
  const cardWidth = layoutWidth > 0 ? gridColumns(layoutWidth).cardWidth : undefined

  // Each card's last-known rect relative to this grid, kept fresh by its own
  // onLayout — read during a drag to find which neighbor the pointer is over,
  // and to know where to pin the dragged card once it's lifted out of flow.
  const rectsRef = useRef<Record<string, { x: number; y: number; width: number; height: number }>>({})
  // The live order, mirrored outside React state so drag math (called many
  // times per second) always reads the latest order without waiting on a
  // re-render.
  const orderRef = useRef(exercises)
  useEffect(() => { orderRef.current = exercises }, [exercises])
  const resizeStartWidthRef = useRef(0)

  function handleResizeStart(id: string) {
    resizeStartWidthRef.current = rectsRef.current[id]?.width ?? cardWidth ?? CARD_RESIZE_MIN_WIDTH
    setResizingId(id)
  }
  function handleResizeMove(id: string, dx: number) {
    const max = layoutWidth > 0 ? layoutWidth : Infinity
    onResize?.(id, Math.round(Math.min(max, Math.max(CARD_RESIZE_MIN_WIDTH, resizeStartWidthRef.current + dx))))
  }

  function handleDragMove(id: string, dx: number, dy: number) {
    const start = rectsRef.current[id]
    if (!start) return
    const px = start.x + start.width / 2 + dx
    const py = start.y + start.height / 2 + dy
    const cur = orderRef.current
    const from = cur.findIndex((e) => e.id === id)
    if (from === -1) return
    for (const other of cur) {
      if (other.id === id) continue
      const r = rectsRef.current[other.id]
      if (!r) continue
      if (px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height) {
        const to = cur.findIndex((e) => e.id === other.id)
        if (to === -1 || to === from) return
        const next = cur.slice()
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        orderRef.current = next
        onReorder(next)
        return
      }
    }
  }

  return (
    <View
      style={[styles.exGrid, fitWithin && gridWidth > 0 && { width: gridWidth }]}
      onLayout={fitWithin ? undefined : (e) => setMeasuredWidth(e.nativeEvent.layout.width)}
    >
      {exercises.map((ex, index) => (
        <ExerciseGridCell
          key={ex.id}
          index={index}
          width={cardWidth == null ? undefined : gridCellWidth(layoutWidth, cardWidth, widths?.[ex.id], cardFits[ex.id])}
          onFit={(w) => setFits((prev) => (prev[ex.id] === w ? prev : { ...prev, [ex.id]: w }))}
          isDragging={draggingId === ex.id}
          animateLayout={!resizingId}
          resize={onResize ? {
            onStart: () => handleResizeStart(ex.id),
            onMove: (dx) => handleResizeMove(ex.id, dx),
            onEnd: () => setResizingId(null),
            onReset: () => onResize(ex.id, null),
          } : undefined}
          origin={draggingId === ex.id ? rectsRef.current[ex.id] : undefined}
          onLayout={(rect) => { rectsRef.current[ex.id] = rect }}
          onDragStart={() => setDraggingId(ex.id)}
          onDragMove={(dx, dy) => handleDragMove(ex.id, dx, dy)}
          onDragEnd={() => setDraggingId(null)}
        >
          {renderCard(ex)}
        </ExerciseGridCell>
      ))}
    </View>
  )
}

function ExerciseGridCell({ index, width, onFit, isDragging, animateLayout, resize, origin, onLayout, onDragStart, onDragMove, onDragEnd, children }: {
  index: number
  width?: number
  onFit: (width: number) => void
  isDragging: boolean
  // Off while any card is being resized — animating every width step lags
  // behind the pointer.
  animateLayout: boolean
  resize?: { onStart: () => void; onMove: (dx: number) => void; onEnd: () => void; onReset: () => void }
  origin?: { x: number; y: number; width: number; height: number }
  onLayout: (rect: { x: number; y: number; width: number; height: number }) => void
  onDragStart: () => void
  onDragMove: (dx: number, dy: number) => void
  onDragEnd: () => void
  children: React.ReactNode
}) {
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)

  // Turns the content's "need `extra` px more" (see CardFitWidthContext) into
  // an absolute width for the grid to apply.
  const renderedWidthRef = useRef(0)
  const onFitRef = useRef(onFit)
  onFitRef.current = onFit
  const requestFit = useCallback((extra: number) => {
    if (Math.abs(extra) <= 1 || renderedWidthRef.current === 0) return
    onFitRef.current(Math.round(renderedWidthRef.current + extra))
  }, [])

  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(() => {
      translateX.value = 0
      translateY.value = 0
      runOnJS(onDragStart)()
    })
    .onUpdate((e) => {
      translateX.value = e.translationX
      translateY.value = e.translationY
      runOnJS(onDragMove)(e.translationX, e.translationY)
    })
    .onEnd(() => {
      translateX.value = 0
      translateY.value = 0
      runOnJS(onDragEnd)()
    })

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }))

  // Right-edge resize: drag sets the width, a double tap resets it.
  const resizeGesture = resize ? Gesture.Race(
    Gesture.Pan()
      .onStart(() => { runOnJS(resize.onStart)() })
      .onUpdate((e) => { runOnJS(resize.onMove)(e.translationX) })
      .onEnd(() => { runOnJS(resize.onEnd)() }),
    Gesture.Tap().numberOfTaps(2).onEnd(() => { runOnJS(resize.onReset)() }),
  ) : null

  return (
    <ReAnimated.View
      layout={isDragging || !animateLayout ? undefined : LinearTransition.duration(220)}
      onLayout={(e) => { renderedWidthRef.current = e.nativeEvent.layout.width; onLayout(e.nativeEvent.layout) }}
      style={[
        styles.exGridCell,
        isDragging && origin
          ? { position: "absolute", left: origin.x, top: origin.y, width: origin.width, zIndex: 50, elevation: 12 }
          : { width },
        animatedStyle,
      ]}
    >
      <View style={styles.exCardNumberBadge}><Text style={styles.exCardNumberText}>{index + 1}</Text></View>
      <GestureDetector gesture={pan}>
        <View style={styles.exCardGripHandle}><DragGripIcon /></View>
      </GestureDetector>
      <CardFitWidthContext.Provider value={requestFit}>{children}</CardFitWidthContext.Provider>
      {resizeGesture && (
        <GestureDetector gesture={resizeGesture}>
          <View style={[styles.cardResizeHandle, Platform.OS === "web" && ({ cursor: "col-resize" } as any)]}>
            <View style={styles.cardResizeGrip} />
          </View>
        </GestureDetector>
      )}
    </ReAnimated.View>
  )
}

function StrengthConditioningFields({ block, onUpdate }: { block: StrengthConditioningBlock; onUpdate: (b: Block) => void }) {
  // If a builder hosts the library as an overlay, just trigger it; otherwise
  // fall back to an inline library beside the cards.
  const lib = useContext(SCLibraryContext)
  // Measure our own width (not the window's) — this editor can live inside a
  // half-width card, where the library + cards only fit side by side above ~560.
  const [paneW, setPaneW] = useState(0)
  const wide = paneW >= 560
  function update(fields: Partial<StrengthConditioningBlock>) { onUpdate({ ...block, ...fields }) }
  function addFromLibrary(ex: ExerciseRow) { update({ exercises: [...block.exercises, exerciseFromLibrary(ex)] }) }

  // When authoring for a specific athlete, fetch their history once so a
  // level-mode exercise can flag when they've already progressed past what's
  // being authored here — otherwise the coach might keep programming a step
  // the athlete outgrew sessions ago.
  const athleteId = useContext(AuthoringAthleteContext)
  const [athleteSessions, setAthleteSessions] = useState<SessionRow[] | null>(null)
  const [library, setLibrary] = useState<(ChainMember & { loadStep?: number | null; settingHarder?: string; settingEasier?: string })[] | null>(null)
  useEffect(() => {
    if (!athleteId) { setAthleteSessions(null); return }
    let cancelled = false
    getSessionsByUserId(athleteId).then((rows) => { if (!cancelled) setAthleteSessions(rows) }).catch(() => setAthleteSessions([]))
    // The live library, so the flag sees the full chain (easier levels too)
    // rather than this block's copy of the harder ones only.
    getExerciseLibrary().then((rows) => { if (!cancelled) setLibrary(rows) }).catch(() => {})
    return () => { cancelled = true }
  }, [athleteId])

  // What this athlete's history says about the exercise being authored:
  // what their next session would start on (the same rule their workout
  // prefill uses, at this exercise's focus), the deload / stalled warnings,
  // and for a ladder, where they actually are on it — ahead of the step
  // being authored, behind it, or "tried a harder one and stepped back".
  function athleteProgressFor(ex: Exercise): AthleteProgress | null {
    if (!athleteSessions || ex.type === "7/3s" || ex.movementType === "mobility") return null
    const resolved = resolveExerciseChain(ex, library) ?? undefined
    const ids = resolved ? chainIds(resolved, ex.exerciseId) : [ex.exerciseId].filter((id): id is string => !!id)
    const history = findScSessions(athleteSessions, ids, ex.name, { limit: 10 })
    const row = library ? findLibraryRow(ex, library) : undefined
    const loadStep = row?.loadStep ?? ex.loadStep ?? undefined
    const harder = row?.settingHarder || ex.settingHarder || undefined
    const easier = row?.settingEasier || ex.settingEasier || undefined
    const setting = harder || easier ? { harder, easier } : undefined
    const plan = planNextForFocus({ focus: ex.focus, reps: ex.reps, unit: ex.unit, setting }, resolved, loadStep, "kg", history, "last time")
    const out: AthleteProgress = { ...(plan.note ? { next: plan.note } : {}), flags: plan.flags }

    if (resolved) {
      const session = findLastScSession(athleteSessions, ids, ex.name)
      const finalIdx = session ? chainIndexOf(resolved, session.finalExerciseId) : -1
      if (session && finalIdx >= 0 && finalIdx !== resolved.prescribedIdx) {
        out.level = resolved.chain[finalIdx].name
        out.position = finalIdx > resolved.prescribedIdx ? "ahead" : "behind"
      } else if (session) {
        // Ended on the authored step (or an unmatched old log) — find the
        // hardest level above it reached anywhere else in that session.
        let deepestIdx = resolved.prescribedIdx
        for (const id of session.loggedExerciseIds) deepestIdx = Math.max(deepestIdx, chainIndexOf(resolved, id))
        if (deepestIdx > resolved.prescribedIdx) { out.level = resolved.chain[deepestIdx].name; out.position = "steppedBack" }
      }
    }
    return out.next || out.level || out.flags?.deload || out.flags?.stalled ? out : null
  }

  const renderCard = (ex: Exercise) => (
    <ExerciseEditorRow
      key={ex.id} exercise={ex}
      athleteProgress={athleteProgressFor(ex)}
      onUpdate={(updated) => update({ exercises: block.exercises.map((e) => (e.id === updated.id ? updated : e)) })}
      onDelete={() => update({ exercises: block.exercises.filter((e) => e.id !== ex.id) })}
    />
  )

  // Circuit exercises are meant to hit different movement patterns — flag it
  // (not block it) when two picks in this block share one, since a coach may
  // deliberately superset the same pattern sometimes.
  const movementCollisions = (() => {
    const seen = new Map<string, string[]>()
    for (const ex of block.exercises) {
      if (!ex.movementType) continue
      seen.set(ex.movementType, [...(seen.get(ex.movementType) ?? []), ex.name || "Unnamed"])
    }
    return [...seen.entries()].filter(([, names]) => names.length > 1)
  })()

  // Wide screens get a reorderable, numbered card grid; narrow screens keep
  // the plain vertical stack (no room for a grid, and no mouse to drag with).
  function renderExerciseList() {
    if (wide) {
      return (
        <ReorderableCardGrid
          items={block.exercises}
          renderCard={renderCard}
          onReorder={(next) => update({ exercises: next })}
        />
      )
    }
    return <>{block.exercises.map(renderCard)}</>
  }

  return (
    <View onLayout={(e) => setPaneW(e.nativeEvent.layout.width)}>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Exercises</Text>
      {movementCollisions.length > 0 && (
        <View style={styles.movementWarning}>
          {movementCollisions.map(([mt, names]) => (
            <Text key={mt} style={styles.movementWarningText}>
              {names.join(" + ")} both hit {MOVEMENT_TYPE_LABEL[mt as MovementType] ?? mt} — consider pairing different patterns
            </Text>
          ))}
        </View>
      )}
      {lib ? (
        <View style={styles.scCardsStack}>
          {block.exercises.length === 0
            ? <Text style={styles.scEmptyHint}>No exercises yet — add from the library.</Text>
            : renderExerciseList()}
          <Pressable style={styles.scAddBtn} onPress={() => lib.open(block.id)}>
            <Ionicons name="add" size={18} color={C.green} />
            <Text style={styles.scAddBtnText}>Add exercise</Text>
          </Pressable>
        </View>
      ) : (
        <View style={wide ? styles.scSplit : styles.scStack}>
          <ExerciseLibraryPane onAdd={addFromLibrary} wide={wide} />
          <View style={wide ? styles.scCards : styles.scCardsStack}>
            {block.exercises.length === 0
              ? <Text style={styles.scEmptyHint}>Tap an exercise to add it here.</Text>
              : renderExerciseList()}
          </View>
        </View>
      )}
    </View>
  )
}

function ExplorationSessionFields({ block, onUpdate }: { block: ExplorationSessionBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<ExplorationSessionBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" />
      <FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline placeholder="What should athletes know before starting?" />
    </>
  )
}


interface AthleteProgress {
  level?: string
  position?: "ahead" | "behind" | "steppedBack"
  next?: string        // what their next session would start on
  flags?: NextFlags
}

function ExerciseEditorRow({ exercise, athleteProgress, onUpdate, onDelete }: {
  exercise: Exercise; athleteProgress?: AthleteProgress | null
  onUpdate: (e: Exercise) => void; onDelete: () => void
}) {
  function update(fields: Partial<Exercise>) { onUpdate({ ...exercise, ...fields }) }
  const typeLabel = exercise.type === "reps" ? "Reps" : exercise.type === "both_sides" ? "Both sides" : "7/3s"

  // Self-heals exercises authored before this field became focus-derived
  // (or edited outside this row) — a stale manually-typed reps target, like
  // the bugged "1 rep" case, gets replaced the next time this row renders.
  useEffect(() => {
    const isRepCounted = (exercise.type === "reps" || exercise.type === "both_sides") && exercise.unit !== "seconds"
    if (!isRepCounted || !exercise.focus) return
    const range = FOCUS_REP_RANGE[exercise.focus]
    const expected = `${range.low}-${range.high}`
    if (exercise.reps !== expected) update({ reps: expected })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.focus, exercise.type, exercise.unit])

  const movementType = exercise.movementType as MovementType | undefined
  const isMobility = movementType === "mobility"

  return (
    <View style={styles.exerciseRow}>
      <View style={styles.exerciseRowHeader}>
        <View style={styles.exerciseRowTags}>
          <Text style={styles.exerciseTypeTag}>{typeLabel}</Text>
          {movementType && (
            <View style={[styles.movementTag, { backgroundColor: MOVEMENT_TYPE_COLOR[movementType] + "22", borderColor: MOVEMENT_TYPE_COLOR[movementType] }]}>
              <Text style={[styles.movementTagText, { color: MOVEMENT_TYPE_COLOR[movementType] }]}>{MOVEMENT_TYPE_LABEL[movementType]}</Text>
            </View>
          )}
          {exercise.loadMode === "level" && <Text style={styles.exerciseTypeTag}>Level progression</Text>}
        </View>
        <Pressable onPress={onDelete} hitSlop={6}><Text style={styles.deleteButtonText}>✕</Text></Pressable>
      </View>

      {!!athleteProgress && (
        <View style={styles.athleteProgressBanner}>
          {!!athleteProgress.level && (
          <Text style={styles.athleteProgressText}>
            {athleteProgress.position === "steppedBack" ? (
              <>
                Athlete tried <Text style={styles.athleteProgressTextBold}>{athleteProgress.level}</Text> but stepped back to this level
              </>
            ) : athleteProgress.position === "behind" ? (
              <>
                Athlete is still on the easier <Text style={styles.athleteProgressTextBold}>{athleteProgress.level}</Text> on this exercise
              </>
            ) : (
              <>
                Athlete has already progressed to <Text style={styles.athleteProgressTextBold}>{athleteProgress.level}</Text> on this exercise
              </>
            )}
          </Text>
          )}
          {!!athleteProgress.next && (
            <Text style={styles.athleteProgressText}>
              <Text style={styles.athleteProgressTextBold}>Next session: </Text>{athleteProgress.next}
            </Text>
          )}
          {!!athleteProgress.flags?.deload && (
            <Text style={[styles.athleteProgressText, { color: C.red }]}>{"Down two sessions in a row — consider backing off (the athlete isn't told)."}</Text>
          )}
          {!!athleteProgress.flags?.stalled && (
            <Text style={[styles.athleteProgressText, { color: C.yellow }]}>Same load three sessions running — consider a different exercise or rep target.</Text>
          )}
        </View>
      )}

      {exercise.photoUri && (
        <Image source={{ uri: exercise.photoUri }} style={styles.exercisePhotoThumb} />
      )}
      {exercise.notes && (
        <Text style={styles.exerciseNotesPreview} numberOfLines={3}>{exercise.notes}</Text>
      )}

      <FieldLabel label="Exercise name" />
      <FieldInput value={exercise.name} onChange={(v) => update({ name: v })} placeholder="Exercise name" />

      {/* Mobility has no focus or progression — just a target. */}
      {!isMobility && <FieldLabel label="Focus" />}
      {!isMobility && <View style={styles.adaptationRow}>
        {FOCUSES.map((f) => {
          const selected = exercise.focus === f
          return (
            <Pressable
              key={f}
              onPress={() => {
                const nextFocus = selected ? undefined : f
                // A rep-counted (non-timed) target is entirely a function of
                // focus now — 8-12 for hypertrophy, 3-6 for max
                // force/explosiveness — not something a coach types per
                // exercise, so it's regenerated whenever focus changes.
                const isRepCounted = (exercise.type === "reps" || exercise.type === "both_sides") && exercise.unit !== "seconds"
                const range = nextFocus ? FOCUS_REP_RANGE[nextFocus] : undefined
                update({
                  focus: nextFocus,
                  reps: isRepCounted ? (range ? `${range.low}-${range.high}` : undefined) : exercise.reps,
                })
              }}
              style={[styles.adaptationChip, selected && { backgroundColor: C.green, borderColor: C.green }]}
            >
              <Text style={[styles.adaptationChipText, selected && { color: C.bg, fontWeight: "700" }]}>
                {FOCUS_LABEL[f]}
              </Text>
            </Pressable>
          )
        })}
      </View>}

      {/* Mobility can be done by reps (active) or held (passive): the coach
          picks here; a hold gets the athlete's countdown timer. */}
      {isMobility && (exercise.type === "reps" || exercise.type === "both_sides") && (
        <>
          <FieldLabel label="Done as" />
          <View style={styles.adaptationRow}>
            {(["reps", "seconds"] as const).map((u) => {
              const selected = (exercise.unit ?? "reps") === u
              return (
                <Pressable
                  key={u}
                  onPress={() => { if (!selected) update({ unit: u, reps: "" }) }}
                  style={[styles.adaptationChip, selected && { backgroundColor: C.green, borderColor: C.green }]}
                >
                  <Text style={[styles.adaptationChipText, selected && { color: C.bg, fontWeight: "700" }]}>
                    {u === "reps" ? "Reps" : "Hold (timer)"}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </>
      )}
      {(exercise.type === "reps" || exercise.type === "both_sides") && (
        isMobility && exercise.unit !== "seconds" ? (
          <>
            <FieldLabel label="Target reps" />
            <FieldInput value={exercise.reps ?? ""} onChange={(v) => update({ reps: v })} placeholder="10" />
          </>
        ) : exercise.unit === "seconds" ? (
          <>
            <FieldLabel label="Seconds" />
            <FieldInput value={exercise.reps ?? ""} onChange={(v) => update({ reps: v })} placeholder="20-30" />
          </>
        ) : (
          <>
            <FieldLabel label="Target reps" />
            {exercise.focus ? (
              <Text style={styles.repRangeText}>
                {FOCUS_REP_RANGE[exercise.focus].low}–{FOCUS_REP_RANGE[exercise.focus].high} reps · set by {FOCUS_LABEL[exercise.focus]}
              </Text>
            ) : (
              <Text style={styles.repRangeHint}>Pick a focus above to set the target range</Text>
            )}
          </>
        )
      )}
      {exercise.type === "7/3s" && (
        <>
          <FieldLabel label="Edge size" /><FieldInput value={exercise.edge ?? ""} onChange={(v) => update({ edge: v })} placeholder="20mm" />
          <FieldLabel label="Series" /><FieldInput value={String(exercise.series ?? 6)} onChange={(v) => update({ series: parseInt(v) || 0 })} numeric />
        </>
      )}
    </View>
  )
}

// ─── Sequence Fields ──────────────────────────────────────────────────────────

const ROUTE_FALLBACK_IMAGE = require("@/assets/images/spraywall.jpg")

function SequenceFields({ block, onUpdate }: { block: SequenceBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<SequenceBlock>) { onUpdate({ ...block, ...fields }) }
  const [showRoutePicker, setShowRoutePicker] = useState(false)
  // Which variations the selected route actually has — drives the "Starting
  // difficulty" picker below. Re-fetched whenever the route changes (covers
  // both a fresh pick and re-opening an already-configured block).
  const [availableVars, setAvailableVars] = useState<VariationKey[]>(["original"])

  useEffect(() => {
    if (!block.routeId) { setAvailableVars(["original"]); return }
    let cancelled = false
    getSprayRoute(block.routeId)
      .then((row) => { if (!cancelled) setAvailableVars(availableVariations(parseVariations(row))) })
      .catch(() => { /* keep default */ })
    return () => { cancelled = true }
  }, [block.routeId])

  function selectRoute(route: SprayRouteRow, wall?: SprayWallRow | null) {
    update({
      routeId: route.$id, routeName: route.name, routeHolds: route.holds,
      startingVariation: "original",
      ...(wall?.imageUri ? { wallImageUri: wall.imageUri } : {}),
      ...(wall?.width && wall?.height ? { wallWidth: wall.width, wallHeight: wall.height } : {}),
    })
    setAvailableVars(availableVariations(parseVariations(route)))
    setShowRoutePicker(false)
  }

  // When authoring for a specific athlete, show what the progression rule
  // suggests for them next (the same suggestion SequenceBlock.tsx shows the
  // athlete — utils/progression/sequence.ts), with a one-tap way to use it.
  const athleteId = useContext(AuthoringAthleteContext)
  const [suggestion, setSuggestion] = useState<SequenceSuggestion | null>(null)
  useEffect(() => {
    setSuggestion(null)
    if (!athleteId) return
    let cancelled = false
    Promise.all([getSessionsByUserId(athleteId), getSprayRoutes()])
      .then(([sessions, routeRows]) => {
        if (cancelled) return
        const runs = findBlockRuns(sessions, { type: "sequence", blockName: block.blockName, libraryBlockId: block.libraryBlockId })
        setSuggestion(suggestNextSequence(runs, routesVisibleTo(routeRows, athleteId)))
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [athleteId, block.blockName, block.libraryBlockId])

  // The suggested route's row + wall, loaded on demand — for the full-screen
  // preview (so the coach can check the moves before using it) and for
  // applying it to the block.
  type LoadedRoute = { row: SprayRouteRow; wall: SprayWallRow | null }
  async function loadRoute(routeId: string): Promise<LoadedRoute> {
    const row = await getSprayRoute(routeId)
    const wall = row.wallId ? await getSprayWall(row.wallId).catch(() => null) : null
    return { row, wall }
  }

  const [applyingSuggestion, setApplyingSuggestion] = useState(false)
  async function applySuggestion(sug: SequenceSuggestion, loaded?: LoadedRoute) {
    if (!sug.route) return
    setApplyingSuggestion(true)
    try {
      const { row, wall } = loaded ?? await loadRoute(sug.route.id)
      setAvailableVars(availableVariations(parseVariations(row)))
      onUpdate({
        ...block,
        routeId: row.$id, routeName: row.name, routeHolds: row.holds,
        startingVariation: sug.startVariation,
        ...(wall?.imageUri ? { wallImageUri: wall.imageUri } : {}),
        ...(wall?.width && wall?.height ? { wallWidth: wall.width, wallHeight: wall.height } : {}),
      })
    } catch (e) {
      console.error(e)
      Alert.alert("Error", "Couldn't load the suggested sequence.")
    } finally {
      setApplyingSuggestion(false)
    }
  }

  const [preview, setPreview] = useState<LoadedRoute | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  async function openPreview(sug: SequenceSuggestion) {
    if (!sug.route) return
    setLoadingPreview(true)
    try {
      setPreview(await loadRoute(sug.route.id))
    } catch (e) {
      console.error(e)
      Alert.alert("Error", "Couldn't load the suggested sequence.")
    } finally {
      setLoadingPreview(false)
    }
  }
  const suggestionApplied = !!suggestion?.route
    && block.routeId === suggestion.route.id
    && (block.startingVariation ?? "original") === suggestion.startVariation

  return (
    <>
      {!!suggestion && (
        <View style={styles.progressionFlag}>
          <Text style={styles.progressionFlagTitle}>Progression for this athlete</Text>
          <Text style={styles.progressionFlagLast}>{suggestion.lastTime}</Text>
          <Text style={styles.progressionFlagText}>{suggestion.note}</Text>
          {!!suggestion.route && (
            <Text style={styles.progressionFlagRoute}>
              {suggestion.route.name}
              {suggestion.route.level != null ? ` · level ${suggestion.route.level}` : ""}
              {suggestion.startVariation !== "original" ? ` · start ${VARIATION_LABEL[suggestion.startVariation]}` : ""}
            </Text>
          )}
          {!!suggestion.route && (
            <View style={styles.progressionFlagActions}>
              <Pressable onPress={() => openPreview(suggestion)} disabled={loadingPreview} hitSlop={6}>
                <Text style={styles.progressionFlagAction}>{loadingPreview ? "Loading…" : "Preview"}</Text>
              </Pressable>
              {!block.athleteChoosesRoute && (
                suggestionApplied ? (
                  <Text style={styles.progressionFlagText}>✓ Using it</Text>
                ) : (
                  <Pressable onPress={() => applySuggestion(suggestion)} disabled={applyingSuggestion} hitSlop={6}>
                    <Text style={styles.progressionFlagAction}>{applyingSuggestion ? "Loading…" : "Use this sequence"}</Text>
                  </Pressable>
                )
              )}
            </View>
          )}
          {block.athleteChoosesRoute && (
            <Text style={styles.progressionFlagText}>The athlete will be offered this when they reach the block.</Text>
          )}
        </View>
      )}
      <FieldLabel label="Description" />
      <FieldInput
        value={block.description}
        onChange={(v) => update({ description: v })}
        multiline
        placeholder="What should athletes know before starting?"
      />
      <View style={styles.switchRow}>
        <Text style={[styles.fieldLabel, { flex: 1, marginRight: 12 }]}>
          Let athlete choose the sequence{" "}
          <Text style={styles.fieldLabelHint}>· picked when they reach this block</Text>
        </Text>
        <Switch
          value={!!block.athleteChoosesRoute}
          onValueChange={(v) => update(
            v
              ? {
                  athleteChoosesRoute: true,
                  routeId: "", routeName: "", routeHolds: "",
                  wallImageUri: undefined, wallWidth: undefined, wallHeight: undefined,
                  startingVariation: undefined,
                }
              : { athleteChoosesRoute: false }
          )}
        />
      </View>

      {!block.athleteChoosesRoute && (
        <>
          <FieldLabel label="Sequence route" />
          <Pressable style={styles.exercisePickerButton} onPress={() => setShowRoutePicker(true)}>
            <Text style={block.routeName ? styles.exercisePickerName : styles.exercisePickerPlaceholder}>
              {block.routeName || "Select route →"}
            </Text>
          </Pressable>

          {availableVars.length > 1 && (
            <>
              <FieldLabel label="Starting difficulty" />
              <View style={styles.adaptationRow}>
                {availableVars.map((k) => {
                  const selected = (block.startingVariation ?? "original") === k
                  return (
                    <Pressable
                      key={k}
                      onPress={() => update({ startingVariation: k })}
                      style={[styles.adaptationChip, selected && { backgroundColor: C.green, borderColor: C.green }]}
                    >
                      <Text style={[styles.adaptationChipText, selected && { color: C.bg, fontWeight: "700" }]}>
                        {VARIATION_LABEL[k]}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </>
          )}
        </>
      )}

      <RoutePickerSheet
        visible={showRoutePicker}
        onClose={() => setShowRoutePicker(false)}
        onSelect={selectRoute}
      />

      {/* Full-screen preview of the suggested sequence, on the variation the
          athlete would start on — pinch/pan to check the moves. */}
      <Modal
        visible={preview !== null}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setPreview(null)}
      >
        {preview && suggestion && (
          <SafeAreaView style={styles.routePreviewSafe}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setPreview(null)} style={styles.iconBackBtn} hitSlop={10}>
                <Ionicons name="close" size={22} color={C.textSecondary} />
              </Pressable>
              <Text style={[styles.modalTitle, { textAlign: "center", marginRight: 0 }]} numberOfLines={1}>
                {preview.row.name}
                {preview.row.level != null ? ` · level ${preview.row.level}` : ""}
                {suggestion.startVariation !== "original" ? ` · ${VARIATION_LABEL[suggestion.startVariation]}` : ""}
              </Text>
              <View style={styles.iconBackBtn} />
            </View>
            <SprayWallViewer
              imageSource={preview.wall?.imageUri ? { uri: preview.wall.imageUri } : WALL_IMAGE}
              holds={variationHolds(parseVariations(preview.row), suggestion.startVariation)}
              style={{ flex: 1 }}
              freeGesture
              previewWidth={1200}
              naturalSize={preview.wall?.width && preview.wall?.height ? { w: preview.wall.width, h: preview.wall.height } : null}
            />
            <Text style={styles.routePreviewHint}>Pinch or double-tap to zoom</Text>
            {!block.athleteChoosesRoute && !suggestionApplied && (
              <View style={styles.routePreviewFooter}>
                <CustomButton
                  title="Use this sequence"
                  onPress={() => {
                    const loaded = preview
                    setPreview(null)
                    applySuggestion(suggestion, loaded)
                  }}
                />
              </View>
            )}
          </SafeAreaView>
        )}
      </Modal>
    </>
  )
}

// Free session's optional attached sequence: the same route picker/creator as
// a Sequence block, but with no attempts/rest/variation fields — the route is
// just shown to the athlete for reference while they climb freely.
function FreeSessionFields({ block, onUpdate }: { block: FreeSessionBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<FreeSessionBlock>) { onUpdate({ ...block, ...fields } as FreeSessionBlock) }
  const [showRoutePicker, setShowRoutePicker] = useState(false)

  function selectRoute(route: SprayRouteRow, wall?: SprayWallRow | null) {
    update({
      routeId: route.$id, routeName: route.name, routeHolds: route.holds,
      ...(wall?.imageUri ? { wallImageUri: wall.imageUri } : {}),
      ...(wall?.width && wall?.height ? { wallWidth: wall.width, wallHeight: wall.height } : {}),
    })
    setShowRoutePicker(false)
  }

  function clearRoute() {
    update({ routeId: "", routeName: "", routeHolds: "", wallImageUri: undefined, wallWidth: undefined, wallHeight: undefined })
  }

  return (
    <>
      <FieldLabel label="Description" />
      <FieldInput
        value={block.description}
        onChange={(v) => update({ description: v })}
        placeholder="What will athletes do during this session?"
        multiline
      />

      <Text style={styles.fieldLabel}>
        Note prompt <Text style={styles.fieldLabelHint}>· optional</Text>
      </Text>
      <FieldInput
        value={block.notePrompt ?? ""}
        onChange={(v) => update({ notePrompt: v })}
        placeholder="e.g. What block did you try?"
      />

      <Text style={styles.fieldLabel}>
        Note example <Text style={styles.fieldLabelHint}>· optional</Text>
      </Text>
      <FieldInput
        value={block.noteExample ?? ""}
        onChange={(v) => update({ noteExample: v })}
        placeholder="Shown as a hint inside the note field"
      />

      <Text style={styles.fieldLabel}>
        Sequence <Text style={styles.fieldLabelHint}>· optional</Text>
      </Text>
      <View style={styles.freeSessionRouteRow}>
        <Pressable style={[styles.exercisePickerButton, { flex: 1 }]} onPress={() => setShowRoutePicker(true)}>
          <Text style={block.routeName ? styles.exercisePickerName : styles.exercisePickerPlaceholder} numberOfLines={1}>
            {block.routeName || "Attach a sequence →"}
          </Text>
        </Pressable>
        {!!block.routeName && (
          <Pressable onPress={clearRoute} hitSlop={10} style={styles.freeSessionClearRouteBtn}>
            <Ionicons name="close-circle" size={20} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      <RoutePickerSheet
        visible={showRoutePicker}
        onClose={() => setShowRoutePicker(false)}
        onSelect={selectRoute}
      />
    </>
  )
}

// Route picker sheet + inline "Create new route" builder, for block editors
// that live inside other modals (the workout builder, the library editor).
// The builder Modal is rendered INSIDE the picker's Modal on purpose: a
// native modal presents from the view controller that owns it, and the
// picker sheet's parent is already busy presenting the picker — a sibling
// builder Modal there was silently never shown on iOS.
function RoutePickerSheet({ visible, onClose, onSelect }: {
  visible: boolean
  onClose: () => void
  onSelect: (route: SprayRouteRow, wall: SprayWallRow | null) => void
}) {
  const [creating, setCreating] = useState<{ wall: SprayWallRow | null } | null>(null)
  const [savingRoute, setSavingRoute] = useState(false)
  // Saving closes two nested native <Modal>s (the builder, then — via
  // onSelect — this sheet). On iOS doing both in one tick races the UIKit
  // dismiss animations and can strand a blank view, so there we close only
  // the builder and select from its onDismiss.
  const pendingRouteSelectRef = useRef<{ route: SprayRouteRow; wall: SprayWallRow | null } | null>(null)

  async function saveNewRoute(name: string, data: { variations: RouteVariations; level: number; type: string }) {
    if (!name.trim()) { Alert.alert("Name required", "Give the route a name before saving."); return }
    const holds = data.variations.original ?? []
    const extras = { level: data.level, type: data.type, variations: data.variations }
    setSavingRoute(true)
    try {
      const wall = creating?.wall ?? null
      const created = await saveSprayRoute(name.trim(), holds, wall?.$id, extras)
      if (Platform.OS === "ios") {
        pendingRouteSelectRef.current = { route: created, wall }
        setCreating(null)
      } else {
        setCreating(null)
        onSelect(created, wall)
      }
    } catch (e) {
      Alert.alert("Error", "Could not save the route. Try again.")
      console.error(e)
    } finally {
      setSavingRoute(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <RoutePickerModal
        onSelect={(route, wall) => onSelect(route, wall ?? null)}
        onClose={onClose}
        onCreateNew={(wall) => setCreating({ wall: wall ?? null })}
      />

      <Modal
        visible={creating !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCreating(null)}
        onDismiss={() => {
          const pending = pendingRouteSelectRef.current
          if (!pending) return
          pendingRouteSelectRef.current = null
          onSelect(pending.route, pending.wall)
        }}
      >
        {creating && (
          <SafeAreaView style={styles.routeBuilderSafe} edges={["top"]}>
            <SprayWallBuilder
              imageSource={creating.wall?.imageUri ? { uri: creating.wall.imageUri } : ROUTE_FALLBACK_IMAGE}
              onBack={() => setCreating(null)}
              onSave={saveNewRoute}
              saving={savingRoute}
            />
          </SafeAreaView>
        )}
      </Modal>
    </Modal>
  )
}

// ─── Route Picker Modal ───────────────────────────────────────────────────────

export function RoutePickerModal({ onSelect, onClose, onCreateNew }: {
  onSelect: (route: SprayRouteRow, wall?: SprayWallRow) => void
  onClose: () => void
  onCreateNew: (wall?: SprayWallRow) => void
}) {
  const [routes, setRoutes] = useState<SprayRouteRow[]>([])
  const [walls, setWalls] = useState<SprayWallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [wallPickerVisible, setWallPickerVisible] = useState(false)
  // Full-screen route preview — the list thumb is only 80x80, too small to
  // read the moves before committing to a route.
  const [previewRoute, setPreviewRoute] = useState<SprayRouteRow | null>(null)
  // Selecting a route from the preview closes two nested native <Modal>s at
  // once (the preview, then — via onSelect — the picker sheet). On iOS,
  // dismissing both in the same tick races the two UIKit presentations and
  // can strand a blank white view that nothing can dismiss. So on iOS we
  // close only the preview here and defer onSelect to its onDismiss (fires
  // once the native dismiss animation actually finishes); Android's Modal
  // doesn't have that race, so it can select immediately.
  const pendingSelectRef = useRef<{ route: SprayRouteRow; wall?: SprayWallRow } | null>(null)
  const [filters, setFilters] = useState<RouteFilters>(EMPTY_ROUTE_FILTERS)
  // Same iOS race for the wall chooser: closing it and presenting the route
  // builder in one tick drops the builder, so start it from onDismiss.
  const pendingCreateWallRef = useRef<SprayWallRow | null>(null)

  // A new route must live on a wall: use the only wall, prompt to choose when
  // there are several, or proceed wall-less if none exist yet.
  function startCreateNew() {
    if (walls.length === 0) { onCreateNew(); return }
    if (walls.length === 1) { onCreateNew(walls[0]); return }
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
  // List cards pass thumb=true to prefer the wall's small pre-resized preview
  // (generated once at wall-upload time — see makeAndUploadPreview in
  // sprayWall.tsx) over the full-resolution photo, so a long list of routes
  // isn't loading dozens of full wall photos at once. Falls back to the full
  // photo for walls uploaded before previews existed, and always for the
  // full-screen preview modal, which wants full resolution.
  function routeImageSource(route: SprayRouteRow, thumb = false) {
    const wall = route.wallId ? wallsById.get(route.wallId) : undefined
    const uri = (thumb ? wall?.previewUri : undefined) ?? wall?.imageUri
    return uri ? { uri } : WALL_IMAGE
  }
  const filteredRoutes = useMemo(() => applyRouteFilters(routes, filters), [routes, filters])

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

      {!loading && routes.length > 0 && (
        <RouteFilterBar filters={filters} onChange={setFilters} walls={walls} />
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : routes.length === 0 ? (
        <Text style={styles.emptyState}>No routes saved yet.</Text>
      ) : filteredRoutes.length === 0 ? (
        <Text style={styles.emptyState}>No routes match your filters.</Text>
      ) : (
        // FlatList, not ScrollView+map: a coach's wall can have dozens of saved
        // routes, and each card's SprayWallViewer kicks off an image load. A
        // ScrollView mounts every card immediately, firing all those loads (and,
        // for routes on a wall with no stored width/height, a full-resolution
        // Image.getSize() each) at once — enough concurrent decodes to spike
        // memory and freeze/kill the app before the list ever finishes loading.
        // FlatList only mounts cards near the viewport, so images load in
        // waves as you scroll instead of all at once.
        <FlatList
          data={filteredRoutes}
          keyExtractor={(route) => route.$id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          windowSize={5}
          maxToRenderPerBatch={6}
          initialNumToRender={6}
          removeClippedSubviews={Platform.OS === "android"}
          renderItem={({ item: route }) => {
            const holds = holdsByRoute.get(route.$id) ?? []
            return (
              <Pressable
                style={styles.routePickerCard}
                onPress={() => onSelect(route, wallsById.get(route.wallId ?? ""))}
              >
                <View style={styles.routePickerThumb}>
                  <SprayWallViewer
                    imageSource={routeImageSource(route, true)}
                    holds={holds}
                    style={{ flex: 1 }}
                    interactive={false}
                    previewWidth={500}
                    naturalSize={(() => { const w = wallsById.get(route.wallId ?? ""); return w?.width && w?.height ? { w: w.width, h: w.height } : null })()}
                  />
                  <Pressable
                    style={styles.routePickerZoomBtn}
                    hitSlop={10}
                    accessibilityLabel="Preview route full size"
                    onPress={(e) => { e.stopPropagation(); setPreviewRoute(route) }}
                  >
                    <Ionicons name="expand" size={15} color="#fff" />
                  </Pressable>
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
          }}
        />
      )}

      {/* Full-screen route preview — pinch/pan to inspect the moves before picking */}
      <Modal
        visible={previewRoute !== null}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setPreviewRoute(null)}
        onDismiss={() => {
          const pending = pendingSelectRef.current
          if (!pending) return
          pendingSelectRef.current = null
          onSelect(pending.route, pending.wall)
        }}
      >
        {previewRoute && (
          <SafeAreaView style={styles.routePreviewSafe}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setPreviewRoute(null)} style={styles.iconBackBtn} hitSlop={10}>
                <Ionicons name="close" size={22} color={C.textSecondary} />
              </Pressable>
              <Text style={[styles.modalTitle, { textAlign: "center", marginRight: 0 }]} numberOfLines={1}>
                {previewRoute.name}
              </Text>
              <View style={styles.iconBackBtn} />
            </View>
            <SprayWallViewer
              imageSource={routeImageSource(previewRoute)}
              holds={holdsByRoute.get(previewRoute.$id) ?? []}
              style={{ flex: 1 }}
              freeGesture
              previewWidth={1200}
              naturalSize={(() => { const w = wallsById.get(previewRoute.wallId ?? ""); return w?.width && w?.height ? { w: w.width, h: w.height } : null })()}
            />
            <Text style={styles.routePreviewHint}>Pinch or double-tap to zoom</Text>
            <View style={styles.routePreviewFooter}>
              <CustomButton
                title="Select this route"
                onPress={() => {
                  const r = previewRoute
                  const wall = wallsById.get(r.wallId ?? "")
                  if (Platform.OS === "ios") {
                    // Defer to onDismiss above so the two modals close one at a time.
                    pendingSelectRef.current = { route: r, wall }
                    setPreviewRoute(null)
                  } else {
                    setPreviewRoute(null)
                    onSelect(r, wall)
                  }
                }}
              />
            </View>
          </SafeAreaView>
        )}
      </Modal>

      {/* Wall chooser — a new route must live on a wall */}
      <Modal
        visible={wallPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWallPickerVisible(false)}
        onDismiss={() => {
          const wall = pendingCreateWallRef.current
          if (!wall) return
          pendingCreateWallRef.current = null
          onCreateNew(wall)
        }}
      >
        <Pressable style={styles.aiOverlay} onPress={() => setWallPickerVisible(false)}>
          <Pressable style={styles.aiCard} onPress={() => {}}>
            <Text style={styles.aiTitle}>Add route to which wall?</Text>
            <Text style={styles.aiSub}>A route lives on a wall — pick one.</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {walls.map((wall) => (
                <Pressable
                  key={wall.$id}
                  style={styles.wallPickRow}
                  onPress={() => {
                    if (Platform.OS === "ios") {
                      pendingCreateWallRef.current = wall
                      setWallPickerVisible(false)
                    } else {
                      setWallPickerVisible(false)
                      onCreateNew(wall)
                    }
                  }}
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

const EXERCISE_TYPE_LABEL: Record<"reps" | "both_sides" | "7/3s", string> = {
  reps: "Reps", both_sides: "Both sides", "7/3s": "7/3s",
}


// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  progressionFlag: {
    backgroundColor: "rgba(111,207,151,0.12)", borderWidth: 1, borderColor: C.green,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 4, marginBottom: 12,
  },
  progressionFlagTitle: { fontSize: 11, fontWeight: "700", color: C.green, textTransform: "uppercase", letterSpacing: 0.6 },
  progressionFlagLast: { fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },
  progressionFlagText: { fontSize: 12.5, fontWeight: "600", color: C.green, lineHeight: 17 },
  progressionFlagActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  generatedDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  boulderSlotRow: { flexDirection: "row", gap: 8, marginVertical: 4 },
  boulderSlot: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  boulderSlotEmpty: { borderColor: C.border, borderStyle: "dashed", backgroundColor: "transparent" },
  boulderSlotSelected: { borderColor: C.textPrimary },
  boulderSlotText: { fontSize: 13, fontWeight: "800" },
  boulderSlotClear: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary, textDecorationLine: "underline", marginTop: 4 },
  progressionFlagRoute: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  progressionFlagAction: { fontSize: 13, fontWeight: "700", color: C.green, textDecorationLine: "underline", marginTop: 2 },
  safeContainer: { flex: 1, backgroundColor: C.bg },
  routeBuilderSafe: { flex: 1, backgroundColor: "#0a0a0a" },

  // Master-detail (big screens)
  splitRoot: { flex: 1, flexDirection: "row", backgroundColor: C.bg },
  splitList: { width: 380, borderRightWidth: 1, borderRightColor: C.border },
  splitDetail: { flex: 1 },
  splitEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  splitEmptyText: { fontSize: 15, color: C.textMuted, textAlign: "center" },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  listHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  backButton: { paddingRight: 4 },
  backButtonText: { fontSize: 34, color: C.textSecondary, lineHeight: 36 },
  title: { fontSize: 26, fontWeight: "700", color: C.textPrimary },
  newButton: { backgroundColor: C.green, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  newButtonText: { color: C.bg, fontWeight: "600", fontSize: 14 },
  listContent: { paddingHorizontal: 20, gap: 12, paddingBottom: 40 },
  emptyState: { textAlign: "center", marginTop: 60, color: C.textMuted, fontSize: 15 },
  protocolCard: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1.5, borderColor: "transparent" },
  protocolCardSelected: { borderColor: C.green, backgroundColor: C.surfaceHigh },
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
  libraryFilterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  libraryFilterChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.surface, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: C.border,
  },
  libraryFilterChipActive: { backgroundColor: C.green, borderColor: C.green },
  libraryFilterChipText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  libraryFilterChipTextActive: { color: C.bg },
  libraryResultsFooter: { fontSize: 12, color: C.textMuted, textAlign: "center", marginTop: 4, marginBottom: 8 },
  libraryGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 10,
  },
  // No fixed width/column count — each card starts at its name's width, then
  // the cards in a row stretch to fill it, so a card alone on its row (narrow
  // pane) spans the full width.
  libraryCard: {
    minWidth: 130, flexGrow: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    padding: 12, gap: 8, minHeight: 60,
  },
  libraryCardRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingRight: 20,  // leave room for the "···" menu button
  },
  libraryCardName: {
    fontSize: 13, fontWeight: "600", color: C.textPrimary,
    flexShrink: 1,
  },
  libraryCardMenuBtn: {
    position: "absolute", top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
  },
  editBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", padding: 20,
  },
  editCard: {
    width: "100%", maxWidth: 480, maxHeight: "85%",
    backgroundColor: C.bg, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, overflow: "hidden",
  },
  libraryGroupHeader: {
    fontSize: 12, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, paddingHorizontal: 4,
  },
  libraryAddText: { fontSize: 14, fontWeight: "600", color: C.green },
  // Protocol builder: a block rendered with the "Edit block" modal's look —
  // standalone header + fields — as a card (wide grid) or list row (narrow).
  blockCard: {
    backgroundColor: C.surfaceHigh, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, overflow: "hidden",
  },
  blockCardListItem: { marginBottom: 10 },
  blockCardHeaderClearGrip: { paddingRight: 22 }, // the grid's grip handle sits on this corner
  blockCardListHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 14 },
  blockCardListTitles: { flex: 1, gap: 2 },
  blockCardListType: { fontSize: 11, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  blockCardListName: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  blockCardDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16, marginBottom: 6 },
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

  // Assign-to-athlete pills
  assignWrap: { marginHorizontal: 16, marginTop: 12, gap: 8 },
  assignLabel: { fontSize: 12, fontWeight: "700", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  assignPillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  assignPill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  assignPillActive: { backgroundColor: C.green, borderColor: C.green },
  assignPillText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  assignPillTextActive: { color: C.bg },

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
  blockRow: {
    // surfaceHigh (not surface) — the pane it sits in is already surface-colored,
    // so a same-color card would have no visible edge, just floating text.
    backgroundColor: C.surfaceHigh, borderRadius: 14, overflow: "hidden", marginBottom: 10,
    borderWidth: 1, borderColor: "transparent",
  },
  blockRowStandalone: { backgroundColor: "transparent" },
  blockRowActive: { opacity: 0.8, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 },
  // The one block currently open for editing gets a subtle green outline so
  // it reads as "in edit" without needing a separate modal.
  blockRowEditing: { borderColor: C.green },
  blockRowHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  dragHandle: { padding: 4 },
  dragGrip: {
    width: 12, height: 18, flexDirection: "row", flexWrap: "wrap",
    justifyContent: "space-between", alignContent: "space-between",
  },
  dragGripDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.textMuted },
  moveButtons: { justifyContent: "center", gap: 2 },
  moveButton: { paddingHorizontal: 4, paddingVertical: 1 },
  moveButtonText: { fontSize: 12, color: C.textSecondary },
  moveButtonDisabled: { color: C.border },
  blockRowDot: { width: 9, height: 9, borderRadius: 4.5 },
  blockRowCompactName: { flex: 1, fontSize: 15, fontWeight: "600", color: C.textPrimary },
  blockRowEditBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  blockFields: { paddingHorizontal: 14, paddingBottom: 14, gap: 6, borderTopWidth: 1, borderTopColor: C.border },
  blockDeleteFooterBtn: {
    marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  blockDeleteFooterBtnText: { color: C.red, fontSize: 13, fontWeight: "700" },
  adaptationRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    paddingVertical: 4,
  },
  adaptationChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.bg, borderRadius: 16,
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
  fieldLabel: { fontSize: 12, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10, marginBottom: 6 },
  repRangeText: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  repRangeHint: { fontSize: 13, color: C.textMuted, fontStyle: "italic" },
  fieldLabelHint: { textTransform: "none", letterSpacing: 0, color: C.textMuted },
  // Inset well (page-bg color, not the card's surfaceHigh) so inputs read as
  // distinct wells instead of blending into the block row behind them.
  fieldInput: { borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 10, fontSize: 15, color: C.textPrimary, backgroundColor: C.bg },
  nameRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  nameField: { flex: 1.2 },
  numericsRow: { flex: 1.8, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  numField: { flex: 1 },
  timeLimitRow: { maxWidth: 220 },

  // ── Standalone editor (template library) ──────────────────────────────────
  standaloneHeaderRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
  },
  standaloneHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  standaloneDot: { width: 10, height: 10, borderRadius: 5 },
  standaloneHeaderTitle: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  standaloneHeaderRowCompact: { paddingHorizontal: 12, paddingVertical: 10 },
  standaloneHeaderNameInput: {
    fontSize: 16, fontWeight: "700", color: C.textPrimary,
    marginTop: -6, marginBottom: 6, marginLeft: 32, marginRight: 12, // under the type label, past the dot
    paddingVertical: 2, paddingHorizontal: 0,
  },
  standaloneFieldsCompact: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  fieldLabelCompact: { fontSize: 11, marginTop: 4, marginBottom: 4 },
  fieldInputCompact: { borderRadius: 10, paddingVertical: 7, paddingHorizontal: 9, fontSize: 14, minHeight: 0 },
  fieldPreview: { maxHeight: FIELD_PREVIEW_TEXT_HEIGHT + 14, overflow: "hidden" }, // + vertical padding
  fieldPreviewFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 32, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  fieldPreviewText: { fontSize: 14, lineHeight: FIELD_PREVIEW_LINE_HEIGHT, color: C.textPrimary },
  fieldPreviewPlaceholder: { fontSize: 14, color: C.textMuted },
  numericsRowCompact: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  compactStepper: {
    flexDirection: "row", alignItems: "center", gap: 2, height: 34,
    backgroundColor: C.bg, borderRadius: 17, borderWidth: 1, borderColor: C.border,
    paddingLeft: 10, paddingRight: 4,
  },
  compactStepperLabel: { fontSize: 12, fontWeight: "600", color: C.textSecondary, marginRight: 2 },
  compactStepperBtn: { width: 24, height: 28, alignItems: "center", justifyContent: "center" },
  compactStepperBtnText: { fontSize: 17, fontWeight: "600", color: C.textSecondary },
  compactStepperValue: { minWidth: 22, textAlign: "center", fontSize: 14, fontWeight: "700", color: C.textPrimary },
  adaptationPill: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5,
  },
  adaptationPillText: { fontSize: 12, fontWeight: "700" },
  standaloneHeaderName: { fontSize: 14, fontWeight: "600", color: C.textSecondary, marginTop: 2 },
  standaloneMenuBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  standaloneFields: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },

  actionSheetBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  actionSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingBottom: 24, paddingTop: 6,
  },
  actionSheetItem: { paddingHorizontal: 20, paddingVertical: 15, alignItems: "center" },
  actionSheetItemText: { fontSize: 16, fontWeight: "600", color: C.textPrimary },
  actionSheetDivider: { height: 8 },

  adaptationRowStandalone: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    paddingVertical: 4,
  },
  adaptationChipStandalone: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.bg, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
  },
  adaptationChipTextStandalone: { fontSize: 14, fontWeight: "600", color: C.textSecondary },

  // minWidth + the row's wrap: in an exercise-card-sized block card three
  // steppers can't share a line, so the third drops to the next one.
  stepperField: { flex: 1, minWidth: 130 },
  stepperControl: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.bg, borderRadius: 24,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 4, height: 48,
  },
  stepperBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  stepperBtnText: { fontSize: 22, fontWeight: "600", color: C.textSecondary },
  stepperValue: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700", color: C.textPrimary },
  numericsRowStandalone: { flexDirection: "row", flexWrap: "wrap", columnGap: 12 },

  timeLimitToggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  timeLimitToggleLabel: { fontSize: 15, fontWeight: "600", color: C.textPrimary },
  timeLimitToggleRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  timeLimitToggleStatus: { fontSize: 14, color: C.textSecondary },
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
  // Two per row while both fit at minWidth; below that, one per row at full
  // width (a fixed 48% left half the narrow pane empty).
  blockTypeCard: {
    flexBasis: "40%", flexGrow: 1, minWidth: 130,
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
  exerciseRow: {
    backgroundColor: C.surfaceHigh, borderRadius: 14, padding: 12, gap: 6, marginTop: 6,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  exercisePhotoThumb: { width: "100%", aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: C.surface },
  exerciseNotesPreview: { fontSize: 12, color: C.textSecondary, fontStyle: "italic" },
  exerciseRowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  exerciseRowTags: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 },
  exerciseTypeTag: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, color: C.textMuted },
  movementTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  movementTagText: { fontSize: 11, fontWeight: "700" },
  movementWarning: { backgroundColor: "#4A3A20", borderRadius: 10, padding: 10, marginBottom: 10, gap: 4 },
  movementWarningText: { fontSize: 12, color: "#E0B45D", lineHeight: 16 },
  athleteProgressBanner: { backgroundColor: "rgba(111,207,151,0.12)", borderWidth: 1, borderColor: C.green, borderRadius: 8, padding: 8, marginBottom: 10, gap: 4 },
  athleteProgressText: { fontSize: 12, color: C.green, lineHeight: 16 },
  athleteProgressTextBold: { fontWeight: "700" },

  // S&C exercise selection: library pane + selected cards
  scSplit: { flexDirection: "row", gap: 14, alignItems: "flex-start", marginTop: 6 },
  scStack: { gap: 12, marginTop: 6 },
  scCards: { flex: 1, gap: 10 },
  scCardsStack: { gap: 10 },
  scEmptyHint: { fontSize: 13, color: C.textMuted, fontStyle: "italic", paddingVertical: 12 },
  scAddBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: C.green, borderStyle: "dashed", borderRadius: 10,
    paddingVertical: 12, marginTop: 4,
  },
  scAddBtnText: { fontSize: 14, fontWeight: "700", color: C.green },
  // Wide-screen exercise card grid — numbered, reorderable cards that wrap
  // instead of stacking in one long column.
  exGrid: { flexDirection: "row", flexWrap: "wrap", gap: EXERCISE_CARD_GAP, marginTop: 6 },
  exGridCell: { position: "relative" },
  // Zero-height clip so the measuring copy lays out at full natural width
  // without showing or taking space.
  titleMeasureWrap: { position: "absolute", left: 0, top: 0, width: 2000, height: 0, overflow: "hidden", opacity: 0 },
  exCardNumberBadge: {
    position: "absolute", top: -8, left: -8, width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.green, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: C.surface, zIndex: 6,
  },
  exCardNumberText: { fontSize: 11, fontWeight: "800", color: C.bg },
  // Sits in the gap to the card's right; the grip only hints where to grab.
  cardResizeHandle: {
    position: "absolute", top: 0, bottom: 0, right: -EXERCISE_CARD_GAP + 1, width: EXERCISE_CARD_GAP,
    alignItems: "center", justifyContent: "center", zIndex: 5,
  },
  cardResizeGrip: { width: 3, height: 36, borderRadius: 2, backgroundColor: C.border },
  exCardGripHandle: {
    position: "absolute", top: -10, right: -6, zIndex: 6, padding: 5, borderRadius: 8,
    backgroundColor: C.surfaceHigh, borderWidth: 1, borderColor: C.border,
  },
  // Library reads as its own raised pane card, like the protocol-detail pane.
  libPane: {
    backgroundColor: C.surfaceHigh, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 14,
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  libPaneWide: { width: 320 },
  libScroll: { maxHeight: 380 },
  libOverlayInner: { flex: 1, padding: 16 },
  libHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  libTitle: { fontSize: 12, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "700" },
  libSearchWrap: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.surfaceHigh, borderRadius: 10,
    paddingHorizontal: 10,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 12,
  },
  libSearchInput: {
    flex: 1, color: C.textPrimary, fontSize: 13,
    paddingVertical: 8, padding: 0,
  },
  libGroup: { marginBottom: 14 },
  libGroupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  libGroupLabel: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  libNew: { fontSize: 13, fontWeight: "700", color: C.green },
  libEmpty: { fontSize: 12, color: C.textMuted, fontStyle: "italic", paddingVertical: 2 },
  // Chips size to their name and wrap horizontally.
  libChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  libChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border,
    paddingLeft: 8, paddingRight: 12, paddingVertical: 7,
  },
  libChipText: { fontSize: 13, fontWeight: "600", color: C.textPrimary },
  exercisePickerButton: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, backgroundColor: C.surfaceHigh },
  exercisePickerName: { fontSize: 15, color: C.textPrimary, fontWeight: "500" },
  exercisePickerPlaceholder: { fontSize: 15, color: C.textMuted },
  freeSessionRouteRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  freeSessionClearRouteBtn: { padding: 2 },
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
  routePickerZoomBtn: {
    position: "absolute", right: 4, bottom: 4,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center",
  },
  routePickerBody: { flex: 1, gap: 2 },
  routePreviewSafe: { flex: 1, backgroundColor: C.bg },
  routePreviewHint: {
    textAlign: "center", fontSize: 12, color: C.textMuted, paddingVertical: 8,
  },
  routePreviewFooter: { paddingHorizontal: 20, paddingBottom: 12 },
  exercisePickerRowMeta: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  listHeaderActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  exercisesButton: { borderWidth: 1, borderColor: C.green, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  exercisesButtonText: { color: C.green, fontWeight: "600", fontSize: 13 },
})