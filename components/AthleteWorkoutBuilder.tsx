import { C } from "@/utils/theme"
import { AppUser, assignProtocol, createProtocol } from "@/services/BoulderGraphService"
import {
  Block,
  BlockEditorRow,
  BlockPickerModal,
  stripLocalIds,
} from "@/app/(tabs)/(buttonTabs)/protocolDesigner"
import { useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

// Per-athlete workout builder (big screen). Two card panes: the workout (left)
// and the available blocks (right). Saving creates a protocol and assigns it to
// the athlete. The left pane's ⋮ menu copies the workout to other athletes.
// Built additively — reuses the existing block editor/picker without changing
// the protocol-designer screen.
export function AthleteWorkoutBuilder({
  athlete,
  roster,
  onClose,
  onSaved,
}: {
  athlete: AppUser
  roster: AppUser[]
  onClose: () => void
  onSaved?: () => void
}) {
  const [name, setName] = useState("")
  const [blocks, setBlocks] = useState<Block[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set())
  const [copying, setCopying] = useState(false)

  function addBlock(b: Block) { setBlocks((p) => [...p, b]); setExpandedId(b.id) }
  function updateBlock(b: Block) { setBlocks((p) => p.map((x) => (x.id === b.id ? b : x))) }
  function deleteBlock(id: string) { setBlocks((p) => p.filter((x) => x.id !== id)) }

  function validate(): boolean {
    if (!name.trim()) { Alert.alert("Name required", "Give this workout a name."); return false }
    if (blocks.length === 0) { Alert.alert("No blocks", "Add at least one block from the right."); return false }
    return true
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const protocol = await createProtocol({ name: name.trim(), blocks: stripLocalIds(blocks) })
      await assignProtocol(athlete.$id, protocol.$id)
      onSaved?.()
      onClose()
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save the workout.")
      setSaving(false)
    }
  }

  async function copyToAthletes() {
    if (!validate()) return
    const ids = [...copyTargets]
    if (ids.length === 0) { setCopyOpen(false); return }
    setCopying(true)
    try {
      // Each target gets its own copy so they can diverge later.
      for (const id of ids) {
        const p = await createProtocol({ name: name.trim(), blocks: stripLocalIds(blocks) })
        await assignProtocol(id, p.$id)
      }
      setCopyOpen(false)
      setCopyTargets(new Set())
      onSaved?.()
      Alert.alert("Copied", `Workout copied to ${ids.length} athlete${ids.length !== 1 ? "s" : ""}.`)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not copy the workout.")
    } finally {
      setCopying(false)
    }
  }

  const otherAthletes = roster.filter((a) => a.$id !== athlete.$id)
  const athleteName = athlete.username ?? athlete.$id

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={onClose} hitSlop={8}><Text style={s.cancel}>Cancel</Text></Pressable>
        <Text style={s.title} numberOfLines={1}>New workout · {athleteName}</Text>
        <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
          <Text style={[s.save, saving && { opacity: 0.4 }]}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <View style={s.panes}>
        {/* Left: the workout */}
        <View style={s.card}>
          <View style={s.leftHeader}>
            <TextInput
              style={s.nameInput}
              placeholder="Workout name"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#888"
            />
            <Pressable style={s.dotsBtn} onPress={() => setMenuOpen((o) => !o)} hitSlop={8}>
              <Text style={s.dots}>⋮</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.blockList} keyboardShouldPersistTaps="handled">
            {blocks.length === 0 ? (
              <Text style={s.empty}>Add blocks from the right →</Text>
            ) : (
              blocks.map((b) => (
                <BlockEditorRow
                  key={b.id}
                  block={b}
                  isExpanded={expandedId === b.id}
                  isActive={false}
                  onToggleExpand={() => setExpandedId((p) => (p === b.id ? null : b.id))}
                  onDrag={() => {}}
                  onUpdate={updateBlock}
                  onDelete={() => deleteBlock(b.id)}
                />
              ))
            )}
          </ScrollView>

          {/* ⋮ menu */}
          {menuOpen && (
            <>
              <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)} />
              <View style={s.menu}>
                <Pressable
                  style={s.menuItem}
                  onPress={() => { setMenuOpen(false); setCopyOpen(true) }}
                >
                  <Text style={s.menuItemText}>Copy to another athlete</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        {/* Right: available blocks */}
        <View style={s.card}>
          <BlockPickerModal onAdd={addBlock} onClose={() => {}} embedded />
        </View>
      </View>

      {/* Copy-to-athlete picker */}
      <Modal visible={copyOpen} transparent animationType="fade" onRequestClose={() => setCopyOpen(false)}>
        <Pressable style={s.copyBackdrop} onPress={() => setCopyOpen(false)}>
          <Pressable style={s.copyCard} onPress={() => {}}>
            <Text style={s.copyTitle}>Copy workout to</Text>
            <Text style={s.copySub}>Each athlete gets their own copy.</Text>
            <View style={s.copyPills}>
              {otherAthletes.length === 0 ? (
                <Text style={s.empty}>No other athletes.</Text>
              ) : otherAthletes.map((a) => {
                const sel = copyTargets.has(a.$id)
                return (
                  <Pressable
                    key={a.$id}
                    style={[s.copyPill, sel && s.copyPillSel]}
                    onPress={() => setCopyTargets((prev) => {
                      const n = new Set(prev); n.has(a.$id) ? n.delete(a.$id) : n.add(a.$id); return n
                    })}
                  >
                    <Text style={[s.copyPillText, sel && s.copyPillTextSel]}>{a.username ?? a.$id}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Pressable
              style={[s.copyConfirm, (copyTargets.size === 0 || copying) && { opacity: 0.5 }]}
              onPress={copyToAthletes}
              disabled={copyTargets.size === 0 || copying}
            >
              {copying ? <ActivityIndicator color={C.bg} /> : (
                <Text style={s.copyConfirmText}>
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  cancel: { fontSize: 16, color: C.textSecondary },
  title: { fontSize: 16, fontWeight: "700", color: C.textPrimary, flex: 1, textAlign: "center", marginHorizontal: 12 },
  save: { fontSize: 16, color: C.green, fontWeight: "700" },

  panes: { flex: 1, flexDirection: "row", gap: 16, padding: 16 },
  card: { flex: 1, backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: "hidden" },

  leftHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8,
  },
  nameInput: {
    flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.textPrimary,
  },
  dotsBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: C.surfaceHigh,
    alignItems: "center", justifyContent: "center",
  },
  dots: { fontSize: 20, color: C.textSecondary, fontWeight: "800" },

  blockList: { padding: 14, gap: 10, paddingBottom: 40 },
  empty: { fontSize: 14, color: C.textMuted, textAlign: "center", marginTop: 24 },

  menuBackdrop: { ...StyleSheet.absoluteFillObject },
  menu: {
    position: "absolute", top: 56, right: 14,
    backgroundColor: C.surfaceHigh, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingVertical: 4, minWidth: 220,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 10, elevation: 8,
  },
  menuItem: { paddingHorizontal: 14, paddingVertical: 12 },
  menuItemText: { fontSize: 14, color: C.textPrimary, fontWeight: "600" },

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
