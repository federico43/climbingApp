import { C } from "@/utils/theme"
import { ConsumeAuth } from "@/components/auth-context"
import { ScalePressable } from "@/components/ScalePressable"
import { HeroIntro } from "@/components/HeroIntro"
import Animated, { FadeInDown } from "react-native-reanimated"
import { SessionDetailModal } from "@/components/SessionDetailModal"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import {
  deleteStorageFile,
  getAssignedProtocol,
  getSessions,
  listProjects,
  markProjectFailed,
  ProjectRow,
  SessionRow,
  updateProject,
  uploadPhoto,
} from "@/services/BoulderGraphService"
import { useFocusEffect } from "@react-navigation/native"
import { useRouter } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { LinearGradient } from "expo-linear-gradient"
import ImageCapture from "@/components/ImageCapture"
import * as ImagePicker from "expo-image-picker"
import { Image as CachedImage } from "expo-image"
import { VersionFooter } from "@/components/VersionFooter"
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { Calendar } from "react-native-calendars"
import { SafeAreaView } from "react-native-safe-area-context"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date, weekOffset = 0): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff + weekOffset * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10)
}

function sessionDateStr(session: SessionRow): string {
  try {
    const attempts = JSON.parse(session.attempts)
    if (attempts.length > 0 && attempts[0].timestamp) {
      return new Date(attempts[0].timestamp).toISOString().slice(0, 10)
    }
  } catch {}
  // fallback to Appwrite createdAt
  return session.$createdAt.slice(0, 10)
}

function countUniqueDaysInRange(sessions: SessionRow[], start: Date, end: Date): number {
  const s = toDateStr(start)
  const e = toDateStr(end)
  const days = new Set(
    sessions
      .filter((sess) => {
        const d = sessionDateStr(sess)
        return d >= s && d <= e
      })
      .map((sess) => sessionDateStr(sess))
  )
  return days.size
}

function countSessionsInMonth(sessions: SessionRow[], year: number, month: number): number {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`
  return sessions.filter((s) => sessionDateStr(s).startsWith(prefix)).length
}

function extractSCExercises(sessions: SessionRow[]): string[] {
  const names = new Set<string>()
  for (const session of sessions) {
    let attempts: any[] = []
    try { attempts = JSON.parse(session.attempts) } catch {}
    for (const a of attempts) {
      if (a.type !== "strength_conditioning") continue
      if (a.scData?.exerciseName) {
        names.add(a.scData.exerciseName)
      } else {
        const name = (a.notes ?? "").split(" · ")[0]
        if (name) names.add(name)
      }
    }
  }
  return Array.from(names).sort()
}

// ─── Screen ───────────────────────────────────────────────────────────────────

// Plays the hero intro only on the first Home mount of an app launch.
let heroPlayed = false

export default function HomeScreen() {
  const { User, userName } = ConsumeAuth()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [protocol, setProtocol] = useState<any[]>([])
  const [protocolName, setProtocolName] = useState("")
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [cameraProject, setCameraProject] = useState<ProjectRow | null>(null)
  const [uploadingImageFor, setUploadingImageFor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)


  // Workout state lives in the layout-level provider so the mini bar
  // shows across all tabs.
  const workoutCtx = useWorkoutContext()
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      load()
    }, [User])
  )

  // Reload after a workout ends (refreshKey bumps from the provider)
  useEffect(() => {
    if (User && workoutCtx.refreshKey > 0) load()
  }, [workoutCtx.refreshKey])

  async function load() {
    setLoading(true)
    try {
      const [sessData, protocolRow, projectsData] = await Promise.all([
        getSessions(),
        getAssignedProtocol(User!.$id).catch(() => null),
        listProjects().catch(() => [] as ProjectRow[]),
      ])
      setSessions(sessData)
      if (protocolRow) {
        setProtocol(JSON.parse(protocolRow.blocks))
        setProtocolName(protocolRow.name)
      } else {
        setProtocol([])
        setProtocolName("")
      }
      // Auto-fail projects past their deadline
      const todayStr = new Date().toISOString().slice(0, 10)
      const toFail = projectsData.filter((p) => p.status === "active" && p.dueDate < todayStr)
      for (const p of toFail) {
        markProjectFailed(p.$id).catch(console.error)
      }
      setProjects(
        projectsData.map((p) =>
          toFail.find((f) => f.$id === p.$id) ? { ...p, status: "failed" as const } : p
        )
      )
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // ── Calendar marks ────────────────────────────────────────────────────────────
  const trainedDays: Record<string, any> = {}
  for (const s of sessions) {
    const d = sessionDateStr(s)
    trainedDays[d] = {
      selected: true,
      selectedColor: C.green,
      selectedTextColor: C.bg,
    }
  }

  // ── Consistency stats ─────────────────────────────────────────────────────────
  const today = new Date()
  const sessionsThisMonth = countSessionsInMonth(sessions, today.getFullYear(), today.getMonth())
  const weekStart = getMondayOfWeek(today, 0)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6)
  const lastWeekStart = getMondayOfWeek(today, -1)
  const lastWeekEnd = new Date(lastWeekStart); lastWeekEnd.setDate(lastWeekEnd.getDate() + 6)
  const daysThisWeek = countUniqueDaysInRange(sessions, weekStart, weekEnd)
  const daysLastWeek = countUniqueDaysInRange(sessions, lastWeekStart, lastWeekEnd)

  // ── S/C exercises ─────────────────────────────────────────────────────────────
  const scExercises = extractSCExercises(sessions)

  async function saveProjectImage(project: ProjectRow, sourceUri: string) {
    setUploadingImageFor(project.$id)
    try {
      const cloudUri = await uploadPhoto(sourceUri)
      // delete previous cloud file if there was one
      if (project.imageUri) deleteStorageFile(project.imageUri).catch(() => {})
      await updateProject(project.$id, { imageUri: cloudUri })
      setProjects((prev) =>
        prev.map((p) => (p.$id === project.$id ? { ...p, imageUri: cloudUri } : p))
      )
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message ?? "Could not upload the image. Please try again.")
    } finally {
      setUploadingImageFor(null)
    }
  }

  async function pickProjectImageFromLibrary(project: ProjectRow) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    })
    if (result.canceled) return
    await saveProjectImage(project, result.assets[0].uri)
  }

  function handleChangeProjectImage(project: ProjectRow) {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Cancel", "Take photo", "Choose from library"], cancelButtonIndex: 0 },
        (index) => {
          if (index === 1) setCameraProject(project)
          if (index === 2) pickProjectImageFromLibrary(project)
        }
      )
    } else {
      Alert.alert("Add photo", undefined, [
        { text: "Take photo", onPress: () => setCameraProject(project) },
        { text: "Choose from library", onPress: () => pickProjectImageFromLibrary(project) },
        { text: "Cancel", style: "cancel" },
      ])
    }
  }

  // First-launch hero intro. Plays once per app launch (module flag survives tab
  // switches but resets on relaunch). When it finishes, the cards mount and
  // stagger in. The cards mount only after the intro so their entrance is
  // actually visible (it's hidden behind the hero otherwise).
  const [introDone, setIntroDone] = useState(heroPlayed)
  const cardEntering = (i: number) => FadeInDown.duration(420).delay(i * 110)
  // Athletes see the session by its day, not the protocol's name.
  const todayLabel = `${new Date().getDate()} ${new Date().toLocaleDateString(undefined, { month: "long" })}`

  return (
    <>
      <LinearGradient colors={["#1B2420", "#242325", "#242325"]} style={{ flex: 1 }}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.greeting}>Hi, {userName}</Text>
          <VersionFooter />
        </View>

        {!introDone || loading ? (
          loading && introDone ? <ActivityIndicator style={{ marginTop: 60 }} /> : null
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true)
                  try { await load() }
                  finally { setRefreshing(false) }
                }}
                tintColor={C.green}
                colors={[C.green]}
              />
            }
          >
            {/* ── ASSIGNED WORKOUT ──────────────────────────────────────────── */}
            <Animated.View style={styles.section} entering={cardEntering(0)}>
              <Text style={styles.sectionTitle}>Today's workout</Text>
              {protocol.length > 0 ? (
                <ScalePressable
                  style={styles.workoutCard}
                  onPress={() => workoutCtx.openWorkout(protocol, todayLabel)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.workoutCardTitle}>{todayLabel}</Text>
                    <Text style={styles.workoutCardSub}>
                      {protocol.length} block{protocol.length !== 1 ? "s" : ""} · Tap to start
                    </Text>
                  </View>
                  <Text style={styles.workoutCardArrow}>›</Text>
                </ScalePressable>
              ) : (
                <View style={styles.workoutCardEmpty}>
                  <Text style={styles.workoutCardEmptyText}>No protocol assigned yet</Text>
                </View>
              )}
            </Animated.View>

            {/* ── PROJECTS ─────────────────────────────────────────────────── */}
            <Animated.View style={styles.section} entering={cardEntering(1)}>
              <Pressable
                onPress={() => router.push("/past-projects")}
                hitSlop={8}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
              >
                <Text style={styles.sectionTitle}>My projects</Text>
                <Text style={{ color: C.textSecondary, fontSize: 13, fontWeight: "600" }}>All ›</Text>
              </Pressable>
              {projects
                  .filter((p) => p.status === "active")
                  .map((p) => {
                    const daysLeft = Math.ceil(
                      (new Date(p.dueDate).getTime() - Date.now()) / (1000 * 86400)
                    )
                    const locationLabel: Record<string, string> = {
                      slab: "Slab",
                      vertical_wall_1: "Vertical wall 1",
                      vertical_wall_2: "Vertical wall 2",
                      overhang: "Overhang",
                    }
                    const isUploading = uploadingImageFor === p.$id
                    return (
                      <Pressable
                        key={p.$id}
                        style={styles.projectCard}
                        onPress={() => router.push("/past-projects")}
                      >
                        {/* Image area */}
                        {isUploading ? (
                          <View style={[styles.projectCardHeroEmpty, { flexDirection: "row", gap: 10 }]}>
                            <ActivityIndicator color={C.green} />
                            <Text style={styles.projectCardAddText}>Uploading…</Text>
                          </View>
                        ) : p.imageUri ? (
                          <View style={styles.projectCardHero}>
                            <CachedImage source={{ uri: p.imageUri }} style={styles.projectCardHeroImage} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                            {/* Change / Remove buttons over the image */}
                            <View style={styles.projectCardImageActions}>
                              <Pressable
                                style={styles.projectCardImageBtn}
                                onPress={() => handleChangeProjectImage(p)}
                              >
                                <Text style={styles.projectCardImageBtnText}>Change</Text>
                              </Pressable>
                              <Pressable
                                style={[styles.projectCardImageBtn, { backgroundColor: "rgba(180,30,30,0.7)" }]}
                                onPress={() => {
                                  Alert.alert("Remove photo", "Remove this photo from the project?", [
                                    { text: "Cancel", style: "cancel" },
                                    {
                                      text: "Remove",
                                      style: "destructive",
                                      onPress: async () => {
                                        if (p.imageUri) {
                                          deleteStorageFile(p.imageUri).catch(() => {})
                                        }
                                        await updateProject(p.$id, { imageUri: "" })
                                        setProjects((prev) =>
                                          prev.map((x) => x.$id === p.$id ? { ...x, imageUri: undefined } : x)
                                        )
                                      },
                                    },
                                  ])
                                }}
                              >
                                <Text style={styles.projectCardImageBtnText}>Remove</Text>
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <Pressable
                            style={styles.projectCardHeroEmpty}
                            onPress={() => handleChangeProjectImage(p)}
                          >
                            <Text style={styles.projectCardAddText}>+ Add picture</Text>
                          </Pressable>
                        )}

                        {/* Info row */}
                        <View style={styles.projectCardInfo}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.projectCardName}>{p.name}</Text>
                            <Text style={styles.projectCardMeta}>
                              {p.grade} · {locationLabel[p.location] ?? p.location}
                            </Text>
                          </View>
                          <View style={styles.projectCardDaysBox}>
                            <Text style={styles.projectCardDays}>
                              {daysLeft > 0 ? daysLeft : 0}
                            </Text>
                            <Text style={styles.projectCardDaysLabel}>
                              {daysLeft === 1 ? "day left" : "days left"}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    )
                  })
              }
            </Animated.View>

            {/* ── MONTHLY CALENDAR ─────────────────────────────────────────── */}
            <Animated.View style={styles.section} entering={cardEntering(2)}>
              <Text style={styles.sectionTitle}>Training consistency</Text>
              <Calendar
                markedDates={trainedDays}
                maxDate={today.toISOString().slice(0, 10)}
                onDayPress={(day) => {
                  if (trainedDays[day.dateString]) setSelectedDate(day.dateString)
                }}
                theme={{
                  backgroundColor: C.surface,
                  calendarBackground: C.surface,
                  selectedDayBackgroundColor: C.green,
                  selectedDayTextColor: C.bg,
                  todayTextColor: C.green,
                  dayTextColor: C.textPrimary,
                  textDisabledColor: C.textMuted,
                  arrowColor: C.green,
                  monthTextColor: C.textPrimary,
                  textDayFontWeight: "500",
                  textMonthFontWeight: "700",
                  textDayHeaderFontWeight: "600",
                }}
                style={styles.calendar}
              />

              {/* ── CONSISTENCY STATS ─────────────────────────────────────── */}
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statNum}>{sessionsThisMonth}</Text>
                  <Text style={styles.statLabel}>sessions{"\n"}this month</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCard}>
                  <Text style={styles.statNum}>{daysThisWeek}</Text>
                  <Text style={styles.statLabel}>days trained{"\n"}this week</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCard}>
                  <Text style={styles.statNum}>{daysLastWeek}</Text>
                  <Text style={styles.statLabel}>days trained{"\n"}last week</Text>
                </View>
              </View>
            </Animated.View>

            {/* ── S/C PROGRESS ──────────────────────────────────────────────── */}
            {scExercises.length > 0 && (
              <Animated.View style={styles.section} entering={cardEntering(3)}>
                <Text style={styles.sectionTitle}>Strength & conditioning</Text>
                <Text style={styles.sectionSub}>Tap an exercise to see your progress</Text>
                <View style={styles.exerciseList}>
                  {scExercises.map((name, i) => (
                    <Pressable
                      key={name}
                      style={({ pressed }) => [
                        styles.exerciseRow,
                        i === scExercises.length - 1 && { borderBottomWidth: 0 },
                        pressed && { opacity: 0.5 },
                      ]}
                      onPress={() =>
                        router.push({
                          pathname: "/(tabs)/(buttonTabs)/exerciseProgress",
                          params: { name },
                        })
                      }
                    >
                      <Text style={styles.exerciseName}>{name}</Text>
                      <Text style={styles.exerciseChevron}>›</Text>
                    </Pressable>
                  ))}
                </View>
              </Animated.View>
            )}

            <View style={{ height: 32 }} />
          </ScrollView>
        )}
        </View>
      </SafeAreaView>
      </LinearGradient>

      {!introDone && (
        <HeroIntro
          name={userName ?? ""}
          onDone={() => { heroPlayed = true; setIntroDone(true) }}
        />
      )}

      {/* ── SESSION DETAIL MODAL ────────────────────────────────────────────── */}
      <SessionDetailModal
        date={selectedDate}
        sessions={sessions}
        onClose={() => setSelectedDate(null)}
        onDeleted={(id) => {
          setSessions((prev) => prev.filter((s) => s.$id !== id))
        }}
        onUpdated={(updated) => {
          setSessions((prev) => prev.map((s) => (s.$id === updated.$id ? updated : s)))
        }}
      />


      {/* ── PROJECT CAMERA ──────────────────────────────────────────────────── */}
      <Modal
        visible={cameraProject !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCameraProject(null)}
      >
        {cameraProject && (
          <ImageCapture
            onFinish={async (uri) => {
              await saveProjectImage(cameraProject, uri)
              setCameraProject(null)
            }}
            onClose={() => setCameraProject(null)}
          />
        )}
      </Modal>

    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  greeting: {
    fontSize: 22,
    fontWeight: "700",
    color: C.textPrimary,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 20,
  },
  section: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: C.textPrimary,
  },
  sectionSub: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: -8,
  },

  // Workout card
  workoutCard: {
    backgroundColor: C.green,
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  workoutCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: C.bg,
    marginBottom: 4,
  },
  workoutCardSub: {
    fontSize: 13,
    color: "rgba(36,35,37,0.55)",
  },
  workoutCardArrow: {
    fontSize: 26,
    color: "rgba(36,35,37,0.35)",
    marginLeft: 12,
  },
  workoutCardEmpty: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  workoutCardEmptyText: {
    fontSize: 14,
    color: C.textMuted,
  },

  // Calendar
  calendar: {
    borderRadius: 12,
    overflow: "hidden",
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    paddingVertical: 14,
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: C.border,
  },
  statNum: {
    fontSize: 26,
    fontWeight: "800",
    color: C.green,
  },
  statLabel: {
    fontSize: 11,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 15,
  },

  // Exercise list
  exerciseList: {
    gap: 0,
  },
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: "500",
    color: C.textPrimary,
  },
  exerciseChevron: {
    fontSize: 20,
    color: C.textMuted,
  },

  // Project cards
  projectCard: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 18,
    overflow: "hidden",
  },
  projectCardHero: {
    width: "100%",
    aspectRatio: 1,
  },
  projectCardHeroImage: {
    width: "100%",
    height: "100%",
  },
  projectCardImageActions: {
    position: "absolute",
    bottom: 10,
    right: 10,
    flexDirection: "row",
    gap: 8,
  },
  projectCardImageBtn: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  projectCardImageBtnText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  projectCardHeroEmpty: {
    width: "100%",
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  projectCardAddText: {
    fontSize: 14,
    fontWeight: "600",
    color: C.green,
  },
  projectCardInfo: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  projectCardName: { fontSize: 15, fontWeight: "700", color: C.textPrimary, marginBottom: 3 },
  projectCardMeta: { fontSize: 12, color: C.textSecondary },
  projectCardDaysBox: { alignItems: "center", minWidth: 52 },
  projectCardDays: { fontSize: 22, fontWeight: "800", color: C.green },
  projectCardDaysLabel: { fontSize: 10, color: C.textSecondary, textAlign: "center" },

})
