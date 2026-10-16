import { C } from "@/utils/theme"
import { CreateSequenceModal } from "@/components/AthleteSequenceCreator"
import { ConsumeAuth } from "@/components/auth-context"
import { ScalePressable } from "@/components/ScalePressable"
import { ScreenGradient } from "@/components/ScreenGradient"
import { SubScreenHeader } from "@/components/SubScreenHeader"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { deleteSprayRoute, getMySprayRoutes, SprayRouteRow } from "@/services/BoulderGraphService"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

// Settings › My sequences — the athlete's own spray-wall routes: try,
// edit, delete, or build a new one. (Home has a "New sequence" shortcut.)
export default function MySequencesScreen() {
  const { User } = ConsumeAuth()
  const workoutCtx = useWorkoutContext()
  const [sequences, setSequences] = useState<SprayRouteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modal, setModal] = useState<{ editing: SprayRouteRow | null } | null>(null)

  const load = useCallback(async () => {
    try {
      setSequences(await getMySprayRoutes(User!.$id))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [User])

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      load()
    }, [User, load])
  )


  function tryOut(route: SprayRouteRow) {
    workoutCtx.openWorkout(
      [{
        id: `sequence-${route.$id}`,
        type: "sequence",
        blockName: route.name,
        description: "",
        targetAttempts: 5,
        restTime: 120,
        routeId: route.$id,
        routeName: route.name,
        routeHolds: route.holds,
        startingVariation: "original",
      }],
      route.name,
    )
  }

  function confirmDelete(route: SprayRouteRow) {
    Alert.alert("Delete sequence", `Delete "${route.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await deleteSprayRoute(route.$id)
            setSequences((prev) => prev.filter((r) => r.$id !== route.$id))
          } catch (e: any) { Alert.alert("Error", e?.message ?? "Could not delete the sequence.") }
        },
      },
    ])
  }

  function openMenu(route: SprayRouteRow) {
    Alert.alert(route.name, undefined, [
      { text: "Edit", onPress: () => setModal({ editing: route }) },
      { text: "Delete", style: "destructive", onPress: () => confirmDelete(route) },
      { text: "Cancel", style: "cancel" },
    ])
  }

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <SubScreenHeader
          title="My sequences"
          right={
            <Pressable
              onPress={() => setModal({ editing: null })}
              hitSlop={8}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Ionicons name="add" size={16} color={C.green} />
              <Text style={styles.linkText}>New</Text>
            </Pressable>
          }
        />

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
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
            {sequences.length > 0 ? (
              sequences.map((route) => (
                <View key={route.$id} style={styles.card}>
                  <ScalePressable style={{ flex: 1 }} onPress={() => tryOut(route)}>
                    <Text style={styles.cardTitle}>{route.name}</Text>
                    <Text style={styles.cardSub}>
                      {route.level != null ? `Lvl ${route.level} · ` : ""}Tap to try
                    </Text>
                  </ScalePressable>
                  <Pressable onPress={() => openMenu(route)} hitSlop={8}>
                    <Ionicons name="ellipsis-vertical" size={18} color={C.textSecondary} />
                  </Pressable>
                </View>
              ))
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No sequences yet — tap &quot;New&quot; to build one</Text>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      {User && (
        <CreateSequenceModal
          visible={modal !== null}
          athleteId={User.$id}
          editing={modal?.editing ?? null}
          onClose={() => setModal(null)}
          onSaved={(route) => {
            setSequences((prev) => {
              const exists = prev.some((r) => r.$id === route.$id)
              return exists ? prev.map((r) => (r.$id === route.$id ? route : r)) : [route, ...prev]
            })
          }}
        />
      )}
    </ScreenGradient>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "transparent" },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  linkText: { fontSize: 13, fontWeight: "600", color: C.green },
  card: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.green,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.textPrimary, marginBottom: 4 },
  cardSub: { fontSize: 13, color: C.textSecondary },
  empty: { backgroundColor: C.surfaceHigh, borderRadius: 14, padding: 16, alignItems: "center" },
  emptyText: { fontSize: 14, color: C.textMuted },
})
