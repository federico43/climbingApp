import { useHoldUpdates } from "@/utils/updateHold"
import { C } from "@/utils/theme"
import { createExercise, ExerciseRow, listExercises, updateExercise, uploadPhoto } from "@/services/BoulderGraphService"
import { ExerciseUnit } from "@/utils/exerciseUnit"
import { invalidateExerciseLibrary } from "@/utils/exerciseLibraryCache"
import { chainTailFor, ladderHasFork, mergeIntoLadder, resolveFullChain } from "@/utils/levelChain"
import { MOVEMENT_TYPE_LABEL, MOVEMENT_TYPES, MovementType } from "@/utils/movementTypes"
import { Focus, FOCUSES, FOCUS_LABEL, LevelStep, LoadMode } from "@/utils/scProgression"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import * as ImagePicker from "expo-image-picker"

export type ExerciseType = "reps" | "both_sides" | "7/3s"

const TYPE_LABELS: Record<ExerciseType, string> = {
  reps: "Reps", both_sides: "Both sides", "7/3s": "7/3s",
}

// After saving, `newFullChain` is the complete easiest -> hardest chain
// (self included, at whatever position the coach placed it) as edited in
// this form. Recompute what each OTHER member's own "harder than me" tail
// should be and push it to their rows — both exercises newly added to the
// chain and ones dropped from it — so opening any of them shows the same
// progression instead of only whichever row it was authored on.
async function syncChainWithLibrary(
  savedId: string,
  newFullChain: LevelStep[],
  previousId: string | undefined,
  allExercises: ExerciseRow[]
) {
  const oldFullChain = previousId ? resolveFullChain(previousId, allExercises) : []
  const byId = new Map(allExercises.map((ex) => [ex.$id, ex]))
  // Everything that was connected to any member before this save — not
  // just the old and new lists — so an exercise removed from the ladder
  // (or left on a forked branch) is reset instead of still pointing in and
  // recreating two exercises on one step.
  const affectedIds = new Set<string>()
  for (const l of [...oldFullChain, ...newFullChain]) {
    affectedIds.add(l.exerciseId)
    for (const c of resolveFullChain(l.exerciseId, allExercises)) affectedIds.add(c.exerciseId)
  }
  affectedIds.delete(savedId)

  for (const id of affectedIds) {
    const member = byId.get(id)
    if (!member) continue
    const inNewChain = newFullChain.some((l) => l.exerciseId === id)
    await updateExercise(id, {
      name: member.name,
      type: member.type,
      loadMode: inNewChain ? "level" : "weight",
      levels: chainTailFor(id, newFullChain),
    })
  }
}

// The ladder editor shows one easiest → hardest list with this exercise in
// it; state stays split into easier / harder around it (what save needs).
// SELF_ID marks this exercise's own row in that combined list.
const SELF_ID = "__self__"

function splitLadder(ladder: LevelStep[]): { easier: LevelStep[]; harder: LevelStep[] } {
  const i = ladder.findIndex((l) => l.exerciseId === SELF_ID)
  return { easier: ladder.slice(0, i), harder: ladder.slice(i + 1) }
}

// Single source of truth for the "create/edit exercise" UI, shared by the
// Exercises library screen and the inline picker in the protocol designer.
// Pass a `fixedType` to lock the type (and hide the type picker) when the
// caller already knows it — otherwise the user picks the type here. Pass
// `exercise` to edit an existing library row instead of creating a new one.
export function ExerciseForm({
  fixedType,
  exercise,
  title = "New exercise",
  saveLabel = "Save",
  onCancel,
  onCreated,
}: {
  fixedType?: ExerciseType
  exercise?: ExerciseRow
  title?: string
  saveLabel?: string
  onCancel: () => void
  onCreated: (ex: ExerciseRow) => void
}) {
  // A reload here would lose unsaved work — see utils/updateHold.ts.
  useHoldUpdates()
  const [name, setName] = useState(exercise?.name ?? "")
  const [type, setType] = useState<ExerciseType>(exercise?.type ?? fixedType ?? "reps")
  const [unit, setUnit] = useState<ExerciseUnit>(exercise?.unit ?? "reps")
  // Rep-counted targets are now derived from focus at the block level (see
  // ExerciseEditorRow) — only a timed target still needs a coach-set default,
  // since a focus-driven rep range doesn't mean anything for a held duration.
  const [defaultSeconds, setDefaultSeconds] = useState(exercise?.unit === "seconds" ? exercise?.defaultReps ?? "" : "")
  const [defaultEdge, setDefaultEdge] = useState(exercise?.defaultEdge ?? "")
  const [defaultSeries, setDefaultSeries] = useState(String(exercise?.defaultSeries ?? 6))
  // Photo: either the existing remote URL, a freshly picked local uri (not yet
  // uploaded), or undefined once removed.
  const [photoUri, setPhotoUri] = useState<string | undefined>(exercise?.photoUri)
  const [notes, setNotes] = useState(exercise?.notes ?? "")
  const [movementType, setMovementType] = useState<MovementType | undefined>(exercise?.movementType as MovementType | undefined)
  const [loadMode, setLoadMode] = useState<LoadMode>(exercise?.loadMode ?? "weight")
  // Weight mode: smallest jump the load can make (kg). Blank = 0.5 kg.
  const [loadStepText, setLoadStepText] = useState(exercise?.loadStep ? String(exercise.loadStep) : "")
  // Adjustable setting (bench height, lean, box, band): only the coach's
  // hints are stored — the app doesn't measure it.
  const [hasSetting, setHasSetting] = useState(!!(exercise?.settingHarder || exercise?.settingEasier))
  const [settingHarder, setSettingHarder] = useState(exercise?.settingHarder ?? "")
  const [settingEasier, setSettingEasier] = useState(exercise?.settingEasier ?? "")
  // S&C focuses this exercise can be programmed for; none picked = all three.
  const [focuses, setFocuses] = useState<Focus[]>(exercise?.focuses ?? [])
  // Mobility has no focus or progression — just a target (default below).
  const isMobility = movementType === "mobility"
  const [defaultRepsText, setDefaultRepsText] = useState(exercise?.unit !== "seconds" ? exercise?.defaultReps ?? "" : "")
  // Mobility done by reps that can also be held (passive) — with its own
  // default hold. Stored as unit "reps" + defaultHold.
  const [bothWays, setBothWays] = useState(exercise?.unit !== "seconds" && !!exercise?.defaultHold)
  const [defaultHoldText, setDefaultHoldText] = useState(exercise?.defaultHold ?? "")
  const isBoth = isMobility && bothWays && unit === "reps"
  // Easier variations (shown above this exercise) and harder ones (below) —
  // together the full easiest -> hardest chain, split around this exercise's
  // own position in it. `harderLevels` is what actually gets persisted onto
  // this row (the existing "harder than me" convention); `easierLevels`
  // exists only to display/edit the other side, and is written back onto
  // whichever exercises it names by syncChainWithLibrary on save.
  const [easierLevels, setEasierLevels] = useState<LevelStep[]>([])
  const [harderLevels, setHarderLevels] = useState<LevelStep[]>(exercise?.levels ?? [])
  const [easierPickerOpen, setEasierPickerOpen] = useState(false)
  const [harderPickerOpen, setHarderPickerOpen] = useState(false)
  // Shown above the ladder: the stored data had two exercises on one step
  // (fixed by saving), or a picked exercise brought its own ladder along.
  const [forkWarning, setForkWarning] = useState(false)
  const [mergeNote, setMergeNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const measurable = type === "reps" || type === "both_sides"

  // A progression chain is only ever authored on one exercise's `levels`
  // field at a time, so opening a different member of the same chain (e.g.
  // a level that another exercise points to, or the exercise that points to
  // it) would otherwise show an empty list. Resolve the full chain across
  // the whole library so it shows up — and stays editable, in either
  // direction — from any member, not just whichever exercise it was
  // originally defined on.
  const [allExercises, setAllExercises] = useState<ExerciseRow[] | null>(null)
  useEffect(() => {
    listExercises().then(setAllExercises).catch(() => setAllExercises([]))
  }, [])
  useEffect(() => {
    if (!exercise || !allExercises) return
    const chain = resolveFullChain(exercise.$id, allExercises)
    if (chain.length <= 1) return
    const idx = chain.findIndex((l) => l.exerciseId === exercise.$id)
    setForkWarning(ladderHasFork(exercise.$id, allExercises))
    setLoadMode("level")
    setEasierLevels(idx <= 0 ? [] : chain.slice(0, idx))
    setHarderLevels(idx === -1 ? chain : chain.slice(idx + 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allExercises])

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to add an exercise photo.")
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.85,
    })
    if (result.canceled || !result.assets[0]) return
    setPhotoUri(result.assets[0].uri)
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert("Name required", "Please enter an exercise name.")
      return
    }
    setSaving(true)
    try {
      const payload: Parameters<typeof createExercise>[0] = { name: name.trim(), type }
      if (measurable) {
        payload.unit = unit
        if (unit === "seconds" && defaultSeconds.trim()) payload.defaultReps = defaultSeconds.trim()
        if (unit === "reps" && isMobility && defaultRepsText.trim()) payload.defaultReps = defaultRepsText.trim()
        if (isBoth && defaultHoldText.trim()) payload.defaultHold = defaultHoldText.trim()
        else if (exercise?.defaultHold) payload.defaultHold = ""
      } else {
        if (defaultEdge.trim()) payload.defaultEdge = defaultEdge.trim()
        const s = parseInt(defaultSeries)
        if (!isNaN(s) && s > 0) payload.defaultSeries = s
      }
      if (photoUri) {
        // Only upload if it's a freshly picked local file — an existing
        // photoUri is already a remote URL.
        payload.photoUri = photoUri.startsWith("http") ? photoUri : await uploadPhoto(photoUri)
      } else if (exercise?.photoUri) {
        // The photo was removed — clear it explicitly so the update persists that.
        payload.photoUri = ""
      }
      if (notes.trim()) {
        payload.notes = notes.trim()
      } else if (exercise?.notes) {
        payload.notes = ""
      }
      if (movementType) payload.movementType = movementType
      // Mobility doesn't progress: always weight mode, no level chain or focuses.
      const effectiveLoadMode: LoadMode = isMobility ? "weight" : loadMode
      payload.loadMode = effectiveLoadMode
      if (effectiveLoadMode === "level") payload.levels = harderLevels
      const loadStep = parseFloat(loadStepText.replace(",", "."))
      if (effectiveLoadMode === "weight" && loadStep > 0) payload.loadStep = loadStep
      else if (exercise?.loadStep) payload.loadStep = null
      if (!isMobility) payload.focuses = focuses
      else if (exercise?.focuses?.length) payload.focuses = []
      // Cleared ("") when switched off or emptied, like notes.
      const keepSetting = hasSetting && !isMobility
      const harder = keepSetting ? settingHarder.trim() : ""
      const easier = keepSetting ? settingEasier.trim() : ""
      if (harder || exercise?.settingHarder) payload.settingHarder = harder
      if (easier || exercise?.settingEasier) payload.settingEasier = easier
      const saved = exercise
        ? await updateExercise(exercise.$id, payload)
        : await createExercise(payload)
      if (effectiveLoadMode === "level" && allExercises) {
        const newFullChain: LevelStep[] = [...easierLevels, { exerciseId: saved.$id, name: saved.name }, ...harderLevels]
        await syncChainWithLibrary(saved.$id, newFullChain, exercise?.$id, allExercises)
      }
      invalidateExerciseLibrary()
      onCreated(saved)
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save exercise.")
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Pressable onPress={handleSave} disabled={saving} hitSlop={10}>
          <Text style={[styles.save, saving && { opacity: 0.4 }]}>{saving ? "Saving…" : saveLabel}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Pull-ups"
          placeholderTextColor="#aaa"
          value={name}
          onChangeText={setName}
          autoFocus
        />

        <Text style={styles.label}>Photo (optional)</Text>
        {photoUri ? (
          <View style={styles.photoPreviewWrap}>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <View style={styles.photoActions}>
              <Pressable onPress={handlePickPhoto} hitSlop={8}>
                <Text style={styles.photoActionText}>Change</Text>
              </Pressable>
              <Pressable onPress={() => setPhotoUri(undefined)} hitSlop={8}>
                <Text style={styles.photoActionTextRemove}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.photoAddBtn} onPress={handlePickPhoto}>
            <Text style={styles.photoAddBtnText}>+ Add photo</Text>
          </Pressable>
        )}

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          placeholder="Cues for correct form, e.g. keep elbows tucked, full range of motion…"
          placeholderTextColor="#aaa"
          value={notes}
          onChangeText={setNotes}
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.label}>Movement type (optional)</Text>
        <View style={styles.chipRow}>
          {MOVEMENT_TYPES.map((m) => (
            <Pressable
              key={m}
              style={[styles.chip, movementType === m && styles.chipActive]}
              onPress={() => setMovementType(movementType === m ? undefined : m)}
            >
              <Text style={[styles.chipText, movementType === m && styles.chipTextActive]}>
                {MOVEMENT_TYPE_LABEL[m]}
              </Text>
            </Pressable>
          ))}
        </View>

        {!isMobility && (
        <>
        <Text style={styles.label}>Used for</Text>
        <Text style={styles.levelsHint}>
          Which S&C focuses this exercise can be programmed for in a training plan. None picked = all three.
        </Text>
        <View style={styles.chipRow}>
          {FOCUSES.map((f) => {
            const on = focuses.includes(f)
            return (
              <Pressable
                key={f}
                style={[styles.chip, on && styles.chipActive]}
                onPress={() => setFocuses((prev) => (on ? prev.filter((x) => x !== f) : [...prev, f]))}
              >
                <Text style={[styles.chipText, on && styles.chipTextActive]}>{FOCUS_LABEL[f]}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.label}>How does it get harder?</Text>
        <View style={styles.chipRow}>
          {(["weight", "level"] as LoadMode[]).map((m) => (
            <Pressable
              key={m}
              style={[styles.chip, loadMode === m && styles.chipActive]}
              onPress={() => setLoadMode(m)}
            >
              <Text style={[styles.chipText, loadMode === m && styles.chipTextActive]}>
                {m === "weight" ? "Add weight" : "Harder version"}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.levelsHint}>
          {loadMode === "weight"
            ? "Same exercise, more weight — e.g. goblet squat with a heavier kettlebell."
            : "Swap to a harder exercise — e.g. knee push-up → push-up → archer push-up."}
        </Text>

        {loadMode === "weight" && (
          <>
            <Text style={styles.label}>Smallest weight jump (kg)</Text>
            <Text style={styles.levelsHint}>
              How much the weight goes up or down at minimum, e.g. 2 for kettlebells, 2.5 for a barbell. Blank = 0.5 kg. Changes are never more than 2.5 kg at once, unless this jump is bigger.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="0.5"
              placeholderTextColor="#aaa"
              keyboardType="decimal-pad"
              value={loadStepText}
              onChangeText={setLoadStepText}
            />
          </>
        )}

        {loadMode === "level" && (() => {
          // One ladder, easiest at the top. Athletes move one step down it
          // after a round under the minimum reps, and one step up next
          // session after hitting the top of the range on every set.
          const ladder: LevelStep[] = [...easierLevels, { exerciseId: SELF_ID, name: name.trim() || "This exercise" }, ...harderLevels]
          const setLadder = (next: LevelStep[]) => {
            const { easier, harder } = splitLadder(next)
            setEasierLevels(easier)
            setHarderLevels(harder)
          }
          const move = (i: number, dir: -1 | 1) => {
            const j = i + dir
            if (j < 0 || j >= ladder.length) return
            const next = [...ladder]
            ;[next[i], next[j]] = [next[j], next[i]]
            setLadder(next)
          }
          const remove = (i: number) => setLadder(ladder.filter((_, k) => k !== i))
          // A ladder is one line — never two exercises on one step. Picking
          // an exercise that already has a ladder joins the two (see
          // mergeIntoLadder); the coach checks the order before saving.
          const addToLadder = (ex: ExerciseRow, side: "easier" | "harder") => {
            const picked: LevelStep = { exerciseId: ex.$id, name: ex.name }
            const pickedChain = allExercises ? resolveFullChain(ex.$id, allExercises) : []
            setLadder(mergeIntoLadder(ladder, SELF_ID, picked, pickedChain, side))
            const others = pickedChain.filter((l) => l.exerciseId !== ex.$id && !ladder.some((m) => m.exerciseId === l.exerciseId))
            setMergeNote(others.length
              ? `${ex.name} was already in a ladder, so it came along: ${others.map((l) => l.name).join(", ")}. Check the order, then save.`
              : null)
          }
          const alone = ladder.length === 1
          return (
          <>
            <Text style={styles.label}>Progression ladder</Text>
            <Text style={styles.levelsHint}>
              Easiest at the top. Athletes go one step down when they miss the minimum reps, and one step up
              when they hit the top of the range on every set. The same ladder shows on every exercise in it.
            </Text>

            {forkWarning && (
              <View style={[styles.ladderNote, styles.ladderNoteWarn]}>
                <Ionicons name="warning-outline" size={16} color={C.yellow} />
                <Text style={styles.ladderNoteText}>
                  {"Two exercises were saved on the same step of this ladder. They're shown in one line below — check the order and save to fix it for every exercise in the ladder."}
                </Text>
              </View>
            )}
            {!!mergeNote && (
              <View style={styles.ladderNote}>
                <Ionicons name="git-merge-outline" size={16} color={C.green} />
                <Text style={styles.ladderNoteText}>{mergeNote}</Text>
              </View>
            )}

            <Pressable style={styles.ladderAddBtn} onPress={() => setEasierPickerOpen(true)}>
              <Ionicons name="add" size={16} color={C.green} />
              <Text style={styles.levelPickBtnText}>Add an easier version</Text>
            </Pressable>

            <View style={styles.ladder}>
              {ladder.map((lvl, i) => {
                const isSelf = lvl.exerciseId === SELF_ID
                const tag = alone ? null : i === 0 ? "Easiest" : i === ladder.length - 1 ? "Hardest" : null
                return (
                  <View key={lvl.exerciseId}>
                    {i > 0 && <View style={styles.ladderConnector} />}
                    <View style={[styles.ladderRow, isSelf && styles.ladderRowSelf]}>
                      <View style={[styles.ladderStep, isSelf && styles.ladderStepSelf]}>
                        <Text style={[styles.ladderStepText, isSelf && styles.ladderStepTextSelf]}>{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.levelName, isSelf && styles.ladderNameSelf]} numberOfLines={1}>{lvl.name}</Text>
                        {(isSelf || tag) && (
                          <Text style={styles.ladderTag}>{[isSelf ? "This exercise" : null, tag].filter(Boolean).join(" · ")}</Text>
                        )}
                      </View>
                      {!alone && (
                        <>
                          <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={8} style={styles.ladderIconBtn}>
                            <Ionicons name="chevron-up" size={18} color={i === 0 ? C.textMuted : C.textSecondary} />
                          </Pressable>
                          <Pressable onPress={() => move(i, 1)} disabled={i === ladder.length - 1} hitSlop={8} style={styles.ladderIconBtn}>
                            <Ionicons name="chevron-down" size={18} color={i === ladder.length - 1 ? C.textMuted : C.textSecondary} />
                          </Pressable>
                        </>
                      )}
                      {!isSelf && (
                        <Pressable onPress={() => remove(i)} hitSlop={8} style={styles.ladderIconBtn}>
                          <Ionicons name="close" size={18} color={C.red} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                )
              })}
            </View>

            <Pressable style={styles.ladderAddBtn} onPress={() => setHarderPickerOpen(true)}>
              <Ionicons name="add" size={16} color={C.green} />
              <Text style={styles.levelPickBtnText}>Add a harder version</Text>
            </Pressable>
            {alone && (
              <Text style={styles.levelsHint}>Add at least one easier or harder version to make a ladder.</Text>
            )}

            <LevelExercisePicker
              visible={easierPickerOpen}
              type={type}
              title="Pick an easier version"
              excludeIds={[...easierLevels.map((l) => l.exerciseId), ...harderLevels.map((l) => l.exerciseId), ...(exercise ? [exercise.$id] : [])]}
              onSelect={(ex) => { addToLadder(ex, "easier"); setEasierPickerOpen(false) }}
              onClose={() => setEasierPickerOpen(false)}
            />
            <LevelExercisePicker
              visible={harderPickerOpen}
              type={type}
              title="Pick a harder version"
              excludeIds={[...easierLevels.map((l) => l.exerciseId), ...harderLevels.map((l) => l.exerciseId), ...(exercise ? [exercise.$id] : [])]}
              onSelect={(ex) => { addToLadder(ex, "harder"); setHarderPickerOpen(false) }}
              onClose={() => setHarderPickerOpen(false)}
            />
          </>
          )
        })()}

        <Text style={styles.label}>Exercise setup</Text>
        <Text style={styles.levelsHint}>
          {"For exercises made harder or easier by how they're set up — bench height, how far you lean, box height, band. The app doesn't measure it: the athlete follows your hints and says when they're on the hardest setup."}
        </Text>
        <View style={styles.chipRow}>
          {[false, true].map((on) => (
            <Pressable
              key={String(on)}
              style={[styles.chip, hasSetting === on && styles.chipActive]}
              onPress={() => setHasSetting(on)}
            >
              <Text style={[styles.chipText, hasSetting === on && styles.chipTextActive]}>
                {on ? "Adjustable setup" : "Fixed setup"}
              </Text>
            </Pressable>
          ))}
        </View>
        {hasSetting && (
          <>
            <Text style={styles.label}>How to make it harder</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Lower the bench"
              placeholderTextColor="#aaa"
              value={settingHarder}
              onChangeText={setSettingHarder}
            />
            <Text style={styles.label}>How to make it easier</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Raise the bench"
              placeholderTextColor="#aaa"
              value={settingEasier}
              onChangeText={setSettingEasier}
            />
          </>
        )}
        </>
        )}

        {!fixedType && (
          <>
            {/* Only the special cases are picked — no selection means a plain reps exercise. */}
            <Text style={styles.label}>Type (optional)</Text>
            <View style={styles.chipRow}>
              {(["both_sides", "7/3s"] as ExerciseType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.chip, type === t && styles.chipActive]}
                  onPress={() => setType(type === t ? "reps" : t)}
                >
                  <Text style={[styles.chipText, type === t && styles.chipTextActive]}>
                    {TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {measurable && (
          <>
            <Text style={styles.label}>Measure</Text>
            <View style={styles.chipRow}>
              {(["reps", "seconds"] as ExerciseUnit[]).map((u) => {
                const on = unit === u && !isBoth
                return (
                  <Pressable
                    key={u}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() => { setUnit(u); setBothWays(false) }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>
                      {u === "reps" ? "Reps" : isMobility ? "Hold (seconds)" : "Seconds"}
                    </Text>
                  </Pressable>
                )
              })}
              {isMobility && (
                <Pressable
                  style={[styles.chip, isBoth && styles.chipActive]}
                  onPress={() => { setUnit("reps"); setBothWays(true) }}
                >
                  <Text style={[styles.chipText, isBoth && styles.chipTextActive]}>Both</Text>
                </Pressable>
              )}
            </View>
            {isMobility && (
              <Text style={styles.levelsHint}>
                Held = passive (used between strength exercises), reps = active (used in the mobility block).
              </Text>
            )}

            {unit === "reps" && isMobility && (
              <>
                <Text style={styles.label}>Default reps (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 10"
                  placeholderTextColor="#aaa"
                  value={defaultRepsText}
                  onChangeText={setDefaultRepsText}
                />
              </>
            )}
            {isBoth && (
              <>
                <Text style={styles.label}>Default hold, seconds (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 30"
                  placeholderTextColor="#aaa"
                  value={defaultHoldText}
                  onChangeText={setDefaultHoldText}
                />
              </>
            )}

            {unit === "seconds" && (
              <>
                <Text style={styles.label}>Default seconds (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 20-30"
                  placeholderTextColor="#aaa"
                  value={defaultSeconds}
                  onChangeText={setDefaultSeconds}
                />
              </>
            )}
          </>
        )}

        {type === "7/3s" && (
          <>
            <Text style={styles.label}>Default edge size (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 20mm"
              placeholderTextColor="#aaa"
              value={defaultEdge}
              onChangeText={setDefaultEdge}
            />
            <Text style={styles.label}>Default series</Text>
            <TextInput
              style={styles.input}
              placeholder="6"
              placeholderTextColor="#aaa"
              value={defaultSeries}
              onChangeText={setDefaultSeries}
              keyboardType="numeric"
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// Picks a library exercise to use as a progression level. Scoped to the same
// exercise type (a "reps" chain shouldn't offer a 7/3s hang as a step) and
// excludes anything already in the list plus the exercise being edited
// itself, so a chain can't reference its own row. Doesn't offer inline
// creation — if the step doesn't exist yet, create it in the library first.
function LevelExercisePicker({ visible, type, title = "Pick a level", excludeIds, onSelect, onClose }: {
  visible: boolean
  type: ExerciseType
  title?: string
  excludeIds: string[]
  onSelect: (ex: ExerciseRow) => void
  onClose: () => void
}) {
  const [exercises, setExercises] = useState<ExerciseRow[] | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!visible) return
    listExercises().then(setExercises).catch(() => setExercises([]))
  }, [visible])

  const query = search.trim().toLowerCase()
  const options = (exercises ?? []).filter((ex) =>
    ex.type === type && !excludeIds.includes(ex.$id) && (!query || ex.name.toLowerCase().includes(query))
  )

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <View style={{ width: 50 }} />
        </View>
        <View style={{ padding: 20, paddingBottom: 0 }}>
          <TextInput
            style={styles.input}
            placeholder="Search exercises"
            placeholderTextColor="#aaa"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        {exercises === null ? (
          <ActivityIndicator style={{ marginTop: 30 }} />
        ) : (
          <ScrollView contentContainerStyle={styles.form}>
            {options.length === 0 ? (
              <Text style={styles.levelsHint}>
                {query ? `No matches for "${search.trim()}".` : "No other exercises of this type yet — create one in the library first."}
              </Text>
            ) : (
              options.map((ex) => (
                <Pressable key={ex.$id} style={styles.levelPickRow} onPress={() => onSelect(ex)}>
                  <Text style={styles.levelPickRowText}>{ex.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
                </Pressable>
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  cancel: { fontSize: 16, color: C.textSecondary },
  title: { fontSize: 17, fontWeight: "700", color: C.textPrimary, flex: 1, textAlign: "center", marginHorizontal: 12 },
  save: { fontSize: 16, color: C.green, fontWeight: "700" },
  form: { padding: 20 },
  label: { fontSize: 13, fontWeight: "600", color: C.textSecondary, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: C.textPrimary, borderWidth: 1, borderColor: C.border,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  chipTextActive: { color: C.bg },
  photoAddBtn: {
    borderWidth: 1, borderColor: C.border, borderStyle: "dashed", borderRadius: 10,
    paddingVertical: 16, alignItems: "center", backgroundColor: C.surface,
  },
  photoAddBtnText: { fontSize: 14, fontWeight: "600", color: C.textSecondary },
  photoPreviewWrap: { flexDirection: "row", alignItems: "center", gap: 14 },
  photoPreview: { width: 84, height: 84, borderRadius: 10, backgroundColor: C.surface },
  photoActions: { gap: 10 },
  photoActionText: { fontSize: 14, fontWeight: "600", color: C.green },
  photoActionTextRemove: { fontSize: 14, fontWeight: "600", color: C.red },
  notesInput: { minHeight: 90 },
  levelsHint: { fontSize: 12, color: C.textMuted, marginTop: -2, marginBottom: 8 },
  levelRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  levelName: { flex: 1, fontSize: 14, color: C.textPrimary },
  selfRow: {
    backgroundColor: C.surface, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10,
    marginVertical: 4,
  },
  selfRowText: { fontSize: 14, fontWeight: "700", color: C.textPrimary },
  levelPickBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1, borderColor: C.border, borderStyle: "dashed", borderRadius: 10,
    paddingVertical: 12, marginTop: 10,
  },
  ladder: { marginVertical: 6 },
  ladderRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  ladderRowSelf: { borderColor: C.green, backgroundColor: "rgba(111,207,151,0.10)" },
  ladderStep: {
    width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: C.surfaceHigh,
  },
  ladderStepSelf: { backgroundColor: C.green },
  ladderStepText: { fontSize: 13, fontWeight: "800", color: C.textSecondary },
  ladderStepTextSelf: { color: C.bg },
  ladderNameSelf: { fontWeight: "800" },
  ladderTag: { fontSize: 11, fontWeight: "700", color: C.green, letterSpacing: 0.3, marginTop: 2, textTransform: "uppercase" },
  ladderConnector: { width: 2, height: 10, backgroundColor: C.border, marginLeft: 24 },
  ladderIconBtn: { padding: 4 },
  ladderNote: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderWidth: 1, borderColor: C.green, borderRadius: 12, padding: 10, marginBottom: 6 },
  ladderNoteWarn: { borderColor: C.yellow },
  ladderNoteText: { flex: 1, fontSize: 13, lineHeight: 18, color: C.textPrimary },
  ladderAddBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10 },
  levelPickBtnText: { fontSize: 14, fontWeight: "600", color: C.green },
  levelPickRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  levelPickRowText: { fontSize: 15, color: C.textPrimary },
})
