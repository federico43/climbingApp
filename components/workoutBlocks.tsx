import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { Ionicons } from "@expo/vector-icons"
import { ExerciseForm } from "@/components/ExerciseForm"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import { BoulderLevelOptions } from "@/components/ProjectPickerModal"
import { SprayWallBuilder } from "@/components/SprayWallBuilder"
import { RouteVariations } from "@/utils/sequenceVariations"
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
  updateProtocol,
} from "@/services/BoulderGraphService"
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
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

type BlockType = "project_bouldering" | "constraint_warmup" | "strength_conditioning" | "exploration_session" | "sequence" | "free_session" | "four_by_four" | "intervals"

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
  intervals: "Intervals",
}

const BLOCK_ICONS: Record<BlockType, keyof typeof Ionicons.glyphMap> = {
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

export function BlockPickerModal({
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

  async function loadLibrary() {
    setLoadingLibrary(true)
    try { setLibraryBlocks(await listBlocks()) }
    catch (e) { console.error(e) }
    finally { setLoadingLibrary(false) }
  }
  // Initial load, and re-fetch whenever the Library tab is opened so newly
  // created / updated templates show up without reopening the sheet.
  useEffect(() => { if (tab === "library") loadLibrary() }, [tab])

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
      loadLibrary() // so the new template shows in the library tab
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
            <Text style={{ fontSize: 12, color: C.textMuted, paddingHorizontal: 4, marginBottom: 4 }}>
              {libraryBlocks.length} block{libraryBlocks.length !== 1 ? "s" : ""} loaded
            </Text>
            {(() => {
              // Apply search filter, then group by type
              const q = librarySearch.trim().toLowerCase()
              const filtered = (q
                ? libraryBlocks.filter((b) =>
                    b.name.toLowerCase().includes(q) ||
                    (BLOCK_LABELS[b.type as BlockType] ?? "").toLowerCase().includes(q)
                  )
                : libraryBlocks
              )
                // Case-insensitive A→Z (Appwrite's sort is case-sensitive).
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
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

export function BlockEditorRow({ block, isExpanded, isActive, onToggleExpand, onDrag, onUpdate, onDelete, onSaveAsTemplate, onMoveUp, onMoveDown }: {
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
          <TimeLimitField block={block} onUpdate={onUpdate} />
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
          {block.type === "intervals" && <IntervalsFields block={block as IntervalsBlock} onUpdate={onUpdate} />}
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

// The short numeric fields for a block, rendered as a compact row so they can
// sit beside the Block name input. Returns null for types with no numerics.
function BlockNumerics({ block, onUpdate }: { block: Block; onUpdate: (b: Block) => void }) {
  function update(fields: any) { onUpdate({ ...block, ...fields } as Block) }
  let fields: React.ReactNode = null
  switch (block.type) {
    case "project_bouldering":
      fields = (<>
        <NumField label="Attempts" value={block.targetAttempts} onChange={(n) => update({ targetAttempts: n })} />
        <NumField label="Rest (s)" value={block.restTime} onChange={(n) => update({ restTime: n })} />
      </>); break
    case "four_by_four":
      fields = (<>
        <NumField label="Sets" value={block.sets} onChange={(n) => update({ sets: n })} />
        <NumField label="Per set" value={block.bouldersPerSet} onChange={(n) => update({ bouldersPerSet: n })} />
        <NumField label="Rest (s)" value={block.restTime} onChange={(n) => update({ restTime: n })} />
      </>); break
    case "intervals":
      fields = (<>
        <NumField label="Series" value={block.series} onChange={(n) => update({ series: n })} />
        <NumField label="Work (s)" value={block.workTime} onChange={(n) => update({ workTime: n })} />
        <NumField label="Rest (s)" value={block.restTime} onChange={(n) => update({ restTime: n })} />
      </>); break
    case "strength_conditioning":
      fields = (<>
        <NumField label="Rounds" value={block.rounds} onChange={(n) => update({ rounds: n })} />
        <NumField label="Rest (s)" value={block.restBetweenRounds} onChange={(n) => update({ restBetweenRounds: n })} />
      </>); break
    case "sequence":
      fields = (<>
        <NumField label="Attempts" value={block.targetAttempts} onChange={(n) => update({ targetAttempts: n })} />
        <NumField label="Rest (s)" value={block.restTime} onChange={(n) => update({ restTime: n })} />
      </>); break
    case "constraint_warmup":
      fields = (
        <NumField label="Attempts" value={block.targetAttempts} onChange={(n) => update({ targetAttempts: n })} />
      ); break
    default:
      return null
  }
  return <View style={styles.numericsRow}>{fields}</View>
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
  const base = { id: generateId(), type: ex.type, name: ex.name, exerciseId: ex.$id, unit: ex.unit ?? "reps" }
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
  const overlay = variant === "overlay"
  const containerStyle = overlay ? styles.libOverlayInner : [styles.libPane, wide && styles.libPaneWide]

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
      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} />
      ) : (
        <ScrollView
          style={overlay ? undefined : styles.libScroll}
          contentContainerStyle={overlay ? { paddingBottom: 20 } : undefined}
          nestedScrollEnabled keyboardShouldPersistTaps="handled"
        >
          {SC_TYPES.map((g) => {
            const items = exercises.filter((e) => e.type === g.type)
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

  function selectRoute(route: SprayRouteRow, wall?: SprayWallRow | null) {
    update({
      routeId: route.$id, routeName: route.name, routeHolds: route.holds,
      ...(wall?.imageUri ? { wallImageUri: wall.imageUri } : {}),
      ...(wall?.width && wall?.height ? { wallWidth: wall.width, wallHeight: wall.height } : {}),
    })
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
      selectRoute(created, wall)
      setCreating(null)
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

      <Modal visible={showRoutePicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowRoutePicker(false)}>
        <RoutePickerModal
          onSelect={selectRoute}
          onClose={() => setShowRoutePicker(false)}
          onCreateNew={handleCreateNew}
        />
      </Modal>

      {/* Create a new route inline (nested modal — no screen push) */}
      <Modal visible={creating !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setCreating(null)}>
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
  libraryGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 10,
  },
  libraryCard: {
    width: "31%",
    flexGrow: 1,
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
  nameRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  nameField: { flex: 1.2 },
  numericsRow: { flex: 1.8, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  numField: { flex: 1 },
  timeLimitRow: { maxWidth: 220 },
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