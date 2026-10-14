import { C } from "@/utils/theme"
import { BLOCK_ICONS, BLOCK_LABELS, BlockType } from "@/components/workoutBlocks"
import { Ionicons } from "@expo/vector-icons"
import * as VideoThumbnails from "expo-video-thumbnails"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Only the block types that actually record video live elsewhere in the app
// (VideoRecorder is wired up for these three — see ConstraintWarmupBlock /
// ProjectBlock in blockRenderer.tsx and SequenceBlock.tsx). The other block
// types (strength_conditioning, exploration_session, free_session,
// four_by_four, intervals) never produce a recorded clip today, so offering
// them here would be a dead end that doesn't match anything an athlete has
// seen elsewhere in the Library.
const TYPE_OPTIONS: BlockType[] = [
  "project_bouldering",
  "constraint_warmup",
  "sequence",
]

interface Props {
  visible: boolean
  videoUri: string | null
  onClose: () => void
  onImport: (blockType: BlockType, notifyCoach: boolean) => Promise<void>
}

export function ImportVideoModal({ visible, videoUri, onClose, onImport }: Props) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<BlockType | null>(null)
  const [notifyCoach, setNotifyCoach] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    // Reset for every new pick so a previous clip's choices don't leak in.
    setSelectedType(null)
    setNotifyCoach(true)
    setThumbnail(null)
    if (!videoUri) return
    let cancelled = false
    VideoThumbnails.getThumbnailAsync(videoUri, { time: 500, quality: 0.5 })
      .then((r) => { if (!cancelled) setThumbnail(r.uri) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [visible, videoUri])

  async function handleConfirm() {
    if (!selectedType || saving) return
    setSaving(true)
    try {
      await onImport(selectedType, notifyCoach)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.iconBtn} hitSlop={10} disabled={saving}>
            <Ionicons name="close" size={20} color={C.textSecondary} />
          </Pressable>
          <Text style={styles.title}>Add video</Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.preview}>
            {thumbnail ? (
              <Image source={{ uri: thumbnail }} style={styles.previewImage} />
            ) : (
              <ActivityIndicator color={C.green} />
            )}
          </View>

          <Text style={styles.prompt}>What kind of video is this?</Text>
          <View style={styles.grid}>
            {TYPE_OPTIONS.map((type) => {
              const selected = selectedType === type
              return (
                <Pressable
                  key={type}
                  style={[styles.card, selected && styles.cardSelected]}
                  onPress={() => setSelectedType(type)}
                >
                  <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
                    <Ionicons name={BLOCK_ICONS[type]} size={18} color={selected ? C.bg : C.green} />
                  </View>
                  <Text style={[styles.cardLabel, selected && styles.cardLabelSelected]} numberOfLines={2}>
                    {BLOCK_LABELS[type]}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Send to coach</Text>
              <Text style={styles.switchHint}>Submit this clip for feedback, like a recorded attempt.</Text>
            </View>
            <Switch value={notifyCoach} onValueChange={setNotifyCoach} />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.confirmBtn, (!selectedType || saving) && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={!selectedType || saving}
          >
            {saving
              ? <ActivityIndicator color={C.bg} />
              : <Text style={styles.confirmBtnText}>Add to library</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "600", color: C.textPrimary },

  content: { padding: 20, paddingBottom: 40, gap: 8 },

  preview: {
    width: "100%", height: 200, borderRadius: 16, overflow: "hidden",
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  previewImage: { width: "100%", height: "100%" },

  prompt: {
    fontSize: 13, fontWeight: "600", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    width: "31%", flexGrow: 1,
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border,
    padding: 12, gap: 8, alignItems: "flex-start", minHeight: 92,
  },
  cardSelected: { backgroundColor: C.green, borderColor: C.green },
  iconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  iconWrapSelected: { backgroundColor: "rgba(0,0,0,0.15)" },
  cardLabel: { fontSize: 12, fontWeight: "700", color: C.textPrimary },
  cardLabelSelected: { color: C.bg },

  switchRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginTop: 16, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  switchLabel: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  switchHint: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  footer: { padding: 20, borderTopWidth: 1, borderTopColor: C.border },
  confirmBtn: {
    backgroundColor: C.green, borderRadius: 14, paddingVertical: 15,
    alignItems: "center", justifyContent: "center",
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { fontSize: 15, fontWeight: "700", color: C.bg },
})
