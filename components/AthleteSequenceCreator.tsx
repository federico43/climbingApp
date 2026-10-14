import { C } from "@/utils/theme"
import { SprayWallBuilder } from "@/components/SprayWallBuilder"
import {
  getSprayWall,
  getSprayWalls,
  saveSprayRoute,
  updateSprayRoute,
  SprayRouteRow,
  SprayWallRow,
} from "@/services/BoulderGraphService"
import { parseVariations, RouteVariations } from "@/utils/sequenceVariations"
import { Ionicons } from "@expo/vector-icons"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

const FALLBACK_IMAGE = require("@/assets/images/spraywall.jpg")

type Step = "loading" | "wall-picker" | "builder"

interface Props {
  visible: boolean
  athleteId: string
  // When set, edits this existing sequence instead of creating a new one —
  // reuses the same builder, prefilled, on its original wall.
  editing?: SprayRouteRow | null
  onClose: () => void
  onSaved: (route: SprayRouteRow) => void
}

// Lets an athlete build their own route on an existing spray wall. This is
// the same builder the coach uses when authoring a "sequence" workout block
// (see SequenceFields in workoutBlocks.tsx), reused here as a standalone
// entry point with no wall-management UI of its own — walls stay coach-owned,
// athletes just pick one and place holds.
export function CreateSequenceModal({ visible, athleteId, editing = null, onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>("loading")
  const [walls, setWalls] = useState<SprayWallRow[]>([])
  const [wall, setWall] = useState<SprayWallRow | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setStep("loading")
    setWall(null)

    if (editing) {
      if (!editing.wallId) { setStep("builder"); return }
      getSprayWall(editing.wallId)
        .then((w) => { if (!cancelled) { setWall(w); setStep("builder") } })
        .catch(() => { if (!cancelled) setStep("builder") })
      return () => { cancelled = true }
    }

    getSprayWalls()
      .then((rows) => {
        if (cancelled) return
        setWalls(rows)
        if (rows.length === 0) {
          Alert.alert(
            "No walls yet",
            "Ask your coach to add a spray wall photo before you build a sequence.",
            [{ text: "OK", onPress: onClose }],
          )
        } else if (rows.length === 1) {
          setWall(rows[0])
          setStep("builder")
        } else {
          setStep("wall-picker")
        }
      })
      .catch(() => {
        if (cancelled) return
        Alert.alert("Error", "Could not load spray walls.", [{ text: "OK", onPress: onClose }])
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the modal opens or the edited route changes; onClose is often an inline arrow
  }, [visible, editing])

  async function handleSave(name: string, data: { variations: RouteVariations; level: number; type: string }) {
    if (!name.trim()) { Alert.alert("Name required", "Give the sequence a name before saving."); return }
    setSaving(true)
    try {
      const holds = data.variations.original ?? []
      const extras = { level: data.level, type: data.type, variations: data.variations }
      const route = editing
        ? await updateSprayRoute(editing.$id, name.trim(), holds, extras)
        : await saveSprayRoute(name.trim(), holds, wall?.$id, { ...extras, athleteId })
      onSaved(route)
      onClose()
    } catch (e) {
      console.error(e)
      Alert.alert("Error", "Could not save the sequence. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {step === "loading" && (
        <SafeAreaView style={styles.centerSafe}>
          <ActivityIndicator color={C.green} />
        </SafeAreaView>
      )}

      {step === "wall-picker" && (
        <SafeAreaView style={styles.pickerSafe} edges={["top"]}>
          <View style={styles.pickerHeader}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={C.textSecondary} />
            </Pressable>
            <Text style={styles.pickerTitle}>Which wall?</Text>
            <View style={{ width: 22 }} />
          </View>
          <Text style={styles.pickerSub}>A sequence lives on a wall — pick one.</Text>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {walls.map((w) => (
              <Pressable key={w.$id} style={styles.pickerRow} onPress={() => { setWall(w); setStep("builder") }}>
                <Text style={styles.pickerRowText} numberOfLines={1}>{w.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      )}

      {step === "builder" && (
        <SafeAreaView style={styles.builderSafe} edges={["top"]}>
          <SprayWallBuilder
            imageSource={wall?.imageUri ? { uri: wall.imageUri } : FALLBACK_IMAGE}
            initialName={editing?.name ?? ""}
            initialVariations={editing ? parseVariations(editing) : undefined}
            initialLevel={editing?.level}
            initialType={editing?.type}
            onBack={onClose}
            onSave={handleSave}
            saving={saving}
          />
        </SafeAreaView>
      )}
    </Modal>
  )
}

const styles = StyleSheet.create({
  centerSafe: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
  builderSafe: { flex: 1, backgroundColor: C.bg },
  pickerSafe: { flex: 1, backgroundColor: C.bg, padding: 20 },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  pickerTitle: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  pickerSub: { fontSize: 13, color: C.textSecondary, marginTop: 6, marginBottom: 16 },
  pickerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  pickerRowText: { fontSize: 15, fontWeight: "600", color: C.textPrimary, flex: 1 },
})
