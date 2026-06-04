import { C } from "@/utils/theme"
import ImageCapture from "@/components/ImageCapture"
import {
  createProject,
  listProjects,
  ProjectLocation,
  ProjectRow,
  uploadPhoto,
} from "@/services/BoulderGraphService"
import * as ImagePicker from "expo-image-picker"
import WheelPicker from "@quidone/react-native-wheel-picker"
import { useEffect, useState } from "react"
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context"

// Boulder grades. `color` is the swatch shown in pickers/pills; `on` is the
// foreground color to use when a grade is the selected (filled) state.
export const BoulderLevelOptions = [
  { label: "Orange", value: "orange", color: "#E8833A", on: "#3A2300" },
  { label: "Blue", value: "blue", color: "#4F8EF7", on: "#fff" },
  { label: "Green", value: "green", color: "#3FB950", on: "#06210C" },
  { label: "Yellow", value: "yellow", color: "#E3B341", on: "#3A2E00" },
  { label: "Red", value: "red", color: "#E5484D", on: "#fff" },
  { label: "Black", value: "black", color: "#111111", on: "#fff" },
]

const LOCATIONS: { label: string; value: ProjectLocation }[] = [
  { label: "Slab", value: "slab" },
  { label: "Vertical 1", value: "vertical_wall_1" },
  { label: "Vertical 2", value: "vertical_wall_2" },
  { label: "Overhang", value: "overhang" },
]

async function pickFromLibrary(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) return null
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    allowsEditing: false,
    quality: 0.8,
  })
  if (result.canceled) return null
  return uploadPhoto(result.assets[0].uri)
}

interface Props {
  visible: boolean
  onClose: () => void
  onSelect: (project: ProjectRow) => void
  initialMode?: Mode
}

type Mode = "menu" | "choose" | "create"

export function ProjectPickerModal({ visible, onClose, onSelect, initialMode }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode ?? "menu")
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)

  const [name, setName] = useState("")
  const [grade, setGrade] = useState<string>(BoulderLevelOptions[3].value)
  const [weeks, setWeeks] = useState("4")
  const [location, setLocation] = useState<ProjectLocation>("slab")
  const [imageUri, setImageUri] = useState<string | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (visible) {
      setMode(initialMode ?? "menu")
      setName("")
      setGrade(BoulderLevelOptions[3].value)
      setWeeks("4")
      setLocation("slab")
      setImageUri(null)
      setShowCamera(false)
    }
  }, [visible])

  async function openChoose() {
    setMode("choose")
    setLoadingProjects(true)
    try {
      const data = await listProjects()
      setProjects(data.filter((p) => p.status === "active"))
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingProjects(false)
    }
  }

  function handlePickImage() {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Cancel", "Take photo", "Choose from library"], cancelButtonIndex: 0 },
        (index) => {
          if (index === 1) setShowCamera(true)
          if (index === 2) pickFromLibrary().then((uri) => { if (uri) setImageUri(uri) })
        }
      )
    } else {
      Alert.alert("Add photo", undefined, [
        { text: "Take photo", onPress: () => setShowCamera(true) },
        { text: "Choose from library", onPress: () => pickFromLibrary().then((uri) => { if (uri) setImageUri(uri) }) },
        { text: "Cancel", style: "cancel" },
      ])
    }
  }

  async function handleCreate() {
    if (!name.trim()) return
    const due = new Date()
    due.setDate(due.getDate() + (parseInt(weeks) || 4) * 7)
    setCreating(true)
    try {
      const project = await createProject({
        name: name.trim(),
        grade,
        dueDate: due.toISOString().slice(0, 10),
        location,
        ...(imageUri ? { imageUri } : {}),
      })
      onSelect(project)
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  const titleMap: Record<Mode, string> = {
    menu: "Project bouldering",
    choose: "Choose project",
    create: "New project",
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      {/* initialMetrics avoids the async safe-area measurement that briefly
          shifts the layout on iOS (which made the inputs untappable at first). */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ProjectPickerContent
          mode={mode}
          setMode={setMode}
          initialMode={initialMode ?? "menu"}
          onClose={onClose}
          titleMap={titleMap}
          loadingProjects={loadingProjects}
          projects={projects}
          openChoose={openChoose}
          onSelect={onSelect}
          showCamera={showCamera}
          setShowCamera={setShowCamera}
          imageUri={imageUri}
          setImageUri={setImageUri}
          handlePickImage={handlePickImage}
          name={name}
          setName={setName}
          grade={grade}
          setGrade={setGrade}
          weeks={weeks}
          setWeeks={setWeeks}
          location={location}
          setLocation={setLocation}
          creating={creating}
          handleCreate={handleCreate}
        />
      </SafeAreaProvider>
    </Modal>
  )
}

function ProjectPickerContent(props: any) {
  const {
    mode, setMode, initialMode, onClose, titleMap,
    loadingProjects, projects, openChoose, onSelect,
    showCamera, setShowCamera,
    imageUri, setImageUri, handlePickImage,
    name, setName, grade, setGrade, weeks, setWeeks, location, setLocation,
    creating, handleCreate,
  } = props
  const insets = useSafeAreaInsets()
  const atRoot = mode === initialMode
  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={s.header}>
          <Pressable onPress={atRoot ? onClose : () => setMode("menu")} hitSlop={8}>
            <Text style={s.back}>{atRoot ? "Cancel" : "‹ Back"}</Text>
          </Pressable>
          <Text style={s.title}>{titleMap[mode]}</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* ── Menu ─────────────────────────────────────────────────────────── */}
        {mode === "menu" && (
          <View style={s.menu}>
            <Pressable style={s.menuBtn} onPress={openChoose}>
              <Text style={s.menuBtnText}>Choose existing</Text>
            </Pressable>
            <Pressable style={[s.menuBtn, { backgroundColor: C.green }]} onPress={() => setMode("create")}>
              <Text style={[s.menuBtnText, { color: C.bg }]}>Create new project</Text>
            </Pressable>
          </View>
        )}

        {/* ── Choose ───────────────────────────────────────────────────────── */}
        {mode === "choose" && (
          loadingProjects ? (
            <ActivityIndicator style={{ marginTop: 40 }} />
          ) : projects.length === 0 ? (
            <Text style={s.empty}>No active projects. Create one first.</Text>
          ) : (
            <ScrollView contentContainerStyle={s.list}>
              {projects.map((p) => {
                const daysLeft = Math.ceil(
                  (new Date(p.dueDate).getTime() - Date.now()) / (1000 * 86400)
                )
                return (
                  <Pressable
                    key={p.$id}
                    style={({ pressed }) => [s.projectRow, pressed && { opacity: 0.6 }]}
                    onPress={() => { onSelect(p); onClose() }}
                  >
                    {p.imageUri ? (
                      <Image source={{ uri: p.imageUri }} style={s.projectThumb} />
                    ) : (
                      <View style={[s.projectThumb, s.projectThumbPlaceholder]} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.projectName}>{p.name}</Text>
                      <Text style={s.projectMeta}>
                        {p.grade} · {daysLeft > 0 ? `${daysLeft}d left` : "Due today"}
                      </Text>
                    </View>
                    <Text style={s.chevron}>›</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          )
        )}

        {/* ── Create ───────────────────────────────────────────────────────── */}
        {mode === "create" && (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
          >
          <ScrollView
            contentContainerStyle={s.form}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {/* Image picker */}
            <Pressable style={s.imagePicker} onPress={handlePickImage}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={s.imagePreview} />
              ) : (
                <View style={s.imagePlaceholder}>
                  <Text style={s.imagePlaceholderIcon}>🖼</Text>
                  <Text style={s.imagePlaceholderText}>Add photo</Text>
                </View>
              )}
              {imageUri && (
                <View style={s.imageOverlay}>
                  <Text style={s.imageOverlayText}>Change</Text>
                </View>
              )}
            </Pressable>

            <Text style={s.label}>Project name</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. The crimpy roof"
              placeholderTextColor={C.textMuted}
            />

            <Text style={s.label}>Grade</Text>
            <WheelPicker
              data={BoulderLevelOptions}
              value={grade}
              onValueChanged={({ item: { value } }: any) => setGrade(value)}
              itemHeight={30}
              itemTextStyle={{ color: C.textPrimary }}
              // @ts-ignore
              selectedItemTextStyle={{ color: C.textPrimary, fontWeight: "700" }}
            />

            <Text style={s.label}>Weeks to complete</Text>
            <TextInput
              style={s.input}
              value={weeks}
              onChangeText={setWeeks}
              keyboardType="number-pad"
              placeholderTextColor={C.textMuted}
            />

            <Text style={s.label}>Location</Text>
            <View style={s.locationRow}>
              {LOCATIONS.map((l) => (
                <Pressable
                  key={l.value}
                  style={[s.locationBtn, location === l.value && s.locationBtnActive]}
                  onPress={() => setLocation(l.value)}
                >
                  <Text style={[s.locationBtnText, location === l.value && s.locationBtnTextActive]}>
                    {l.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[s.createBtn, (!name.trim() || creating) && { opacity: 0.4 }]}
              onPress={handleCreate}
              disabled={!name.trim() || creating}
            >
              {creating ? (
                <ActivityIndicator color={C.bg} />
              ) : (
                <Text style={s.createBtnText}>Create project</Text>
              )}
            </Pressable>
          </ScrollView>
          </KeyboardAvoidingView>
        )}
        {/* ── Camera overlay ───────────────────────────────────────────── */}
        {showCamera && (
          <View style={StyleSheet.absoluteFillObject}>
            <ImageCapture
              onFinish={async (uri: string) => {
                try {
                  const cloudUri = await uploadPhoto(uri)
                  setImageUri(cloudUri)
                } catch {
                  setImageUri(uri) // fallback to local if upload fails
                }
                setShowCamera(false)
              }}
              onClose={() => setShowCamera(false)}
            />
          </View>
        )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  back: { fontSize: 16, color: C.green, fontWeight: "600" },
  title: { fontSize: 17, fontWeight: "700", color: C.textPrimary },

  // Menu
  menu: { padding: 24, gap: 14 },
  menuBtn: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  menuBtnText: { fontSize: 16, fontWeight: "600", color: C.textPrimary },

  // Choose
  list: { padding: 16, gap: 0 },
  empty: { textAlign: "center", marginTop: 60, fontSize: 15, color: C.textMuted },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  projectThumb: { width: 48, height: 48, borderRadius: 10 },
  projectThumbPlaceholder: { backgroundColor: C.surfaceHigh },
  projectName: { fontSize: 16, fontWeight: "600", color: C.textPrimary, marginBottom: 4 },
  projectMeta: { fontSize: 13, color: C.textSecondary },
  chevron: { fontSize: 22, color: C.textMuted },

  // Create form
  form: { padding: 20, gap: 4, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: C.textPrimary,
  },

  // Image picker
  imagePicker: {
    height: 160,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 4,
  },
  imagePreview: { width: "100%", height: "100%" },
  imagePlaceholder: {
    flex: 1,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  imagePlaceholderIcon: { fontSize: 32 },
  imagePlaceholderText: { fontSize: 14, color: C.textMuted, fontWeight: "600" },
  imageOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 8,
    alignItems: "center",
  },
  imageOverlayText: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // Location
  locationRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  locationBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  locationBtnActive: { backgroundColor: C.green, borderColor: C.green },
  locationBtnText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  locationBtnTextActive: { color: C.bg },

  // Create button
  createBtn: {
    marginTop: 28,
    backgroundColor: C.green,
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
  },
  createBtnText: { fontSize: 16, fontWeight: "700", color: C.bg },
})
