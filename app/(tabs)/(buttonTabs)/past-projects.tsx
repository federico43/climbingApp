import { C } from "@/utils/theme"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import { ProjectPickerModal } from "@/components/ProjectPickerModal"
import DateTimePicker from "@react-native-community/datetimepicker"
import {
  deleteProject,
  deleteStorageFile,
  getSessions,
  getSprayRoute,
  getSprayWall,
  listProjects,
  ProjectRow,
  SessionRow,
  updateProject,
} from "@/services/BoulderGraphService"
import { useRouter } from "expo-router"
import { Image as CachedImage } from "expo-image"
import React, { useCallback, useEffect, useMemo, useState } from "react"
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
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "boulders" | "sequences"

interface SequenceAttempt {
  sessionId: string
  sessionDate: string
  attemptIndex: number          // index in the session's attempts array
  success: boolean
  highPoint?: number
  rpe?: number
  video?: string
  notes?: string
}

interface SequenceRoute {
  key: string                   // routeName + routeHolds hash
  routeName: string
  routeHolds: string
  routeId?: string              // Appwrite row ID — present for routes saved after wall feature
  attempts: SequenceAttempt[]
  lastDate: string              // ISO date
  sendCount: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function sessionDateStr(s: SessionRow): string {
  try {
    const attempts = JSON.parse(s.attempts)
    if (attempts[0]?.timestamp) return new Date(attempts[0].timestamp).toISOString()
  } catch {}
  return s.$createdAt
}

function extractSequenceRoutes(sessions: SessionRow[]): SequenceRoute[] {
  const map = new Map<string, SequenceRoute>()
  for (const session of sessions) {
    let protocol: any[] = []
    let attempts: any[] = []
    try { protocol = JSON.parse(session.protocol) } catch {}
    try { attempts = JSON.parse(session.attempts) } catch {}

    const sessDate = sessionDateStr(session)

    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i]
      if (a.type !== "sequence") continue
      const block = protocol[a.blockIndex]
      if (!block || block.type !== "sequence") continue
      const routeName = block.routeName || block.blockName || "Unnamed sequence"
      const routeHolds = block.routeHolds || "[]"
      const key = `${routeName}::${routeHolds}`
      if (!map.has(key)) {
        map.set(key, {
          key,
          routeName,
          routeHolds,
          routeId: block.routeId || undefined,
          attempts: [],
          lastDate: sessDate,
          sendCount: 0,
        })
      }
      const entry = map.get(key)!
      entry.attempts.push({
        sessionId: session.$id,
        sessionDate: sessDate,
        attemptIndex: i,
        success: !!a.success,
        highPoint: a.highPoint,
        rpe: a.rpe,
        video: a.video,
        notes: a.notes,
      })
      if (a.success) entry.sendCount += 1
      if (sessDate > entry.lastDate) entry.lastDate = sessDate
    }
  }
  // Sort routes by most recently attempted
  return Array.from(map.values()).sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1))
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PastProjects() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("boulders")
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [sequences, setSequences] = useState<SequenceRoute[]>([])
  const [editingProject, setEditingProject] = useState<ProjectRow | null>(null)
  const [viewingRoute, setViewingRoute] = useState<SequenceRoute | null>(null)
  const [addingProject, setAddingProject] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [projData, sessData] = await Promise.all([
        listProjects().catch(() => [] as ProjectRow[]),
        getSessions().catch(() => [] as SessionRow[]),
      ])
      // Active first, then most recent
      const order: Record<string, number> = { active: 0, sent: 1, failed: 2 }
      const sorted = [...projData].sort((a, b) => {
        const so = (order[a.status] ?? 99) - (order[b.status] ?? 99)
        if (so !== 0) return so
        return a.$createdAt < b.$createdAt ? 1 : -1
      })
      setProjects(sorted)
      setSequences(extractSequenceRoutes(sessData))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Projects</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, tab === "boulders" && styles.tabActive]}
          onPress={() => setTab("boulders")}
        >
          <Text style={[styles.tabText, tab === "boulders" && styles.tabTextActive]}>
            Boulders
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "sequences" && styles.tabActive]}
          onPress={() => setTab("sequences")}
        >
          <Text style={[styles.tabText, tab === "sequences" && styles.tabTextActive]}>
            Sequences
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
      ) : tab === "boulders" ? (
        <BouldersTab
          projects={projects}
          onTap={(p) => setEditingProject(p)}
        />
      ) : (
        <SequencesTab
          routes={sequences}
          onTap={(r) => setViewingRoute(r)}
        />
      )}

      {/* Edit project modal */}
      <ProjectEditModal
        project={editingProject}
        onClose={() => setEditingProject(null)}
        onSaved={(updated) => {
          setProjects((prev) => prev.map((p) => (p.$id === updated.$id ? updated : p)))
          setEditingProject(null)
        }}
        onDeleted={(id) => {
          setProjects((prev) => prev.filter((p) => p.$id !== id))
          setEditingProject(null)
        }}
      />

      {/* Sequence route detail modal */}
      <SequenceRouteModal
        route={viewingRoute}
        onClose={() => setViewingRoute(null)}
      />

      {/* Add project FAB */}
      <Pressable style={styles.fab} onPress={() => setAddingProject(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <ProjectPickerModal
        visible={addingProject}
        initialMode="create"
        onClose={() => setAddingProject(false)}
        onSelect={(project) => {
          setProjects((prev) => {
            const without = prev.filter((p) => p.$id !== project.$id)
            return [project, ...without]
          })
          setAddingProject(false)
        }}
      />
    </SafeAreaView>
  )
}

// ─── Boulders tab ─────────────────────────────────────────────────────────────

function BouldersTab({
  projects,
  onTap,
}: {
  projects: ProjectRow[]
  onTap: (p: ProjectRow) => void
}) {
  if (projects.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No boulders yet.</Text>
      </View>
    )
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {projects.map((p) => (
        <Pressable key={p.$id} style={styles.card} onPress={() => onTap(p)}>
          {p.imageUri ? (
            <CachedImage source={{ uri: p.imageUri }} style={styles.cardImage} contentFit="cover" cachePolicy="memory-disk" transition={150} />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
              <Text style={styles.cardImagePlaceholderText}>{p.grade}</Text>
            </View>
          )}
          <View style={styles.cardBody}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>{p.name}</Text>
              <Text style={styles.cardMeta}>
                {p.grade} · {formatDate(p.$createdAt)}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor:
                    p.status === "sent"   ? C.green :
                    p.status === "failed" ? C.red   :
                    C.surfaceHigh,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  p.status === "active" && { color: C.textPrimary },
                ]}
              >
                {p.status === "sent" ? "Sent" : p.status === "failed" ? "Failed" : "Active"}
              </Text>
            </View>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  )
}

// ─── Sequences tab ────────────────────────────────────────────────────────────

function SequencesTab({
  routes,
  onTap,
}: {
  routes: SequenceRoute[]
  onTap: (r: SequenceRoute) => void
}) {
  if (routes.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No sequences trained yet.</Text>
      </View>
    )
  }
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {routes.map((r) => (
        <Pressable key={r.key} style={styles.seqCard} onPress={() => onTap(r)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardName}>{r.routeName}</Text>
            <Text style={styles.cardMeta}>
              {r.attempts.length} attempt{r.attempts.length !== 1 ? "s" : ""}
              {r.sendCount > 0 ? `  ·  ${r.sendCount} sent` : ""}
              {"  ·  last "}{formatDate(r.lastDate)}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

// ─── Project edit modal ───────────────────────────────────────────────────────

function ProjectEditModal({
  project,
  onClose,
  onSaved,
  onDeleted,
}: {
  project: ProjectRow | null
  onClose: () => void
  onSaved: (p: ProjectRow) => void
  onDeleted: (id: string) => void
}) {
  const [name, setName] = useState("")
  const [grade, setGrade] = useState("")
  const [status, setStatus] = useState<"active" | "sent" | "failed">("sent")
  const [dueDate, setDueDate] = useState<string>("")
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (project) {
      setName(project.name)
      setGrade(project.grade)
      setStatus(project.status)
      setDueDate(project.dueDate)
      setShowDatePicker(false)
    }
  }, [project])

  if (!project) return null

  async function save() {
    if (!project) return
    setSaving(true)
    try {
      const data: any = { name, grade, status }
      if (status === "active") data.dueDate = dueDate
      await updateProject(project.$id, data)
      onSaved({ ...project, name, grade, status, dueDate })
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save")
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    if (!project) return
    Alert.alert("Delete project", "Remove this project permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            if (project.imageUri) {
              await deleteStorageFile(project.imageUri)
            }
            await deleteProject(project.$id)
            onDeleted(project.$id)
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Could not delete")
          }
        },
      },
    ])
  }

  return (
    <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn} hitSlop={12}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Edit boulder</Text>
          <Pressable onPress={save} disabled={saving} hitSlop={12} style={{ width: 60 }}>
            <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>
              {saving ? "…" : "Save"}
            </Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
          <Field label="Name">
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={C.textMuted} />
          </Field>
          <Field label="Grade">
            <TextInput style={styles.input} value={grade} onChangeText={setGrade} placeholderTextColor={C.textMuted} />
          </Field>
          <Field label="Status">
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["sent", "failed", "active"] as const).map((s) => (
                <Pressable
                  key={s}
                  style={[styles.statusChip, status === s && styles.statusChipActive]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={[styles.statusChipText, status === s && styles.statusChipTextActive]}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Field>

          {status === "active" && (
            <Field label="Due date">
              <Pressable
                style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={{ color: C.textPrimary, fontSize: 15 }}>
                  {dueDate ? formatDate(dueDate + "T12:00:00") : "Pick a date"}
                </Text>
                <Text style={{ color: C.textSecondary }}>📅</Text>
              </Pressable>
              {showDatePicker && (
                <DateTimePicker
                  value={dueDate ? new Date(dueDate + "T12:00:00") : new Date()}
                  mode="date"
                  display="default"
                  onChange={(_, selected) => {
                    setShowDatePicker(false)
                    if (selected) {
                      setDueDate(selected.toISOString().slice(0, 10))
                    }
                  }}
                />
              )}
            </Field>
          )}

          <Pressable style={styles.deleteBtn} onPress={handleDelete}>
            <Text style={styles.deleteBtnText}>Delete project</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

// ─── Sequence route detail modal ──────────────────────────────────────────────

function SequenceRouteModal({
  route,
  onClose,
}: {
  route: SequenceRoute | null
  onClose: () => void
}) {
  const holds = useMemo(() => {
    if (!route) return []
    try { return JSON.parse(route.routeHolds) } catch { return [] }
  }, [route])

  if (!route) return null

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SequenceRouteContent route={route} holds={holds} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  )
}

function SequenceRouteContent({
  route, holds, onClose,
}: {
  route: SequenceRoute; holds: any[]; onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const [wallImageSource, setWallImageSource] = useState<any>(WALL_IMAGE)
  const [wallSize, setWallSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    if (!route.routeId) return
    let cancelled = false
    getSprayRoute(route.routeId)
      .then(async (row) => {
        if (cancelled || !row.wallId) return
        const wall = await getSprayWall(row.wallId)
        if (cancelled) return
        if (wall?.imageUri) setWallImageSource({ uri: wall.imageUri })
        if (wall?.width && wall?.height) setWallSize({ w: wall.width, h: wall.height })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [route.routeId])

  return (
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.backBtn} hitSlop={12}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{route.routeName}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Wall — primary focus */}
        <View style={styles.wallContainer}>
          <SprayWallViewer
            imageSource={wallImageSource}
            holds={holds}
            style={{ flex: 1 }}
            freeGesture
            naturalSize={wallSize}
          />
        </View>

        {/* Attempt summary + scrollable list below */}
        <View style={styles.attemptsPanel}>
          <Text style={styles.summaryText}>
            {route.attempts.length} attempt{route.attempts.length !== 1 ? "s" : ""}
            {route.sendCount > 0 ? ` · ${route.sendCount} sent` : ""}
          </Text>
          <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 20 }}>
            {route.attempts
              .slice()
              .sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1))
              .map((a) => (
                <View key={`${a.sessionId}-${a.attemptIndex}`} style={styles.attemptRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attemptOutcome}>
                      <Text style={{ color: a.success ? C.green : C.red, fontWeight: "700" }}>
                        {a.success ? "Sent" : "Fell"}
                      </Text>
                      {!a.success && a.highPoint != null && `  · move ${a.highPoint}`}
                      {a.rpe != null && `  · RPE ${a.rpe}`}
                    </Text>
                    <Text style={styles.attemptMeta}>{formatDate(a.sessionDate)}</Text>
                  </View>
                  {a.video && <Text style={{ color: C.textSecondary }}>📹</Text>}
                </View>
              ))}
          </ScrollView>
        </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 40 },
  backArrow: { fontSize: 34, color: C.textSecondary, lineHeight: 36 },
  title: { flex: 1, fontSize: 18, fontWeight: "700", color: C.textPrimary, textAlign: "center" },
  saveText: { fontSize: 15, fontWeight: "700", color: C.green, textAlign: "right" },

  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 16, paddingTop: 12, gap: 8,
  },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 22,
    backgroundColor: C.surface, alignItems: "center",
    borderWidth: 1, borderColor: C.border,
  },
  tabActive: { backgroundColor: C.surfaceHigh, borderColor: C.surfaceHigh },
  tabText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  tabTextActive: { color: C.textPrimary },

  scroll: { padding: 16, gap: 12 },

  card: {
    backgroundColor: C.surface, borderRadius: 14, overflow: "hidden",
    marginBottom: 10,
  },
  cardImage: { width: "100%", height: 140 },
  cardImagePlaceholder: {
    backgroundColor: C.surfaceHigh, alignItems: "center", justifyContent: "center",
  },
  cardImagePlaceholderText: {
    fontSize: 30, fontWeight: "700", color: C.textSecondary,
  },
  cardBody: {
    flexDirection: "row", alignItems: "center",
    padding: 14, gap: 12,
  },
  cardName: { fontSize: 16, fontWeight: "700", color: C.textPrimary },
  cardMeta: { fontSize: 13, color: C.textSecondary, marginTop: 2 },
  statusPill: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
  },
  statusPillText: { fontSize: 12, fontWeight: "700", color: C.bg },

  seqCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 10,
  },
  chevron: { fontSize: 24, color: C.textMuted, marginLeft: 12 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyText: { fontSize: 14, color: C.textMuted },

  fieldLabel: {
    fontSize: 12, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6,
  },
  input: {
    backgroundColor: C.surface, borderRadius: 10,
    padding: 12, fontSize: 15, color: C.textPrimary,
    borderWidth: 1, borderColor: C.border,
  },
  statusChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  statusChipActive: { backgroundColor: C.green, borderColor: C.green },
  statusChipText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  statusChipTextActive: { color: C.bg },

  deleteBtn: {
    marginTop: 24, paddingVertical: 14, borderRadius: 14,
    alignItems: "center", borderWidth: 1, borderColor: C.red,
  },
  deleteBtnText: { color: C.red, fontSize: 15, fontWeight: "700" },

  wallContainer: {
    flex: 1, backgroundColor: C.bg,
  },
  attemptsPanel: {
    maxHeight: 240,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: C.bg,
  },
  summaryText: {
    fontSize: 13, color: C.textSecondary, marginBottom: 8,
  },
  attemptRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 10, padding: 12,
  },
  attemptOutcome: { fontSize: 15, color: C.textPrimary },
  attemptMeta: { fontSize: 12, color: C.textMuted, marginTop: 2 },

  fab: {
    position: "absolute", bottom: 36, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.green,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  fabText: { fontSize: 28, color: C.bg, lineHeight: 32 },
})
