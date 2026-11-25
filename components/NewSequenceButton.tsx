import { paperSheet, useC, useSheet } from "@/theme/paper/legacy"
import { CreateSequenceModal } from "@/components/AthleteSequenceCreator"
import { useAuth } from "@/components/auth-context"
import { useWorkoutContext } from "@/contexts/WorkoutContext"
import { SprayRouteRow } from "@/services/BoulderGraphService"
import { MintButton } from "@/components/paper"
import { Ionicons } from "@expo/vector-icons"
import { useState } from "react"
import { Alert, Pressable, StyleSheet, Text } from "react-native"

// "+ Sequence" in the home screen's header: build a sequence, then try it
// now or find it later in Settings › My sequences.
// `paper`: the Paper Mint small mint button (redesigned screens).
export function NewSequenceButton({ paper }: { paper?: boolean } = {}) {
  const C = useC()
  const styles = useSheet(stylesSheet)
  const { User } = useAuth()
  const workoutCtx = useWorkoutContext()
  const [open, setOpen] = useState(false)

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

  return (
    <>
      {paper ? (
        <MintButton compact icon="add" label="Sequence" onPress={() => setOpen(true)} />
      ) : (
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
          hitSlop={6}
        >
          <Ionicons name="add" size={16} color={C.green} />
          <Text style={styles.text}>Sequence</Text>
        </Pressable>
      )}
      {User && (
        <CreateSequenceModal
          visible={open}
          athleteId={User.$id}
          editing={null}
          onClose={() => setOpen(false)}
          onSaved={(route) => {
            Alert.alert("Sequence saved", "Find it any time in Settings › My sequences.", [
              { text: "OK", style: "cancel" },
              { text: "Try it now", onPress: () => tryOut(route) },
            ])
          }}
        />
      )}
    </>
  )
}

const stylesSheet = paperSheet((C) => StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.green,
  },
  text: { fontSize: 13, fontWeight: "600", color: C.green },
}))
