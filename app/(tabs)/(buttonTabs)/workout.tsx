import React from "react"
import { View, Text, Button, StyleSheet } from "react-native"
import { useWorkout } from "../../../hooks/WorkoutHook" // adjust path
import { getProtocol } from "../../../services/protocols" // adjust path
import {BlockRenderer} from "../../../utils/blockRenderer"
import CustomButton from "@/components/customButton"
import { Pressable } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
export default function WorkoutScreen() {
  const {
    currentBlock,
    attemptsDone,
    status,
    timeRemaining,
    restTimeRemaining,
    logAttempt,
    startWorkout,
    startRestTimer,
    currentBlockIndex,
    totalBlocks,
    resetWorkout,
    goToNextBlock,
    attempts,
  } = useWorkout(getProtocol)


if (status === "idle") {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>training protocols</Text>

      <Pressable style={styles.card} onPress={startWorkout}>
        <Text style={styles.cardTitle}>{currentBlock.type}</Text>
        <Text style={styles.cardSubtitle}>
          Tap to start workout
        </Text>
      </Pressable>
    </SafeAreaView>
  )
}

  if (status === "completed") {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Workout Complete 🎉</Text>
        <CustomButton 
            title="go to workouts"
          onPress={resetWorkout}/>
      </SafeAreaView>
    )
  }
  // RUNNING STATE
  return (
    <SafeAreaView style={styles.container}>
        
        <BlockRenderer
          block={currentBlock}
          attemptsDone={attemptsDone}
          logAttempt={logAttempt}
          timeRemaining={timeRemaining}
          restTimeRemaining={restTimeRemaining}
          startRestTimer={startRestTimer}
          attempts={attempts}
          currentBlockIndex={currentBlockIndex}
          goToNextBlock={goToNextBlock}
        />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
card: {
  width: "100%",
  padding: 20,
  borderRadius: 16,
  backgroundColor: "#25343F",
  marginTop: 20,

  // shadow (iOS)
  shadowColor: "#000",
  shadowOpacity: 0.2,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },

  // elevation (Android)
  elevation: 5,
},

cardTitle: {
  fontSize: 18,
  fontWeight: "bold",
  color: "white",
  marginBottom: 6,
},

cardSubtitle: {
  fontSize: 14,
  color: "#aaa",
},
  container: {
    flex: 1,
    
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  blockIndex: {
    fontSize: 14,
    marginBottom: 10,
    opacity: 0.6,
  },
  title: {
  fontSize: 28,
  fontWeight: "700",
  color: "#111", // or "white" if dark background
  letterSpacing: 0.5,
  marginBottom: 20,
},
  description: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
  },
  progress: {
    fontSize: 20,
    marginBottom: 20,
  },
  buttons: {
    gap: 10,
  },
})

