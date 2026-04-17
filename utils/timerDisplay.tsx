import { View, StyleSheet, Text } from "react-native"

export function TimerDisplay({ timeRemaining, totalTime }: any) {
  const progress =
    timeRemaining && totalTime
      ? timeRemaining / totalTime
      : 0

  return (
    <View style={styles.timerContainer}>
      <Text style={styles.timerText}>
        {formatTime(timeRemaining)}
      </Text>

      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            { width: `${progress * 100}%` },
          ]}
        />
      </View>
    </View>
  )
}

function formatTime(seconds: number | null) {
  if (seconds === null) return "--:--"

  const m = Math.floor(seconds / 60)
  const s = seconds % 60

  return `${m}:${s.toString().padStart(2, "0")}`
}

const styles = StyleSheet.create({
    timerContainer: {
  alignItems: "center",
  marginVertical: 20,
  width: "100%",
},

timerText: {
  fontSize: 48,
  fontWeight: "bold",
  marginBottom: 10,
},

progressBar: {
  width: "100%",
  height: 10,
  backgroundColor: "#eee",
  borderRadius: 5,
  overflow: "hidden",
},

progressFill: {
  height: "100%",
  backgroundColor: "#4CAF50",
},
})