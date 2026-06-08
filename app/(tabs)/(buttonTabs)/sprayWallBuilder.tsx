import { SprayWallBuilder } from "@/components/SprayWallBuilder"
import { getSprayWall, saveSprayRoute, updateSprayRoute } from "@/services/BoulderGraphService"
import { resolveNewRoute } from "@/utils/pendingRouteSelection"
import { parseVariations, RouteVariations } from "@/utils/sequenceVariations"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { Alert, StyleSheet } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

const FALLBACK_IMAGE = require("@/assets/images/spraywall.jpg")

export default function SprayWallBuilderScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    routeId?: string
    routeName?: string
    routeHolds?: string
    routeVariations?: string
    routeLevel?: string
    routeType?: string
    _new?: string
    from?: string
    wallId?: string
    wallImageUri?: string
  }>()
  const [saving, setSaving] = useState(false)

  const isEditing = !!params.routeId
  const fromPicker = params.from === "protocolPicker"
  const wallId = params.wallId || undefined
  // Seed from the passed URL, but also resolve the wall's current image from the
  // DB by id — the passed param can be empty/stale/mangled depending on the flow
  // (e.g. creating a route from the protocol picker).
  const [imageSource, setImageSource] = useState<any>(
    params.wallImageUri ? { uri: params.wallImageUri } : FALLBACK_IMAGE
  )
  useEffect(() => {
    if (!wallId) return
    let cancelled = false
    getSprayWall(wallId)
      .then((wall) => { if (!cancelled && wall?.imageUri) setImageSource({ uri: wall.imageUri }) })
      .catch(() => { /* keep the seeded source */ })
    return () => { cancelled = true }
  }, [wallId])

  const initialVariations: RouteVariations = parseVariations({
    holds: params.routeHolds,
    variations: params.routeVariations,
  })
  const initialLevel = params.routeLevel ? Number(params.routeLevel) : undefined
  const initialType = params.routeType || undefined

  // This lives in a Tabs navigator, where router.back() jumps to the first tab
  // (Home) rather than the previous screen — so we navigate to the originating
  // tab explicitly. When the flow started from the sequence picker, return to
  // the protocol designer (which stays mounted, with the picker waiting on the
  // route bus); otherwise return to the spray wall list.
  function returnToOrigin() {
    if (fromPicker) {
      router.navigate("/(tabs)/(buttonTabs)/protocolDesigner" as any)
    } else {
      router.navigate("/(tabs)/(buttonTabs)/sprayWall" as any)
    }
  }

  function navigateBack() {
    // Backing out of a create-new flow: tell the picker it was cancelled.
    if (fromPicker) resolveNewRoute(null)
    returnToOrigin()
  }

  async function handleSave(
    name: string,
    data: { variations: RouteVariations; level: number; type: string },
  ) {
    if (!name.trim()) {
      Alert.alert("Name required", "Give the route a name before saving.")
      return
    }
    // The legacy `holds` field mirrors the original variation.
    const holds = data.variations.original ?? []
    const extras = { level: data.level, type: data.type, variations: data.variations }
    setSaving(true)
    try {
      if (isEditing) {
        await updateSprayRoute(params.routeId!, name.trim(), holds, extras)
      } else {
        const created = await saveSprayRoute(name.trim(), holds, wallId, extras)
        // Hand the new route back to the picker so it auto-selects it.
        if (fromPicker) resolveNewRoute(created)
      }
      returnToOrigin()
    } catch (e) {
      Alert.alert("Error", "Could not save the route. Try again.")
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <SprayWallBuilder
        key={params.routeId ?? params._new ?? "new"}
        imageSource={imageSource}
        initialVariations={initialVariations}
        initialLevel={initialLevel}
        initialType={initialType}
        initialName={params.routeName ?? ""}
        onBack={navigateBack}
        onSave={handleSave}
        saving={saving}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0a0a0a" },
})
