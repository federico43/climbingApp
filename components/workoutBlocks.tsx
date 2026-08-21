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
} from "@/utils/sequenceVariations"
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
  unassignProtocol,
  BlockRow,
  createProtocol,
  deleteBlock,
  deleteProtocol,
  ExerciseRow,
  getAthletes,
  getSprayRoute,
  getSprayRoutes,
  getSprayWalls,
  SprayWallRow,
  listBlocks,
  listExercises,
  listProtocols,
  ProtocolRow,
  saveBlockToLibrary,
  saveSprayRoute,
  upsertBlockTemplate,
  SprayRouteRow,
  updateBlock,
  updateProtocol,
} from "@/services/BoulderGraphService"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator, Alert,
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
import { SafeAreaView } from "react-native-safe-area-context"

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
  id: string; type: "reps" | "both_sides" | "7/3s"; name: string; exerciseId?: string; unit?: "reps" | "seconds"; reps?: string; edge?: string; series?: number; photoUri?: string; notes?: string
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
  // Which variation the athlete starts on. Defaults to "original" (try the
  // base climb first, then calibrate) — the coach can override this to have
  // the athlete start on Easy or Hard instead.
  startingVariation?: VariationKey
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
}

interface IntervalsBlock extends BaseBlock {
  type: "intervals"
  description: string
  series: number     // number of work/rest rounds
  workTime: number   // work duration per round (seconds)
  restTime: number   // rest duration between rounds (seconds)
}

export type Block = ProjectBoulderingBlock | ConstraintWarmupBlock | StrengthConditioningBlock | ExplorationSessionBlock | SequenceBlock | FreeSessionBlock | FourByFourBlock | IntervalsBlock

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
  return { ...data, id: generateId(), blockName: row.name }
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
  four_by_four: "Sets of boulders for endurance",
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
      const { id, ...data } = editingBlock
      const updated = await updateBlock(editingRow.$id, { name: editingBlock.blockName, type: editingBlock.type, data })
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
      const { id, ...data } = block
      await saveBlockToLibrary({ name: block.blockName, type: block.type, data })
      loadLibrary() // so the new template shows in the library tab
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

export function BlockEditorRow({ block, isExpanded, isActive, onToggleExpand, onDrag, onUpdate, onDelete, onSaveAsTemplate, onMoveUp, onMoveDown, standalone }: {
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
}) {
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
            <Text style={styles.fieldLabel}>
              Adaptation <Text style={styles.fieldLabelHint}>· one</Text>
            </Text>
            <AdaptationPicker
              value={resolveAdaptation(block)}
              onChange={(v) => onUpdate({ ...block, adaptation: v })}
            />
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
function StandaloneHeader({ block, onSaveAsTemplate, onDelete }: {
  block: Block; onSaveAsTemplate?: () => void; onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const color = ADAPTATION_COLOR[resolveAdaptation(block)]
  return (
    <>
      <View style={styles.standaloneHeaderRow}>
        <View style={styles.standaloneHeaderLeft}>
          <View style={[styles.standaloneDot, { backgroundColor: color }]} />
          <Text style={styles.standaloneHeaderTitle}>{BLOCK_LABELS[block.type]}</Text>
        </View>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} style={styles.standaloneMenuBtn}>
          <Ionicons name="ellipsis-horizontal" size={18} color={C.textSecondary} />
        </Pressable>
      </View>
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

function StandaloneBlockFields({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
  return (
    <View style={styles.standaloneFields}>
      <Text style={styles.fieldLabel}>Block name</Text>
      <TextInput
        style={styles.fieldInput}
        value={block.blockName}
        onChangeText={(v) => onUpdate({ ...block, blockName: v })}
        placeholderTextColor="#aaa"
        placeholder="Block name"
      />

      <BlockNumerics block={block} onUpdate={onUpdate} standalone />

      <TimeLimitToggle block={block} onUpdate={onUpdate} />

      <Text style={styles.fieldLabel}>
        Adaptation <Text style={styles.fieldLabelHint}>· one</Text>
      </Text>
      <AdaptationPicker
        value={resolveAdaptation(block)}
        onChange={(v) => onUpdate({ ...block, adaptation: v })}
      />

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

// The short numeric fields for a block, rendered as a compact row so they can
// sit beside the Block name input. Returns null for types with no numerics.
function BlockNumerics({ block, onUpdate, standalone }: { block: Block; onUpdate: (b: Block) => void; standalone?: boolean }) {
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
      return null
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

function FourByFourFields({ block, onUpdate }: { block: FourByFourBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<FourByFourBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
    </>
  )
}

function IntervalsFields({ block, onUpdate }: { block: IntervalsBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<IntervalsBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
    </>
  )
}

function ConstraintWarmupFields({ block, onUpdate }: { block: ConstraintWarmupBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<ConstraintWarmupBlock>) { onUpdate({ ...block, ...fields }) }
  return (
    <>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <FieldLabel label="Grade" /><GradePicker value={block.level} onChange={(v) => update({ level: v })} />
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
export type SCLibraryController = { open: (blockId: string) => void }
export const SCLibraryContext = createContext<SCLibraryController | null>(null)

// Build a block Exercise from a library row, applying its defaults.
export function exerciseFromLibrary(ex: ExerciseRow): Exercise {
  const base = { id: generateId(), type: ex.type, name: ex.name, exerciseId: ex.$id, unit: ex.unit ?? "reps", photoUri: ex.photoUri, notes: ex.notes }
  return ex.type === "7/3s"
    ? { ...base, edge: ex.defaultEdge ?? "20mm", series: ex.defaultSeries ?? 6 }
    : { ...base, reps: ex.defaultReps ?? (ex.unit === "seconds" ? "20-30" : "4-6") }
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

  const renderCard = (ex: Exercise) => (
    <ExerciseEditorRow
      key={ex.id} exercise={ex}
      onUpdate={(updated) => update({ exercises: block.exercises.map((e) => (e.id === updated.id ? updated : e)) })}
      onDelete={() => update({ exercises: block.exercises.filter((e) => e.id !== ex.id) })}
    />
  )

  return (
    <View onLayout={(e) => setPaneW(e.nativeEvent.layout.width)}>
      <FieldLabel label="Description" /><FieldInput value={block.description} onChange={(v) => update({ description: v })} multiline />
      <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Exercises</Text>
      {lib ? (
        <View style={styles.scCardsStack}>
          {block.exercises.length === 0
            ? <Text style={styles.scEmptyHint}>No exercises yet — add from the library.</Text>
            : block.exercises.map(renderCard)}
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
              : block.exercises.map(renderCard)}
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


function ExerciseEditorRow({ exercise, onUpdate, onDelete }: { exercise: Exercise; onUpdate: (e: Exercise) => void; onDelete: () => void }) {
  function update(fields: Partial<Exercise>) { onUpdate({ ...exercise, ...fields }) }
  const typeLabel = exercise.type === "reps" ? "Reps" : exercise.type === "both_sides" ? "Both sides" : "7/3s"

  return (
    <View style={styles.exerciseRow}>
      <View style={styles.exerciseRowHeader}>
        <Text style={styles.exerciseTypeTag}>{typeLabel}</Text>
        <Pressable onPress={onDelete} hitSlop={6}><Text style={styles.deleteButtonText}>✕</Text></Pressable>
      </View>

      {exercise.photoUri && (
        <Image source={{ uri: exercise.photoUri }} style={styles.exercisePhotoThumb} />
      )}
      {exercise.notes && (
        <Text style={styles.exerciseNotesPreview} numberOfLines={3}>{exercise.notes}</Text>
      )}

      <FieldLabel label="Exercise name" />
      <FieldInput value={exercise.name} onChange={(v) => update({ name: v })} placeholder="Exercise name" />

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
    </View>
  )
}

// ─── Sequence Fields ──────────────────────────────────────────────────────────

const ROUTE_FALLBACK_IMAGE = require("@/assets/images/spraywall.jpg")

function SequenceFields({ block, onUpdate }: { block: SequenceBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<SequenceBlock>) { onUpdate({ ...block, ...fields }) }
  const [showRoutePicker, setShowRoutePicker] = useState(false)
  // Creating a new route happens in a nested modal (the spray-wall builder),
  // not a screen push — so it works inside the workout-builder modal.
  const [creating, setCreating] = useState<{ wall: SprayWallRow | null } | null>(null)
  const [savingRoute, setSavingRoute] = useState(false)
  // Saving closes two nested native <Modal>s at once (the builder, then —
  // via selectRoute — the picker sheet underneath it). On iOS that races the
  // two UIKit dismiss animations and can strand a blank white view that
  // nothing can dismiss (same failure as the route-preview modal below), so
  // there we close only the builder and defer selectRoute to its onDismiss.
  const pendingRouteSelectRef = useRef<{ route: SprayRouteRow; wall: SprayWallRow | null } | null>(null)
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

  // Present the builder on top of the (still-open) route picker — closing the
  // picker first and presenting simultaneously races on iOS. selectRoute() closes
  // the picker on a successful save; backing out just drops back to it.
  function handleCreateNew(wall?: SprayWallRow) {
    setCreating({ wall: wall ?? null })
  }

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
        selectRoute(created, wall)
        setCreating(null)
      }
    } catch (e) {
      Alert.alert("Error", "Could not save the route. Try again.")
      console.error(e)
    } finally {
      setSavingRoute(false)
    }
  }

  return (
    <>
      <FieldLabel label="Description" />
      <FieldInput
        value={block.description}
        onChange={(v) => update({ description: v })}
        multiline
        placeholder="What should athletes know before starting?"
      />
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

      <Modal visible={showRoutePicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRoutePicker(false)}>
        <RoutePickerModal
          onSelect={selectRoute}
          onClose={() => setShowRoutePicker(false)}
          onCreateNew={handleCreateNew}
        />
      </Modal>

      {/* Create a new route inline (nested modal — no screen push) */}
      <Modal
        visible={creating !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCreating(null)}
        onDismiss={() => {
          const pending = pendingRouteSelectRef.current
          if (!pending) return
          pendingRouteSelectRef.current = null
          selectRoute(pending.route, pending.wall)
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
    </>
  )
}

// Free session's optional attached sequence: the same route picker/creator as
// a Sequence block, but with no attempts/rest/variation fields — the route is
// just shown to the athlete for reference while they climb freely.
function FreeSessionFields({ block, onUpdate }: { block: FreeSessionBlock; onUpdate: (b: Block) => void }) {
  function update(fields: Partial<FreeSessionBlock>) { onUpdate({ ...block, ...fields } as FreeSessionBlock) }
  const [showRoutePicker, setShowRoutePicker] = useState(false)
  const [creating, setCreating] = useState<{ wall: SprayWallRow | null } | null>(null)
  const [savingRoute, setSavingRoute] = useState(false)
  const pendingRouteSelectRef = useRef<{ route: SprayRouteRow; wall: SprayWallRow | null } | null>(null)

  function selectRoute(route: SprayRouteRow, wall?: SprayWallRow | null) {
    update({
      routeId: route.$id, routeName: route.name, routeHolds: route.holds,
      ...(wall?.imageUri ? { wallImageUri: wall.imageUri } : {}),
      ...(wall?.width && wall?.height ? { wallWidth: wall.width, wallHeight: wall.height } : {}),
    })
    setShowRoutePicker(false)
  }

  function handleCreateNew(wall?: SprayWallRow) {
    setCreating({ wall: wall ?? null })
  }

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
        selectRoute(created, wall)
        setCreating(null)
      }
    } catch (e) {
      Alert.alert("Error", "Could not save the route. Try again.")
      console.error(e)
    } finally {
      setSavingRoute(false)
    }
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

      <Modal visible={showRoutePicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRoutePicker(false)}>
        <RoutePickerModal
          onSelect={selectRoute}
          onClose={() => setShowRoutePicker(false)}
          onCreateNew={handleCreateNew}
        />
      </Modal>

      {/* Create a new route inline (nested modal — no screen push) */}
      <Modal
        visible={creating !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCreating(null)}
        onDismiss={() => {
          const pending = pendingRouteSelectRef.current
          if (!pending) return
          pendingRouteSelectRef.current = null
          selectRoute(pending.route, pending.wall)
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
    </>
  )
}

// ─── Route Picker Modal ───────────────────────────────────────────────────────

function RoutePickerModal({ onSelect, onClose, onCreateNew }: {
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
  function routeImageSource(route: SprayRouteRow) {
    const uri = route.wallId ? wallsById.get(route.wallId)?.imageUri : undefined
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
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {filteredRoutes.map((route) => {
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
          })}
        </ScrollView>
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
                  onPress={() => { setWallPickerVisible(false); onCreateNew(wall) }}
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
  // No fixed width/column count — each card hugs its name, so short names get
  // small boxes and long ones get bigger boxes (wrapping past maxWidth).
  libraryCard: {
    minWidth: 130, maxWidth: 260,
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

  stepperField: { flex: 1 },
  stepperControl: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.bg, borderRadius: 24,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 4, height: 48,
  },
  stepperBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  stepperBtnText: { fontSize: 22, fontWeight: "600", color: C.textSecondary },
  stepperValue: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700", color: C.textPrimary },
  numericsRowStandalone: { flexDirection: "row", gap: 12 },

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
  exercisePhotoThumb: { width: "100%", height: 110, borderRadius: 8, backgroundColor: C.surface },
  exerciseNotesPreview: { fontSize: 12, color: C.textSecondary, fontStyle: "italic" },
  exerciseRowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  exerciseTypeTag: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, color: C.textMuted },

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