import { AdaptationPicker, BLOCK_LABELS, Block, BlockSheetFields, SCLibraryContext } from "@/components/workoutBlocks"
import { Mono, PosterHeadline, posterSize, StartBar, TitleGlow, hexAlpha } from "@/components/paper"
import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { font } from "@/theme/paper/tokens"
import { ADAPTATION_COLOR, ADAPTATION_LABEL, resolveAdaptation } from "@/utils/adaptations"
import { blockMinutes, blockOrdinal, noteExcerpt, type BlockMode } from "@/utils/builderSpine"
import { noteParts } from "@/utils/blockNotes"
import { Ionicons } from "@expo/vector-icons"
import React, { useContext, useMemo, useState } from "react"
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native"
import type { EdgeInsets } from "react-native-safe-area-context"

// Phone workout builder (mock-ups 2026-11-25, "Mobile builder · spine +
// expanded block"): the blocks hang off a vertical spine of numbered nodes,
// each one a short card (category, minutes, name, the note's first line, a
// Homework chip). A tap opens the block's sheet: rename, the
// adaptation it trains, its settings, Own / Homework and the note
// for the athlete, closed with the Done bar.

const SPINE_W = 34
const NODE = 30

function blockTitle(b: Block): string {
  if (b.type === "strength_conditioning") {
    return b.exercises.length ? b.exercises.map((e) => e.name || "Unnamed").join(", ") : "No exercises yet"
  }
  return b.blockName?.trim() || BLOCK_LABELS[b.type]
}

/** Drag handle: 2 × 3 dots. */
function Grip({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 3, padding: 2 }} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1].map((c) => (
        <View key={c} style={{ gap: 3 }}>
          {[0, 1, 2].map((r) => <View key={r} style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }} />)}
        </View>
      ))}
    </View>
  )
}

/** The note with its key numbers in bold ("Warm up with **4 orange routes**"). */
function NoteText({ text, color }: { text: string; color: string }) {
  return (
    <Text style={[styles.noteText, { color }]}>
      {noteParts(text).map((p, i) => p.key ? <Text key={i} style={{ fontFamily: font.bold }}>{p.text}</Text> : p.text)}
    </Text>
  )
}

/** The spine's line + node beside a row. `node` null = a "+" node (suggested warm-up). */
function SpineColumn({ node, homework, first, last }: { node: string | null; homework?: boolean; first?: boolean; last?: boolean }) {
  const t = usePaper()
  const line = hexAlpha(t.ink, 0.85)
  return (
    <View style={{ width: SPINE_W, alignItems: "center" }}>
      <View style={{ width: 2, height: 16, backgroundColor: first ? "transparent" : line }} />
      <View
        style={[
          styles.node,
          node === null
            ? { borderWidth: 1.5, borderStyle: "dashed", borderColor: t.ink, backgroundColor: t.paper }
            : homework
              ? { borderWidth: 2, borderColor: t.pink, backgroundColor: t.paper }
              : t.mode === "dark"
                ? { borderWidth: 1.5, borderColor: t.ink, backgroundColor: t.paper }
                : { backgroundColor: t.ink },
        ]}
      >
        {node === null
          ? <Ionicons name="add" size={15} color={t.ink} />
          : <Text style={[styles.nodeText, { color: homework ? t.pink : t.mode === "dark" ? t.ink : t.paper }]}>{node}</Text>}
      </View>
      <View style={{ width: 2, flex: 1, backgroundColor: last ? "transparent" : line }} />
    </View>
  )
}

/** The suggested warm-up, hanging off the spine's "+" node above the blocks. */
export function SpineWarmup({ children, hasBlocks }: { children: React.ReactNode; hasBlocks: boolean }) {
  return (
    <View style={styles.row}>
      <SpineColumn node={null} first last={!hasBlocks} />
      <View style={styles.rowBody}>{children}</View>
    </View>
  )
}

export function SpineBlockRow({ block, index, total, mode, dueLabel, isActive, onOpen, onDrag }: {
  block: Block
  index: number
  total: number
  mode: BlockMode
  /** "Sat 29 Nov" when the block is homework. */
  dueLabel?: string
  isActive?: boolean
  onOpen: () => void
  onDrag: () => void
}) {
  const t = usePaper()
  const homework = mode === "homework"
  const note = noteExcerpt(block.description)
  return (
    <View style={styles.row}>
      <SpineColumn node={String(index + 1).padStart(2, "0")} homework={homework} last={index === total - 1} />
      <View style={styles.rowBody}>
        <Pressable
          onPress={onOpen}
          onLongPress={onDrag}
          delayLongPress={250}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${blockTitle(block)}`}
          accessibilityHint="Long-press to reorder"
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: t.card, borderColor: homework ? t.pink : t.cardBorder, borderWidth: homework ? 1.5 : 1 },
            (pressed || isActive) && { opacity: 0.85 },
            isActive && { transform: [{ scale: 1.02 }] },
          ]}
        >
          <View style={styles.cardTop}>
            <View style={[styles.dot, { backgroundColor: t.ink }]} />
            <Mono color={t.ink} numberOfLines={1} style={{ flex: 1 }}>
              {`${BLOCK_LABELS[block.type]} · ${blockMinutes(block)} min`}
            </Mono>
            <Grip color={hexAlpha(t.ink, 0.5)} />
          </View>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: t.ink }]} numberOfLines={2}>{blockTitle(block)}</Text>
            <Ionicons name="chevron-forward" size={18} color={t.ink} />
          </View>
          {!!note && <Text style={[styles.cardNote, { color: t.textMuted }]} numberOfLines={1}>{note}</Text>}
          {homework && (
            <View style={[styles.chip, { borderColor: t.pink }]}>
              <Ionicons name="home-outline" size={11} color={t.pink} />
              <Mono color={t.pink} size={9.5}>{dueLabel ? `Homework · ${dueLabel}` : "Homework"}</Mono>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  )
}

const MODES: { key: BlockMode; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "own", label: "Own", icon: "person-outline" },
  { key: "homework", label: "Homework", icon: "home-outline" },
]

/** The block's sheet over the builder (the mock-up's "Expanded" screen). */
export function BlockSheet({ block, index, total, mode, athleteName, canHomework, insets, onUpdate, onMode, onDelete, onClose }: {
  block: Block | null
  index: number
  total: number
  mode: BlockMode
  /** null = library workout: no Own / Homework. */
  athleteName: string | null
  canHomework: boolean
  insets: EdgeInsets
  onUpdate: (b: Block) => void
  onMode: (m: BlockMode) => void
  onDelete: () => void
  onClose: () => void
}) {
  const t = usePaper()
  const { width } = useWindowDimensions()
  const [renaming, setRenaming] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [trainsOpen, setTrainsOpen] = useState(false)
  const [glowH, setGlowH] = useState(0)
  // S&C "Add exercise" opens the builder's exercise library, which sits
  // under this sheet: close the sheet first so the library shows.
  const library = useContext(SCLibraryContext)
  const sheetLibrary = useMemo(() => library && ({ open: (id: string) => { onClose(); library.open(id) } }), [library, onClose])

  const close = () => { setRenaming(false); setEditingNote(false); setTrainsOpen(false); onClose() }
  const title = block ? blockTitle(block) : ""
  const adaptation = block ? resolveAdaptation(block) : "general"
  const modes = MODES.filter((m) => (m.key !== "homework" || canHomework))
  const posterPx = Math.min(58, posterSize(title, 58, width))

  return (
    <Modal visible={!!block} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close the block" />
        {block && (
          <View style={[styles.sheet, { backgroundColor: t.paper, marginTop: insets.top + 64, paddingBottom: insets.bottom + 8 }]}>
            <View style={[styles.handle, { backgroundColor: hexAlpha(t.ink, 0.3) }]} />
            <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {/* The glow stays behind the title (up to the settings card),
                  the cards below sit on plain paper — as in the mock-up. */}
              {glowH > 0 && (
                <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
                  <TitleGlow width={width} height={glowH + 24} variant="sheet" />
                </View>
              )}
              <View style={styles.sheetTop}>
                <Mono color={t.ink} style={{ flex: 1 }}>{blockOrdinal(index, total)}</Mono>
                {block.type !== "strength_conditioning" && (
                  <Pressable onPress={() => setRenaming((r) => !r)} hitSlop={10} style={styles.linkBtn} accessibilityRole="button">
                    <Ionicons name={renaming ? "checkmark" : "pencil"} size={13} color={t.ink} />
                    <Text style={[styles.link, { color: t.ink }]}>{renaming ? "Done" : "Rename"}</Text>
                  </Pressable>
                )}
              </View>
              {renaming ? (
                <TextInput
                  value={block.blockName}
                  onChangeText={(v) => onUpdate({ ...block, blockName: v })}
                  placeholder={BLOCK_LABELS[block.type]}
                  placeholderTextColor={t.label}
                  autoFocus
                  onSubmitEditing={() => setRenaming(false)}
                  style={[styles.renameInput, { color: t.ink, borderBottomColor: t.ink }]}
                />
              ) : (
                <PosterHeadline size={posterPx} style={{ marginTop: 8 }}>{title}</PosterHeadline>
              )}

              {block.type !== "strength_conditioning" && (
                <>
                  <Pressable
                    onPress={() => setTrainsOpen((o) => !o)}
                    style={[styles.trains, { borderColor: t.ink }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Trains ${ADAPTATION_LABEL[adaptation]}. Change`}
                  >
                    <Mono color={t.label} size={9.5}>Trains</Mono>
                    <View style={[styles.dot, { backgroundColor: ADAPTATION_COLOR[adaptation] }]} />
                    <Text style={[styles.trainsText, { color: t.ink }]}>{ADAPTATION_LABEL[adaptation]}</Text>
                    <Ionicons name={trainsOpen ? "chevron-up" : "chevron-down"} size={14} color={t.ink} />
                  </Pressable>
                  {trainsOpen && (
                    <AdaptationPicker value={adaptation} onChange={(v) => { onUpdate({ ...block, adaptation: v }); setTrainsOpen(false) }} />
                  )}
                </>
              )}

              <View style={[styles.fieldsCard, { backgroundColor: t.card, borderColor: t.cardBorder }]} onLayout={(e) => setGlowH(e.nativeEvent.layout.y)}>
                <SCLibraryContext.Provider value={sheetLibrary}>
                  <BlockSheetFields block={block} onUpdate={onUpdate} />
                </SCLibraryContext.Provider>
              </View>

              {!!athleteName && (
                <View style={[styles.segment, { borderColor: t.ink, backgroundColor: t.card }]}>
                  {modes.map((m) => {
                    const on = mode === m.key
                    // Selected = filled (ink; homework pink), text in paper.
                    const fill = m.key === "homework" ? t.pink : t.ink
                    const tone = on ? t.paper : t.ink
                    return (
                      <Pressable
                        key={m.key}
                        onPress={() => onMode(m.key)}
                        style={[styles.segmentItem, on && { backgroundColor: fill }]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Ionicons name={m.icon} size={14} color={tone} />
                        <Text style={[styles.segmentText, { color: tone }]}>{m.label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              )}

              <View style={[styles.noteCard, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
                <View style={styles.sheetTop}>
                  <Mono color={t.label} style={{ flex: 1 }} numberOfLines={1}>{athleteName ? `Note for ${athleteName}` : "Note for the athlete"}</Mono>
                  <Pressable onPress={() => setEditingNote((e) => !e)} hitSlop={10} style={styles.linkBtn} accessibilityRole="button">
                    <Ionicons name={editingNote ? "checkmark" : "pencil"} size={13} color={t.ink} />
                    <Text style={[styles.link, { color: t.ink }]}>{editingNote ? "Done" : "Edit"}</Text>
                  </Pressable>
                </View>
                {editingNote ? (
                  <TextInput
                    value={block.description}
                    onChangeText={(v) => onUpdate({ ...block, description: v } as Block)}
                    placeholder="What should they know before starting?"
                    placeholderTextColor={t.label}
                    multiline
                    autoFocus
                    style={[styles.noteInput, { color: t.ink, backgroundColor: t.inputFill, borderColor: t.inputBorder }]}
                  />
                ) : (
                  block.description?.trim()
                    ? <NoteText text={block.description.trim()} color={t.ink} />
                    : <Text style={[styles.noteText, { color: t.label }]}>No note yet. Tap Edit to add one.</Text>
                )}
              </View>

              <Pressable onPress={onDelete} style={styles.deleteBtn} hitSlop={8} accessibilityRole="button">
                <Ionicons name="trash-outline" size={14} color={t.textMuted} />
                <Text style={[styles.deleteText, { color: t.textMuted }]}>Delete block</Text>
              </Pressable>
            </ScrollView>
            <View style={styles.sheetFooter}>
              <StartBar label="Done" sub="Back to the workout" icon="checkmark" offset onPress={close} />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  rowBody: { flex: 1, paddingBottom: 12, paddingLeft: 6 },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, alignItems: "center", justifyContent: "center" },
  nodeText: { fontFamily: font.mono, fontSize: 10.5, letterSpacing: 0.5 },
  card: { borderRadius: 22, paddingHorizontal: 16, paddingVertical: 14, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, fontFamily: font.bold, fontSize: 20 },
  cardNote: { fontFamily: font.body, fontSize: 13 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginTop: 2,
  },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginTop: 8 },
  sheetContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, gap: 14 },
  sheetTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  link: { fontFamily: font.bold, fontSize: 13, textDecorationLine: "underline" },
  renameInput: { fontFamily: font.title, fontSize: 34, borderBottomWidth: 2, paddingVertical: 6, marginTop: 4 },
  trains: {
    flexDirection: "row", alignItems: "center", gap: 7, alignSelf: "flex-start",
    borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, height: 40,
  },
  trainsText: { fontFamily: font.bold, fontSize: 15 },
  fieldsCard: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 2 },
  segment: { flexDirection: "row", borderWidth: 2, borderRadius: 999, padding: 4, gap: 4 },
  segmentItem: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    height: 42, borderRadius: 999,
  },
  segmentText: { fontFamily: font.bold, fontSize: 15 },
  noteCard: { borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  noteText: { fontFamily: font.body, fontSize: 14, lineHeight: 20 },
  noteInput: { minHeight: 90, borderRadius: 14, borderWidth: 1.5, padding: 12, fontFamily: font.body, fontSize: 14, textAlignVertical: "top" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", minHeight: 36 },
  deleteText: { fontFamily: font.bold, fontSize: 13 },
  sheetFooter: { paddingHorizontal: 16, paddingTop: 8 },
})
