import { C } from "@/utils/theme"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import { applyRouteFilters, EMPTY_ROUTE_FILTERS, RouteFilterBar, RouteFilters } from "@/components/RouteFilterBar"
import {
  createSprayWall,
  deleteSprayRoute,
  deleteSprayWall,
  deleteStorageFile,
  getSprayRoutes,
  getSprayWalls,
  saveSprayRoute,
  SprayRouteRow,
  SprayWallRow,
  uploadPhoto,
} from "@/services/BoulderGraphService"
import { groupByDate } from "@/utils/dateGroups"
import { ROUTE_TYPE_LABEL } from "@/utils/sequenceVariations"
import { Ionicons } from "@expo/vector-icons"
import * as ImagePicker from "expo-image-picker"
import { useFocusEffect } from "@react-navigation/native"
import { useRouter } from "expo-router"
import { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

const FALLBACK_IMAGE = require("@/assets/images/spraywall.jpg")

export default function SprayWallScreen() {
  const router = useRouter()
  const [walls, setWalls] = useState<SprayWallRow[]>([])
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null) // null = All
  const [routes, setRoutes] = useState<SprayRouteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [addingWall, setAddingWall] = useState(false)
  // Wall name prompt state
  const [nameModalVisible, setNameModalVisible] = useState(false)
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null)
  const [pendingImageSize, setPendingImageSize] = useState<{ w: number; h: number } | null>(null)
  const [wallNameInput, setWallNameInput] = useState("")
  // Wall chooser for new routes when on the "All" filter with multiple walls.
  const [wallPickerVisible, setWallPickerVisible] = useState(false)
  const [filters, setFilters] = useState<RouteFilters>(EMPTY_ROUTE_FILTERS)

  // Walls change rarely and only from this screen — refetch when the screen
  // regains focus, NOT on every wall-filter tap.
  const loadWalls = useCallback(async () => {
    try {
      setWalls(await getSprayWalls())
    } catch (e) {
      console.error(e)
    }
  }, [])

  // Routes refetch on focus and whenever the filter changes. We never flip
  // `loading` back on here, so switching filters swaps the grid in place
  // instead of flashing a full-screen spinner.
  const loadRoutes = useCallback(async () => {
    try {
      setRoutes(await getSprayRoutes(selectedWallId ?? undefined))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [selectedWallId])

  useFocusEffect(useCallback(() => { loadWalls() }, [loadWalls]))
  useFocusEffect(useCallback(() => { loadRoutes() }, [loadRoutes]))

  // ─── Wall actions ──────────────────────────────────────────────────────────

  async function handleAddWall() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to add a wall photo.")
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    setPendingImageUri(asset.uri)
    setPendingImageSize(asset.width && asset.height ? { w: asset.width, h: asset.height } : null)
    setWallNameInput("")
    setNameModalVisible(true)
  }

  async function confirmWallName() {
    if (!wallNameInput.trim() || !pendingImageUri) return
    setNameModalVisible(false)
    setAddingWall(true)
    try {
      const cloudUri = await uploadPhoto(pendingImageUri)
      const wall = await createSprayWall(wallNameInput.trim(), cloudUri, pendingImageSize?.w, pendingImageSize?.h)
      setWalls((prev) => [...prev, wall])
      setSelectedWallId(wall.$id)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save wall.")
    } finally {
      setAddingWall(false)
      setPendingImageUri(null)
      setPendingImageSize(null)
    }
  }

  function handleLongPressWall(wall: SprayWallRow) {
    Alert.alert(
      `Delete "${wall.name}"?`,
      "This will not delete the routes on this wall. They will still appear under All.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete wall",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteSprayWall(wall.$id)
              // remove cloud file (best-effort)
              deleteStorageFile(wall.imageUri).catch(() => {})
              setWalls((prev) => prev.filter((w) => w.$id !== wall.$id))
              if (selectedWallId === wall.$id) setSelectedWallId(null)
            } catch {
              Alert.alert("Error", "Could not delete the wall.")
            }
          },
        },
      ]
    )
  }

  // ─── Route actions ─────────────────────────────────────────────────────────

  function handleDeleteRoute(route: SprayRouteRow) {
    Alert.alert("Delete route", `Delete "${route.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSprayRoute(route.$id)
            setRoutes((prev) => prev.filter((r) => r.$id !== route.$id))
          } catch {
            Alert.alert("Error", "Could not delete the route.")
          }
        },
      },
    ])
  }

  // New route: a route must live on a wall, so require one. Use the selected
  // wall; on "All", auto-use the only wall, otherwise prompt to pick.
  function openBuilderForWall(wallId: string) {
    router.push({
      pathname: "/(tabs)/(buttonTabs)/sprayWallBuilder",
      params: {
        _new: Date.now().toString(),
        wallId,
        wallImageUri: wallsById.get(wallId)?.imageUri ?? "",
      },
    })
  }

  function handleNewRoute() {
    if (selectedWallId) { openBuilderForWall(selectedWallId); return }
    if (walls.length === 0) {
      Alert.alert("Add a wall first", "Create a wall (the + in the strip above), then add routes to it.")
      return
    }
    if (walls.length === 1) { openBuilderForWall(walls[0].$id); return }
    setWallPickerVisible(true)
  }

  async function handleCopyRoute(route: SprayRouteRow) {
    try {
      const holds = JSON.parse(route.holds || "[]")
      const newRoute = await saveSprayRoute(`${route.name} (copy)`, holds, route.wallId)
      setRoutes((prev) => [newRoute, ...prev])
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not copy route.")
    }
  }

  // ─── Derived ───────────────────────────────────────────────────────────────

  const filteredRoutes = useMemo(() => applyRouteFilters(routes, filters), [routes, filters])
  const grouped = useMemo(() => groupByDate(filteredRoutes), [filteredRoutes])
  const { width } = useWindowDimensions()
  const columns = width >= 1200 ? 4 : width >= 800 ? 3 : 2
  const GRID_PADDING = 16
  const GRID_GAP = 10
  const cardWidth = (width - GRID_PADDING * 2 - GRID_GAP * (columns - 1)) / columns

  // Chunk each date group into rows of `columns` routes so the grid can be
  // driven by a SectionList — each row only mounts (and starts loading its
  // thumbnail images) once it's actually scrolled into view. Rendering every
  // route at once via a plain ScrollView/.map() meant every thumbnail's photo
  // — full-resolution, since R2 doesn't serve resized previews — started
  // downloading and decoding simultaneously, which was enough to spike memory
  // past what a real device allows and get the app killed by the OS.
  const sections = useMemo(
    () => grouped.map(({ group, items }) => ({
      title: group,
      data: Array.from({ length: Math.ceil(items.length / columns) }, (_, i) =>
        items.slice(i * columns, i * columns + columns)
      ),
    })),
    [grouped, columns]
  )

  // Index walls by id (O(1) lookups) and parse each route's holds once per load
  // instead of JSON.parse-ing inside the render loop.
  const wallsById = useMemo(() => new Map(walls.map((w) => [w.$id, w])), [walls])
  const holdsByRoute = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const r of routes) {
      try { m.set(r.$id, JSON.parse(r.holds)) } catch { m.set(r.$id, []) }
    }
    return m
  }, [routes])

  function routeImageSource(route: SprayRouteRow) {
    const uri = wallsById.get(route.wallId ?? "")?.imageUri
    return uri ? { uri } : FALLBACK_IMAGE
  }

  function wallNaturalSize(route: SprayRouteRow) {
    const wall = wallsById.get(route.wallId ?? "")
    return wall?.width && wall?.height ? { w: wall.width, h: wall.height } : null
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.navigate("/(tabs)/(buttonTabs)/design" as any)} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Spray Wall</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Wall chip strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.wallStrip}
        style={styles.wallStripContainer}
      >
        <Pressable
          style={[styles.wallChip, selectedWallId === null && styles.wallChipActive]}
          onPress={() => setSelectedWallId(null)}
        >
          <Text style={[styles.wallChipText, selectedWallId === null && styles.wallChipTextActive]}>
            All
          </Text>
        </Pressable>

        {walls.map((wall) => (
          <Pressable
            key={wall.$id}
            style={[styles.wallChip, selectedWallId === wall.$id && styles.wallChipActive]}
            onPress={() => setSelectedWallId(wall.$id)}
            onLongPress={() => handleLongPressWall(wall)}
            delayLongPress={500}
          >
            <Text
              style={[styles.wallChipText, selectedWallId === wall.$id && styles.wallChipTextActive]}
              numberOfLines={1}
            >
              {wall.name}
            </Text>
          </Pressable>
        ))}

        <Pressable
          style={[styles.wallChip, styles.wallChipAdd]}
          onPress={handleAddWall}
          disabled={addingWall}
        >
          {addingWall
            ? <ActivityIndicator size="small" color={C.green} />
            : <Ionicons name="add" size={18} color={C.green} />
          }
        </Pressable>
      </ScrollView>

      {!loading && routes.length > 0 && (
        <View style={styles.filterBarWrap}>
          <RouteFilterBar filters={filters} onChange={setFilters} />
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={C.green} />
      ) : routes.length === 0 ? (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.empty}>
            {selectedWallId
              ? "No routes on this wall yet. Tap + to create one."
              : "No routes yet. Tap + to create one."}
          </Text>
        </ScrollView>
      ) : filteredRoutes.length === 0 ? (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.empty}>No routes match your filters.</Text>
        </ScrollView>
      ) : (
        // Virtualized: only rows scrolled into view mount their cards (and so
        // only those start loading/decoding their thumbnail image). See the
        // `sections` comment above for why that matters on device.
        <SectionList
          sections={sections}
          keyExtractor={(row) => row[0].$id}
          contentContainerStyle={styles.list}
          // SectionList's default initialNumToRender (10) still front-loads
          // far more rows than fit on screen, each doing its own hold-badge
          // layout math and kicking off an image load — with default settings
          // that first synchronous batch was still enough to freeze the JS
          // thread for several seconds. Render just what's visible up front
          // and stream the rest in small batches as the user scrolls.
          initialNumToRender={3}
          maxToRenderPerBatch={2}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews
          renderSectionHeader={({ section }) => (
            <Text style={styles.groupHeader}>{section.title}</Text>
          )}
          renderSectionFooter={() => <View style={{ height: 18 }} />}
          renderItem={({ item: row }) => (
            <View style={styles.gridRow}>
              {row.map((route) => {
                const holds = holdsByRoute.get(route.$id) ?? []
                return (
                  <View key={route.$id} style={[styles.card, { width: cardWidth }]}>
                    <Pressable
                      style={styles.thumb}
                      onPress={() =>
                        router.push({
                          pathname: "/(tabs)/(buttonTabs)/sprayWallBuilder",
                          params: {
                            routeId: route.$id,
                            routeName: route.name,
                            routeHolds: route.holds,
                            routeVariations: route.variations ?? "",
                            routeLevel: route.level != null ? String(route.level) : "",
                            routeType: route.type ?? "",
                            wallId: route.wallId ?? "",
                            wallImageUri: wallsById.get(route.wallId ?? "")?.imageUri ?? "",
                          },
                        })
                      }
                    >
                      <SprayWallViewer
                        imageSource={routeImageSource(route)}
                        holds={holds}
                        style={{ flex: 1 }}
                        interactive={false}
                        previewWidth={500}
                        naturalSize={wallNaturalSize(route)}
                      />
                    </Pressable>
                    <View style={styles.cardInfo}>
                      <Text style={styles.cardName} numberOfLines={1}>{route.name}</Text>
                      <Text style={styles.cardSub}>
                        {[
                          route.level != null ? `Lvl ${route.level}` : null,
                          route.type ? (ROUTE_TYPE_LABEL[route.type] ?? route.type) : null,
                          `${holds.length} hold${holds.length !== 1 ? "s" : ""}`,
                        ].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <View style={styles.cardActions}>
                      <Pressable onPress={() => handleCopyRoute(route)} hitSlop={6} style={styles.iconBtn}>
                        <Ionicons name="copy-outline" size={16} color={C.textSecondary} />
                      </Pressable>
                      <Pressable onPress={() => handleDeleteRoute(route)} hitSlop={6} style={styles.iconBtn}>
                        <Ionicons name="trash-outline" size={16} color={C.textMuted} />
                      </Pressable>
                    </View>
                  </View>
                )
              })}
            </View>
          )}
        />
      )}

      <Pressable style={styles.fab} onPress={handleNewRoute}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      {/* Wall name prompt modal */}
      <Modal
        visible={nameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNameModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setNameModalVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Name this wall</Text>
              <Text style={styles.modalSub}>e.g. Overhang, Cave, Slab</Text>
              <TextInput
                style={styles.modalInput}
                value={wallNameInput}
                onChangeText={setWallNameInput}
                placeholder="Wall name"
                placeholderTextColor={C.textMuted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={confirmWallName}
              />
              <View style={styles.modalActions}>
                <Pressable onPress={() => setNameModalVisible(false)} style={styles.modalBtn}>
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={confirmWallName}
                  style={[styles.modalBtn, styles.modalBtnPrimary]}
                  disabled={!wallNameInput.trim()}
                >
                  <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Add Wall</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Wall chooser — when creating a route from "All" with multiple walls */}
      <Modal
        visible={wallPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWallPickerVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setWallPickerVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Add route to which wall?</Text>
            <Text style={styles.modalSub}>A route lives on a wall — pick one.</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {walls.map((wall) => (
                <Pressable
                  key={wall.$id}
                  style={styles.wallPickRow}
                  onPress={() => { setWallPickerVisible(false); openBuilderForWall(wall.$id) }}
                >
                  <Text style={styles.wallPickName} numberOfLines={1}>{wall.name}</Text>
                  <Text style={styles.wallPickChevron}>›</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setWallPickerVisible(false)} style={styles.modalBtn}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: C.bg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  back:  { fontSize: 22, color: C.textSecondary },
  title: { fontSize: 17, fontWeight: "700", color: C.textPrimary },

  wallStripContainer: {
    flexGrow: 0,
    // Horizontal ScrollView doesn't auto-size its cross-axis (height) to
    // content on its own — without this it collapses and clips the chips.
    // flexShrink: 0 keeps it pinned at that height even when the list below
    // pushes total content past the screen height (otherwise flexbox's
    // default shrink-to-fit squashes this strip instead of just scrolling
    // the list).
    height: 52,
    flexShrink: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  wallStrip: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  wallChip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface,
  },
  wallChipActive: {
    backgroundColor: C.green, borderColor: C.green,
  },
  wallChipText: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  wallChipTextActive: { color: C.bg },
  wallChipAdd: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderColor: C.green, backgroundColor: "transparent",
    minWidth: 36, alignItems: "center",
  },

  filterBarWrap: {
    paddingTop: 10, paddingBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  list: { padding: 16, paddingBottom: 140 },
  empty: { textAlign: "center", color: C.textMuted, marginTop: 60, fontSize: 15 },

  groupHeader: {
    fontSize: 12, fontWeight: "700", color: C.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6,
    paddingHorizontal: 4, marginBottom: 10,
  },

  gridRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border,
    overflow: "hidden",
  },
  thumb: { aspectRatio: 1, backgroundColor: C.surfaceHigh },
  cardInfo: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 },
  cardName: { fontSize: 13, fontWeight: "700", color: C.textPrimary },
  cardSub:  { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  cardActions: {
    flexDirection: "row", justifyContent: "flex-end",
    paddingHorizontal: 4, paddingBottom: 4,
  },
  iconBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: "center", justifyContent: "center",
  },

  fab: {
    position: "absolute", bottom: 36, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.green,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  fabText: { fontSize: 28, color: C.bg, lineHeight: 32 },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  modalCard: {
    backgroundColor: C.surface, borderRadius: 18,
    padding: 24, width: "100%", maxWidth: 360,
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: C.textPrimary, marginBottom: 4 },
  modalSub: { fontSize: 13, color: C.textSecondary, marginBottom: 16 },
  modalInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: C.textPrimary, backgroundColor: C.bg,
    marginBottom: 20,
  },
  wallPickRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  wallPickName: { fontSize: 15, fontWeight: "600", color: C.textPrimary, flex: 1 },
  wallPickChevron: { fontSize: 20, color: C.textMuted, marginLeft: 8 },

  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  modalBtn: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10,
    backgroundColor: C.surfaceHigh,
  },
  modalBtnPrimary: { backgroundColor: C.green },
  modalBtnText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  modalBtnTextPrimary: { color: C.bg },
})
