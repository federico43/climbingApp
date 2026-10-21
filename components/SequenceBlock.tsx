import { C } from "@/utils/theme"
import CustomButton from "@/components/customButton"
import { PlacedHold, SprayWallBuilder } from "@/components/SprayWallBuilder"
import { SprayWallViewer } from "@/components/SprayWallViewer"
import VideoRecorder from "@/components/VideoRecorder"
import type { Attempt } from "@/hooks/WorkoutHook"
import { useBlockTimer } from "@/utils/blockTimer"
import {
  getSessions, getSprayRoute, getSprayRoutes, getSprayWall, saveSprayRoute,
  SprayRouteRow, SprayWallRow,
} from "@/services/BoulderGraphService"
import { RoutePickerModal } from "@/components/workoutBlocks"
import { ConsumeAuth } from "@/components/auth-context"
import { Ionicons } from "@expo/vector-icons"
import React, { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { LinearGradient } from "expo-linear-gradient"
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import { shared_styles, TopBar } from "@/utils/BlockStyles"
import { saveVideoLocally } from "@/utils/saveVideo"
import {
  parseVariations,
  variationHolds,
  availableVariations,
  VARIATION_LABEL,
  VARIATION_KEYS,
  type RouteVariations,
  type VariationKey,
} from "@/utils/sequenceVariations"
import { findBlockRuns, type BlockRun } from "@/utils/blockHistory"
import {
  isEarlyFall, pickRoute, routesVisibleTo, suggestNextSequence,
  type RouteInfo, type SequenceSuggestion,
} from "@/utils/progression/sequence"
import { useNextBlockLabel } from "@/utils/blockNav"

const SEQUENCE_HERO = require("@/assets/images/sequenceBlockPicture.jpeg")

const WALL_IMAGE = require("@/assets/images/spraywall.jpg")

type SequencePhase = "choose_route" | "intro" | "active" | "recording" | "rest1" | "review"
type Outcome = "sent" | "fell"

interface Props {
  block: any
  logAttempt: (attempt: Omit<Attempt, "blockIndex" | "type" | "timestamp">) => void
  restTimeRemaining: number | null
  startRestTimer: (duration: number) => void
  attempts: Attempt[]
  goToNextBlock: () => void
  goToPreviousBlock?: () => void
}

export function SequenceBlock({
  block,
  logAttempt,
  restTimeRemaining,
  startRestTimer,
  attempts,
  goToNextBlock,
  goToPreviousBlock,
}: Props) {
  const nextLabel = useNextBlockLabel("Continue")
  const targetAttempts: number = block.targetAttempts ?? 5
  const restTime: number       = block.restTime ?? 120
  const blockTitle: string     = block.blockName || "Sequence"
  const { User } = ConsumeAuth()

  // The route id in effect for this run. Normally just the coach-assigned
  // block.routeId, but when the block was authored with no fixed route
  // (athleteChoosesRoute), it starts empty and is filled in once the athlete
  // picks or builds a sequence — or, on resume, recovered from whichever
  // route earlier attempts were logged against.
  // On resume, the route of the *last* logged attempt — the athlete may have
  // been moved to an easier route mid-block (see dropALevel).
  const [effectiveRouteId, setEffectiveRouteId] = useState<string>(
    () => [...attempts].reverse().find((a) => a.routeId)?.routeId || block.routeId || ""
  )
  const needsRouteChoice = !!block.athleteChoosesRoute && !effectiveRouteId

  // Attempts on the route currently being climbed. Moving to an easier route
  // mid-block restarts the count, so the attempt target, dots and RPE timing
  // all work off the trailing run of attempts logged on this route — the
  // block's full attempt list (shown in review) still keeps every route.
  const routeStart = (() => {
    let i = attempts.length
    while (i > 0 && (attempts[i - 1].routeId ?? "") === effectiveRouteId) i--
    return i
  })()
  const routeAttempts = attempts.slice(routeStart)
  const attemptsDone  = routeAttempts.length

  // Revisiting a block that already met its target lands on the review state
  // (not the logging UI), so attempts are preserved and can't be over-logged.
  // A block with no route chosen yet opens on the picker instead of the intro.
  const [phase, setPhase]               = useState<SequencePhase>(() => {
    if (attemptsDone >= targetAttempts) return "review"
    if (needsRouteChoice) return "choose_route"
    return "intro"
  })
  const [pendingVideoUri, setPendingVideoUri] = useState<string | null>(null)
  const blockTimer = useBlockTimer()
  const [outcome, setOutcome]           = useState<Outcome | null>(null)
  const [highPoint, setHighPoint]       = useState<number>(1)
  const [rpe, setRpe]                   = useState<string>("")
  const [rest1Step, setRest1Step]       = useState<"outcome" | "rpe">("outcome")

  // Route variations + which one we're on. The block was authored with a
  // snapshot of routeHolds (the original) at design time, but the route may
  // have been edited since — we re-fetch by routeId on mount for the current
  // variations. We start on the coach-chosen variation (default Original) —
  // or the suggested one, see below; the in-session early-fall step-down and
  // the manual switcher move between the available variations from there.
  const [variations, setVariations] = useState<RouteVariations>(() => {
    try { return { original: JSON.parse(block.routeHolds ?? "[]") } } catch { return { original: [] } }
  })
  const [activeVariation, setActiveVariation] = useState<VariationKey>(
    VARIATION_KEYS.includes(block.startingVariation) ? block.startingVariation : "original"
  )
  const holds: PlacedHold[] = variationHolds(variations, activeVariation)
  const availableVars = availableVariations(variations)

  // In-session step-down (spec §3.2b), replacing the old blind "how did that
  // feel?" calibration: a fall in the first third of the sequence on the
  // first attempt drops to Easier; the same on the first Easier attempt moves
  // to a route one level down and restarts the attempts. "off" once the first
  // attempt went fine, and on resume (not reconstructed from the log).
  const [earlyCheck, setEarlyCheck] = useState<"first" | "first_on_easier" | "off">(() => attempts.length > 0 ? "off" : "first")
  const [varMenuOpen, setVarMenuOpen] = useState(false)

  // Between-session suggestion (spec §3.2a): the athlete's history on this
  // block + the routes they can see. Loaded once; the suggested route and
  // starting variation are preloaded, with a banner that stays until the
  // athlete chooses the authored route instead. Not applied on resume.
  const [allRoutes, setAllRoutes] = useState<Map<string, RouteInfo>>(new Map())
  const [runs, setRuns] = useState<BlockRun[]>([])
  const [suggestion, setSuggestion] = useState<SequenceSuggestion | null>(null)
  const [suggestionReady, setSuggestionReady] = useState(attempts.length > 0)

  const [routeName, setRouteName] = useState<string>(block.routeName ?? "")
  const [refreshing, setRefreshing] = useState(false)
  // Seed from the wall snapshot stored on the block (captured at design time) so
  // the real wall renders on first paint — no flash of the bundled placeholder
  // while the route → wall fetch resolves. Falls back to the placeholder only
  // for older blocks authored before the snapshot existed.
  const [wallImageSource, setWallImageSource] = useState<any>(
    block.wallImageUri ? { uri: block.wallImageUri } : WALL_IMAGE
  )
  const [wallSize, setWallSize] = useState<{ w: number; h: number } | null>(
    block.wallWidth && block.wallHeight ? { w: block.wallWidth, h: block.wallHeight } : null
  )

  // Rest progress bar (0 → 1) driven smoothly: the timer only ticks once a
  // second, so we animate the fill toward each new target over ~1s of linear
  // motion instead of jumping. On a fresh rest we snap to the start, then glide.
  const restProgress = useSharedValue(1)
  const wasRestingRef = useRef(false)
  useEffect(() => {
    const remaining = restTimeRemaining ?? 0
    // The first attempt never rests — a leftover global timer from a previous
    // block must not count as resting here.
    const resting = attemptsDone > 0 && remaining > 0
    if (!resting) {
      // Done / climb → fill to the right edge.
      restProgress.value = withTiming(1, { duration: 250, easing: Easing.linear })
      wasRestingRef.current = false
      return
    }
    const target = restTime > 0
      ? Math.min(1, Math.max(0, (restTime - remaining) / restTime))
      : 0
    if (!wasRestingRef.current) {
      restProgress.value = target            // new rest: snap to the start
      wasRestingRef.current = true
    } else {
      restProgress.value = withTiming(target, { duration: 1000, easing: Easing.linear })
    }
  }, [restTimeRemaining, restTime, attemptsDone, restProgress])

  const restBarFillStyle = useAnimatedStyle(() => ({
    width: `${restProgress.value * 100}%`,
  }))

  // Resume: restore the variation the athlete was on from the last attempt.
  useEffect(() => {
    if (attemptsDone === 0) return
    const v = [...attempts].reverse().find((a) => a.variation)?.variation as VariationKey | undefined
    if (v) setActiveVariation(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    const fresh = attempts.length === 0
    Promise.all([getSessions(), getSprayRoutes()])
      .then(([sessions, routeRows]) => {
        if (cancelled) return
        const routes = routesVisibleTo(routeRows, User?.$id)
        const history = findBlockRuns(sessions, { type: "sequence", blockName: block.blockName, libraryBlockId: block.libraryBlockId })
        setAllRoutes(routes)
        setRuns(history)
        if (!fresh) return
        const sug = suggestNextSequence(history, routes)
        if (!sug) return
        setSuggestion(sug)
        if (sug.route) {
          setEffectiveRouteId(sug.route.id)
          setRouteName(sug.route.name)
          setActiveVariation(sug.startVariation)
          if (block.athleteChoosesRoute) setPhase("intro")
        }
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setSuggestionReady(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Override: the athlete chooses their own sequence in the route picker.
  // There's no "use the planned sequence" — the coach already approved or
  // adjusted the suggestion in the editor. The banner goes once they pick;
  // closing the picker brings the suggestion back.
  const [declined, setDeclined] = useState<SequenceSuggestion | null>(null)
  function declineSuggestion() {
    setDeclined(suggestion)
    setSuggestion(null)
    setPhase("choose_route")
  }
  function closePicker() {
    if (!declined) { goToPreviousBlock?.(); return }
    setSuggestion(declined)
    setDeclined(null)
    setPhase("intro")
  }

  // Change the variation later — requires confirmation since it affects the
  // rest of the sets.
  function requestChangeVariation(key: VariationKey) {
    setVarMenuOpen(false)
    if (key === activeVariation) return
    Alert.alert(
      "Change variation?",
      "Are you sure you want to change your selected variation? This will affect all remaining sets.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Change", style: "destructive", onPress: () => setActiveVariation(key) },
      ],
    )
  }

  async function applyRouteRow(row: Awaited<ReturnType<typeof getSprayRoute>>) {
    setVariations(parseVariations(row))
    if (row.name) setRouteName(row.name)
    if (row.wallId) {
      const wall = await getSprayWall(row.wallId)
      if (wall?.imageUri) setWallImageSource({ uri: wall.imageUri })
      if (wall?.width && wall?.height) setWallSize({ w: wall.width, h: wall.height })
    }
  }

  async function refreshRoute() {
    if (!effectiveRouteId || refreshing) return
    setRefreshing(true)
    try {
      await applyRouteRow(await getSprayRoute(effectiveRouteId))
    } catch { /* keep current */ }
    finally { setRefreshing(false) }
  }

  useEffect(() => {
    if (!effectiveRouteId) return
    let cancelled = false
    getSprayRoute(effectiveRouteId)
      .then((row) => { if (!cancelled) applyRouteRow(row) })
      .catch(() => {/* keep snapshot on failure */})
    return () => { cancelled = true }
  }, [effectiveRouteId])

  // Athlete-picked (or freshly built) sequence, for blocks authored with no
  // fixed route. Sets the id first — the effect above then fetches its
  // current holds/wall the same way a coach-assigned route would be.
  function chooseRoute(route: SprayRouteRow, wall?: SprayWallRow | null) {
    setEffectiveRouteId(route.$id)
    setRouteName(route.name)
    if (wall?.imageUri) setWallImageSource({ uri: wall.imageUri })
    if (wall?.width && wall?.height) setWallSize({ w: wall.width, h: wall.height })
    setActiveVariation("original")
    setPhase("intro")
  }

  const [creatingRoute, setCreatingRoute] = useState<{ wall: SprayWallRow | null } | null>(null)
  const [savingRoute, setSavingRoute] = useState(false)
  // Saving closes two nested native <Modal>s at once (the builder, then the
  // picker underneath it) — races on iOS the same way the coach-side builder
  // does, so there too we defer the selection to onDismiss.
  const pendingRouteRef = useRef<{ route: SprayRouteRow; wall: SprayWallRow | null } | null>(null)

  async function saveNewRoute(name: string, data: { variations: RouteVariations; level: number; type: string }) {
    if (!name.trim()) { Alert.alert("Name required", "Give the sequence a name before saving."); return }
    const holdsToSave = data.variations.original ?? []
    const extras = { level: data.level, type: data.type, variations: data.variations, athleteId: User?.$id }
    setSavingRoute(true)
    try {
      const wall = creatingRoute?.wall ?? null
      const created = await saveSprayRoute(name.trim(), holdsToSave, wall?.$id, extras)
      if (Platform.OS === "ios") {
        pendingRouteRef.current = { route: created, wall }
        setCreatingRoute(null)
      } else {
        chooseRoute(created, wall)
        setCreatingRoute(null)
      }
    } catch (e) {
      Alert.alert("Error", "Could not save the sequence. Try again.")
      console.error(e)
    } finally {
      setSavingRoute(false)
    }
  }

  // Move slots, counting "match" holds as two (they show two move numbers).
  const moveSlots = holds.filter((h) => h.type === "move").reduce((s, h) => s + (h.match ? 2 : 1), 0)
  // The reach to the top/finish hold isn't a "move" but you can still fall on
  // it, so add one extra step when the route has a finish hold.
  const hasFinish = holds.some((h) => h.type === "finish")
  const maxMove   = Math.max(1, moveSlots + (hasFinish ? 1 : 0))
  // RPE is only asked on the second and final attempts of the sequence.
  const askRpe    = attemptsDone === 1 || attemptsDone + 1 >= targetAttempts

  // The rest countdown now lives inside the active phase (a pill timer), so the
  // logging step (rest1) just starts the timer; when it expires the active
  // screen flips from "Rest" back to "Climb" on its own.
  function enterRest() {
    setOutcome(null)
    setHighPoint(1)
    setRpe("")
    setRest1Step("outcome")
    startRestTimer(restTime)
    setPhase("rest1")
  }

  // Second half of the in-session step-down: a route of the same type one
  // level down on the same wall, with the attempts starting over. Returns
  // whether it moved.
  function dropALevel(): boolean {
    const current = allRoutes.get(effectiveRouteId)
    const lower = current?.level != null && current.level > 1
      ? pickRoute(allRoutes, current, current.level - 1, runs)
      : null
    if (!lower) {
      setEarlyCheck("off")
      Alert.alert("Keep going", "There's no easier saved sequence to move to — carry on with this one.")
      return false
    }
    setEffectiveRouteId(lower.id)
    setRouteName(lower.name)
    setActiveVariation("original")
    setEarlyCheck("first")
    Alert.alert("Easier sequence", `Moving to ${lower.name} (level ${lower.level}). Your attempts start over.`)
    return true
  }

  function handleSaveAttempt() {
    const success = outcome === "sent"
    const isLast  = attemptsDone + 1 >= targetAttempts
    logAttempt({
      success,
      video: pendingVideoUri ?? undefined,
      rpe: rpe ? Number(rpe) : undefined,
      highPoint: outcome === "fell" ? highPoint : undefined,
      routeId: effectiveRouteId,
      variation: activeVariation,
    })
    setPendingVideoUri(null)

    let movedRoute = false
    if (earlyCheck !== "off") {
      const fellEarly = !success && isEarlyFall(highPoint, maxMove)
      if (!fellEarly) setEarlyCheck("off")
      else if (earlyCheck === "first" && activeVariation !== "easy" && availableVars.includes("easy")) {
        setActiveVariation("easy")
        setEarlyCheck("first_on_easier")
        Alert.alert("Easier variation", "You came off in the first third — switching to the Easier variation.")
      } else {
        movedRoute = dropALevel()
      }
    }

    // On the last set there's no next attempt, so skip the rest and go straight
    // to review (unless the attempts just restarted on an easier route).
    // Otherwise return to the active screen, which shows the running rest
    // timer as a pill until it expires.
    setPhase(isLast && !movedRoute ? "review" : "active")
  }

  // ── 0. Choose route — only for blocks authored with no fixed sequence ────────

  // Hold the picker until the suggestion has loaded — it may pick the route.
  if (phase === "choose_route" && !suggestionReady) {
    return (
      <View style={[shared_styles.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={C.green} />
      </View>
    )
  }

  if (phase === "choose_route") {
    return (
      <>
        <RoutePickerModal
          onSelect={(route, wall) => { setDeclined(null); chooseRoute(route, wall) }}
          onClose={closePicker}
          onCreateNew={(wall) => setCreatingRoute({ wall: wall ?? null })}
        />
        <Modal
          visible={creatingRoute !== null}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setCreatingRoute(null)}
          onDismiss={() => {
            const pending = pendingRouteRef.current
            if (!pending) return
            pendingRouteRef.current = null
            chooseRoute(pending.route, pending.wall)
          }}
        >
          {creatingRoute && (
            <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top"]}>
              <SprayWallBuilder
                imageSource={creatingRoute.wall?.imageUri ? { uri: creatingRoute.wall.imageUri } : WALL_IMAGE}
                onBack={() => setCreatingRoute(null)}
                onSave={saveNewRoute}
                saving={savingRoute}
              />
            </SafeAreaView>
          )}
        </Modal>
      </>
    )
  }

  // ── 1. Intro ──────────────────────────────────────────────────────────────────

  if (phase === "intro") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title={blockTitle} onBack={goToPreviousBlock} hideBorder />

        <ScrollView contentContainerStyle={styles.introContent}>
          {/* Full-bleed hero image, fading into the background at the bottom */}
          <View style={styles.hero}>
            <Image source={SEQUENCE_HERO} style={styles.heroImg} resizeMode="cover" />
            <LinearGradient
              colors={["transparent", C.bg]}
              style={styles.heroFade}
              pointerEvents="none"
            />
          </View>

          {!!block.description && (
            <Text style={styles.infoCardDesc}>{block.description}</Text>
          )}

          {/* Progression suggestion — stays until the athlete chooses the
              authored route instead (same persistent pattern as S&C). */}
          {!!suggestion && (
            <View style={styles.suggestionBanner}>
              <Text style={styles.suggestionBannerLast}>{suggestion.lastTime}</Text>
              <Text style={styles.suggestionBannerText}>{suggestion.note}</Text>
              {!!suggestion.route && (
                <>
                  <Text style={styles.suggestionRoute}>
                    {suggestion.route.name}
                    {suggestion.route.level != null ? ` · level ${suggestion.route.level}` : ""}
                    {suggestion.startVariation !== "original" ? ` · start ${VARIATION_LABEL[suggestion.startVariation]}` : ""}
                  </Text>
                  <Pressable onPress={declineSuggestion} hitSlop={8}>
                    <Text style={styles.suggestionDecline}>Choose my own sequence</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}

          {/* Stats card */}
          <View style={styles.statsCard}>
            {moveSlots > 0 && (
              <>
                <View style={styles.statItem}>
                  {/* Count matches as two moves — same rule as the fall tracker. */}
                  <Text style={styles.statNum}>{moveSlots}</Text>
                  <Text style={styles.statLabel}>moves</Text>
                </View>
                <View style={styles.statDivider} />
              </>
            )}
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{targetAttempts}</Text>
              <Text style={styles.statLabel}>attempts</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNum}>{restTime >= 60 ? `${Math.round(restTime / 60)}m` : `${restTime}s`}</Text>
              <Text style={styles.statLabel}>rest</Text>
            </View>
          </View>
        </ScrollView>

        {/* Fixed start button */}
        <View style={styles.introFooter}>
          {/* Wait for the suggestion so the route can't change after Start. */}
          <Pressable
            style={[styles.startBtn, !suggestionReady && { opacity: 0.5 }]}
            disabled={!suggestionReady}
            onPress={() => { blockTimer.start(); setPhase("active") }}
          >
            {suggestionReady
              ? <Text style={styles.startBtnText}>Start</Text>
              : <ActivityIndicator color={C.bg} />}
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 2. Active ─────────────────────────────────────────────────────────────────

  if (phase === "active") {
    // The first attempt never rests (ignores any leftover timer from a prior block).
    const resting = attemptsDone > 0 && (restTimeRemaining ?? 0) > 0
    const restDisplay = resting
      ? `${Math.floor(restTimeRemaining! / 60)}:${String(restTimeRemaining! % 60).padStart(2, "0")}`
      : null
    // While resting the controls look disabled, but tapping offers to skip the
    // rest and go straight on to the action they tapped (record / register).
    const onControlPress = (action: () => void) => {
      if (resting) {
        Alert.alert(
          "Skip rest?",
          "You're still resting. Skip the rest and continue?",
          [
            { text: "Keep resting", style: "cancel" },
            { text: "Skip rest", style: "destructive", onPress: () => { startRestTimer(0); action() } },
          ],
        )
        return
      }
      action()
    }
    return (
      <View style={shared_styles.screen}>
        <TopBar onBack={() => setPhase("intro")} hideBorder />
        {/* Attempt dots: green = sent, red = fell, ringed = current, hollow = pending */}
        <View style={styles.dotsRow}>
          {Array.from({ length: targetAttempts }).map((_, i) => {
            const done = i < attemptsDone
            const isCurrent = i === attemptsDone
            const sent = done && routeAttempts[i]?.success
            const fell = done && !routeAttempts[i]?.success
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  sent && styles.dotSent,
                  fell && styles.dotFell,
                  isCurrent && styles.dotCurrent,
                  !done && !isCurrent && styles.dotPending,
                ]}
              />
            )
          })}
        </View>
        {/* While resting: a progress bar that fills to the right. When done: a
            simple "Go climb" prompt instead of a bar. */}
        <View style={styles.restPillWrap}>
          {resting ? (
            <View style={[styles.restBar, styles.restBarResting]}>
              <Animated.View style={[styles.restBarFill, restBarFillStyle, {
                backgroundColor: "rgba(98,201,154,0.5)",
              }]} />
              <View style={styles.restBarContent}>
                <Text style={[styles.restBarText, { color: C.textPrimary }]}>
                  Rest · {restDisplay}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.goClimbText}>Go climb</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <SprayWallViewer imageSource={wallImageSource} holds={holds} style={{ flex: 1 }} freeGesture naturalSize={wallSize} />
          {!!effectiveRouteId && (
            <Pressable style={styles.reloadBtn} onPress={refreshRoute} hitSlop={8}>
              <Ionicons
                name={refreshing ? "sync" : "refresh"}
                size={20}
                color="#fff"
              />
            </Pressable>
          )}
        </View>
        {/* Variation dropdown — only once the first attempt (and its
            early-fall check) is done. */}
        {attemptsDone > 0 && availableVars.length > 1 && (
          <View style={styles.varDropdownWrap}>
            <Pressable style={styles.varPill} onPress={() => setVarMenuOpen((o) => !o)}>
              <Text style={styles.varPillText}>Variation: {VARIATION_LABEL[activeVariation]}</Text>
              <Text style={styles.varPillCaret}>{varMenuOpen ? "▴" : "▾"}</Text>
            </Pressable>
            {varMenuOpen && (
              <View style={styles.varMenu}>
                {availableVars.map((k) => (
                  <Pressable
                    key={k}
                    style={[styles.varMenuItem, activeVariation === k && styles.varMenuItemActive]}
                    onPress={() => requestChangeVariation(k)}
                  >
                    <Text style={[styles.varMenuItemText, activeVariation === k && styles.varMenuItemTextActive]}>
                      {VARIATION_LABEL[k]}
                    </Text>
                    {activeVariation === k && <Text style={styles.varMenuCheck}>✓</Text>}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
        <View style={styles.activeControls}>
          <Pressable
            style={[styles.recordBtn, resting && styles.controlDisabled]}
            onPress={() => onControlPress(() => setPhase("recording"))}
          >
            <Text style={styles.recordBtnText}>Record</Text>
          </Pressable>
          <Pressable
            style={[styles.registerBtn, resting && styles.controlDisabled]}
            onPress={() => onControlPress(enterRest)}
          >
            <Text style={styles.registerBtnText}>Register attempt</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 3. Recording ──────────────────────────────────────────────────────────────

  if (phase === "recording") {
    return (
      <VideoRecorder
        onFinish={async (uri: string) => {
          const saved = await saveVideoLocally(uri, "sequence", { projectName: routeName })
          setPendingVideoUri(saved ?? uri)
          enterRest()
        }}
        onClose={() => setPhase("active")}
      />
    )
  }

  // ── 4. Rest phase 1 — data entry ──────────────────────────────────────────────

  if (phase === "rest1") {
    const timerDisplay = restTimeRemaining != null && restTimeRemaining > 0
      ? `${Math.floor(restTimeRemaining / 60)}:${String(restTimeRemaining % 60).padStart(2, "0")}`
      : "go!"

    // ── Step 1: outcome
    if (rest1Step === "outcome") {
      return (
        <View style={[shared_styles.screen, { backgroundColor: C.bg }]}>
          <View style={styles.rest1Header}>
            <Text style={styles.rest1Question}>How did it go?</Text>
            <View style={styles.pillTimer}>
              <Text style={styles.pillTimerText}>{timerDisplay}</Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={styles.rest1Content}>

            <View style={styles.outcomeRow}>
              {(["sent", "fell"] as Outcome[]).map((o) => (
                <Pressable
                  key={o}
                  style={[
                    styles.outcomeChip,
                    outcome === o && (o === "sent" ? styles.outcomeChipSent : styles.outcomeChipFell),
                  ]}
                  onPress={() => setOutcome(o)}
                >
                  <Text style={[styles.outcomeChipText, outcome === o && styles.outcomeChipTextSelected]}>
                    {o === "sent" ? "Sent" : "Fell"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {outcome === "fell" && (
              <>
                <Text style={styles.sectionLabel}>High point</Text>
                <View style={styles.stepperRow}>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => setHighPoint((p) => Math.max(1, p - 1))}
                  >
                    <Text style={styles.stepperBtnText}>−</Text>
                  </Pressable>
                  <View style={styles.stepperValue}>
                    {hasFinish && highPoint === maxMove ? (
                      <Text style={styles.stepperValueText}>Top</Text>
                    ) : (
                      <>
                        <Text style={styles.stepperValueText}>Move {highPoint}</Text>
                        <Text style={styles.stepperValueSub}>of {maxMove}</Text>
                      </>
                    )}
                  </View>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => setHighPoint((p) => Math.min(maxMove, p + 1))}
                  >
                    <Text style={styles.stepperBtnText}>+</Text>
                  </Pressable>
                </View>
              </>
            )}

          </ScrollView>
          <View style={styles.rest1Footer}>
            <View />
            <Pressable
              style={[styles.rest1NextBtn, !outcome && styles.rest1NextBtnDisabled]}
              onPress={() => { if (!outcome) return; if (askRpe) setRest1Step("rpe"); else handleSaveAttempt() }}
            >
              <Text style={[styles.rest1NextBtnText, !outcome && styles.rest1NextBtnTextDisabled]}>{askRpe ? "Next" : "Save"}</Text>
            </Pressable>
          </View>
        </View>
      )
    }

    // ── Step 2: RPE
    return (
      <View style={[shared_styles.screen, { backgroundColor: C.bg }]}>
        <View style={styles.rest1Header}>
          <Text style={styles.rest1Question}>How hard was it?</Text>
          <View style={styles.pillTimer}>
            <Text style={styles.pillTimerText}>{timerDisplay}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.rest1Content}>

          <Text style={styles.sectionLabel}>RPE</Text>
          <View style={styles.rpeRow}>
            {["6", "7", "8", "9", "10"].map((val) => (
              <Pressable
                key={val}
                style={[styles.rpeChip, rpe === val && styles.rpeChipSelected]}
                onPress={() => setRpe(val)}
              >
                <Text style={[styles.rpeChipText, rpe === val && styles.rpeChipTextSelected]}>
                  {val}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.rpeNote}>Rate this set only — not the whole block.</Text>

        </ScrollView>
        <View style={styles.rest1Footer}>
          <Pressable style={[styles.rest1NextBtn, { borderColor: C.border }]} onPress={() => setRest1Step("outcome")}>
            <Text style={[styles.rest1NextBtnText, { color: C.textSecondary }]}>Back</Text>
          </Pressable>
          <Pressable style={[styles.rest1NextBtn, !rpe && styles.rest1NextBtnDisabled]} onPress={handleSaveAttempt}>
            <Text style={[styles.rest1NextBtnText, !rpe && styles.rest1NextBtnTextDisabled]}>Save</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── 5. Review ─────────────────────────────────────────────────────────────────

  if (phase === "review") {
    return (
      <View style={shared_styles.screen}>
        <TopBar title="Review" />
        <ScrollView contentContainerStyle={styles.reviewContent}>
          <Text style={shared_styles.title}>
            {attempts.length} attempt{attempts.length !== 1 ? "s" : ""}
          </Text>

          {attempts.map((a, i) => (
            <React.Fragment key={i}>
            {/* Marks where the athlete was moved to an easier route mid-block. */}
            {i > 0 && (a.routeId ?? "") !== (attempts[i - 1].routeId ?? "") && (
              <Text style={styles.reviewRouteChange}>
                Moved to {allRoutes.get(a.routeId ?? "")?.name ?? "an easier sequence"}
              </Text>
            )}
            <View style={styles.reviewRow}>
              <View style={styles.reviewRowLeft}>
                <Text style={styles.reviewAttemptNum}>#{i + 1}</Text>
                <View>
                  <Text style={[
                    styles.reviewOutcome,
                    a.success ? styles.reviewSent : styles.reviewFell,
                  ]}>
                    {a.success ? "Sent" : "Fell"}
                  </Text>
                  {!a.success && a.highPoint != null && (
                    <Text style={styles.reviewFellAt}>
                      {hasFinish && a.highPoint === maxMove
                        ? "at the top"
                        : `at move ${a.highPoint}${maxMove > 1 ? ` / ${maxMove}` : ""}`}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.reviewRowRight}>
                {a.rpe != null && (
                  <Text style={styles.reviewDetail}>RPE {a.rpe}</Text>
                )}
                {a.video && (
                  <Text style={styles.reviewDetail}>📹</Text>
                )}
              </View>
            </View>
            </React.Fragment>
          ))}

          <CustomButton title={nextLabel} onPress={goToNextBlock} />
        </ScrollView>
      </View>
    )
  }

  return null
}

const styles = StyleSheet.create({
  // ── Intro
  introContent: { padding: 20, gap: 16, paddingBottom: 8 },
  infoCardDesc: { fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  // Full-bleed hero: negative margins cancel the introContent padding so the
  // image runs edge-to-edge. Capped height + cover crops it (keeps proportions
  // without dominating the screen).
  hero: { marginTop: -20, marginHorizontal: -20, marginBottom: -8, height: 240 },
  heroImg: { width: "100%", height: "100%" },
  heroFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 110 },
  statsCard: {
    flexDirection: "row", backgroundColor: C.surface,
    borderRadius: 16, paddingVertical: 18,
    borderWidth: 1, borderColor: C.border,
  },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statNum: { fontSize: 26, fontWeight: "800", color: C.green, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 12, color: C.textSecondary },
  statDivider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  reviewRouteChange: { fontSize: 12, fontWeight: "700", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
  suggestionBanner: {
    backgroundColor: "rgba(111,207,151,0.12)", borderWidth: 1, borderColor: C.green,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, gap: 6,
  },
  suggestionBannerLast: { fontSize: 12.5, color: C.textSecondary, lineHeight: 17 },
  suggestionBannerText: { fontSize: 12.5, fontWeight: "600", color: C.green, lineHeight: 17 },
  suggestionRoute: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  suggestionDecline: { fontSize: 12.5, fontWeight: "600", color: C.textSecondary, textDecorationLine: "underline" },
  previewWrapper: { gap: 8 },
  routeLabel: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  previewWall: { height: 300, borderRadius: 14, overflow: "hidden" },
  reloadBtn: {
    position: "absolute", top: 12, right: 12,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },
  introFooter: {
    backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36,
  },
  startBtn: {
    backgroundColor: C.green, borderRadius: 24,
    paddingVertical: 14, alignItems: "center",
  },
  startBtnText: { color: C.bg, fontSize: 16, fontWeight: "700" },
  rest1Footer: {
    backgroundColor: C.bg, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  rest1NextBtn: {
    borderRadius: 20, borderWidth: 1.5, borderColor: C.green,
    paddingHorizontal: 28, paddingVertical: 10,
  },
  rest1NextBtnDisabled: { borderColor: C.border },
  rest1NextBtnText: { fontSize: 15, fontWeight: "700", color: C.green },
  rest1NextBtnTextDisabled: { color: C.textMuted },

  // ── Active
  activeControls: {
    backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20,
    flexDirection: "row", gap: 10,
  },
  recordBtn: {
    flex: 1, backgroundColor: C.surfaceHigh, borderRadius: 22,
    paddingVertical: 12, alignItems: "center",
  },
  recordBtnText: { color: C.textPrimary, fontSize: 15, fontWeight: "700" },
  registerBtn: {
    flex: 1, backgroundColor: C.green, borderRadius: 22,
    paddingVertical: 12, alignItems: "center", justifyContent: "center",
  },
  registerBtnText: { fontSize: 15, fontWeight: "800", color: C.bg },
  controlDisabled: { opacity: 0.4 },

  // Attempt dots (top of the active phase)
  dotsRow: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: 10, backgroundColor: C.bg, paddingTop: 10, paddingBottom: 2,
  },
  dot: {
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 1.5, borderColor: "transparent", backgroundColor: "transparent",
  },
  dotSent: { backgroundColor: C.green, borderColor: C.green },
  dotFell: { backgroundColor: C.red, borderColor: C.red },
  dotCurrent: { width: 15, height: 15, borderRadius: 7.5, borderColor: C.green },
  dotPending: { borderColor: C.border },

  // Rest / Climb progress bar (top of the active phase)
  restPillWrap: { backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  restBar: {
    alignSelf: "stretch", height: 44, borderRadius: 14, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, justifyContent: "center",
  },
  restBarResting: { borderColor: C.border },
  restBarFill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  restBarContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  restBarText: { fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] },
  goClimbText: {
    textAlign: "center", fontSize: 16, fontWeight: "800", color: C.green,
    paddingVertical: 12,
  },

  // Variation dropdown (active phase, after the initial selection)
  varDropdownWrap: {
    backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 8, alignItems: "center",
  },
  varPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  varPillText: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  varPillCaret: { fontSize: 12, color: C.textSecondary },
  varMenu: {
    marginTop: 6, backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, overflow: "hidden", minWidth: 200,
  },
  varMenuItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  varMenuItemActive: { backgroundColor: C.surfaceHigh },
  varMenuItemText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  varMenuItemTextActive: { color: C.textPrimary, fontWeight: "700" },
  varMenuCheck: { fontSize: 14, color: C.green, fontWeight: "800" },

  // Calibration screen (blind selection)

  // ── Rest 1
  pillTimer: {
    backgroundColor: "transparent", borderRadius: 20, borderWidth: 1.5, borderColor: C.green,
    paddingHorizontal: 16, paddingVertical: 6, minWidth: 84, alignItems: "center",
  },
  pillTimerText: { fontSize: 15, fontWeight: "700", color: C.green },
  rest1Header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8,
  },
  rest1Question: {
    fontSize: 26, fontWeight: "700", color: C.textPrimary, flex: 1,
  },
  rest1Content: { padding: 24, gap: 16, flexGrow: 1 },
  sectionLabel: {
    fontSize: 12, color: C.textMuted,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: -4,
  },
  outcomeRow: { flexDirection: "row", gap: 12 },
  outcomeChip: {
    flex: 1, paddingVertical: 16, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, alignItems: "center",
  },
  outcomeChipSent: { backgroundColor: C.green, borderColor: C.green },
  outcomeChipFell: { backgroundColor: C.red, borderColor: C.red },
  outcomeChipText: { fontSize: 16, fontWeight: "700", color: C.textSecondary },
  outcomeChipTextSelected: { color: C.bg },
  stepperRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 14, overflow: "hidden",
  },
  stepperBtn: {
    width: 56, paddingVertical: 18, alignItems: "center", justifyContent: "center",
  },
  stepperBtnText: { fontSize: 26, fontWeight: "300", color: C.textPrimary },
  stepperValue: { flex: 1, alignItems: "center", gap: 2 },
  stepperValueText: { fontSize: 18, fontWeight: "700", color: C.textPrimary },
  stepperValueSub: { fontSize: 12, color: C.textMuted },
  rpeRow: { flexDirection: "row", gap: 8 },
  rpeChip: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, alignItems: "center",
  },
  rpeChipSelected: { backgroundColor: C.green, borderColor: C.green },
  rpeChipText: { fontSize: 15, fontWeight: "600", color: C.textSecondary },
  rpeChipTextSelected: { color: C.bg },
  rpeNote: { fontSize: 12, color: C.textMuted, fontStyle: "italic" },

  // ── Review
  reviewContent: { padding: 20, gap: 10 },
  reviewRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
  },
  reviewRowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  reviewRowRight: { flexDirection: "row", gap: 10, alignItems: "center" },
  reviewAttemptNum: { fontSize: 13, fontWeight: "600", color: C.textMuted },
  reviewOutcome: { fontSize: 15, fontWeight: "700" },
  reviewSent: { color: C.green },
  reviewFell: { color: C.red },
  reviewDetail: { fontSize: 13, color: C.textSecondary },
  reviewFellAt: { fontSize: 12, color: C.textMuted, marginTop: 2 },
})
