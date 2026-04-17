import { Text, View, Button, StyleSheet, TextInput, } from "react-native"
import { useState, useEffect,useRef} from "react"
import { TimerDisplay } from "./timerDisplay"
import WheelPicker from '@quidone/react-native-wheel-picker';
import { BoulderLevelOptions } from "@/components/logBoulderModal";
import CustomButton from "@/components/customButton";
import { SafeAreaView } from "react-native-safe-area-context";
import { AnimatedCircularProgress } from 'react-native-circular-progress'
import VideoRecorder from "@/components/VideoRecorder";
import { saveVideoLocally } from "./saveVideo";
export function BlockRenderer({
  block,
  attemptsDone,
  logAttempt,
  timeRemaining,
  restTimeRemaining,
  startRestTimer,
  attempts,
  currentBlockIndex,
  goToNextBlock,
}: any) {
  if (!block) return null

  const blockAttempts = attempts.filter(
    (a: any) => a.blockIndex === currentBlockIndex
  )

  switch (block.type) {
    case "project_bouldering":
      return (
        <ProjectBlock
          block={block}
          attemptsDone={attemptsDone}
          logAttempt={logAttempt}
          restTimeRemaining={restTimeRemaining}
          startRestTimer={startRestTimer}
          attempts={blockAttempts} // ✅ FIXED
          goToNextBlock={goToNextBlock} // ✅ NEW
        />
      )

    case "constraint_warmup":
  return (
    <ConstraintWarmupBlock
      block={block}
      attemptsDone={attemptsDone}
      logAttempt={logAttempt}
      attempts={blockAttempts}     // ← add this
      goToNextBlock={goToNextBlock}  // ← and this
    />
  )

    default:
      return <Text>Unknown block</Text>
  }
}

function ConstraintWarmupBlock({ block, attemptsDone, logAttempt, attempts, goToNextBlock }: any) {
  const [phase, setPhase] = useState("intro")
  const [showCamera, setShowCamera] = useState(false)

  const targetAttempts = block.targetAttempts ?? 1

  function handleFinishRecording(videoUri: string) {
    setShowCamera(false)
    saveVideoLocally(videoUri)
    logAttempt({
      success: true,
      video: videoUri,
    })

    const nextCount = attemptsDone + 1
    if (nextCount >= targetAttempts) {
      setPhase("review")
    }
  }

  // ---------------- INTRO ----------------
  if (phase === "intro") {
    return (
      <SafeAreaView>
        <Text style={styles.title}> {block.type}</Text>
        <Text>{block.description}</Text>
        <CustomButton
          title="Start"
          onPress={() => setPhase("ready")}
        />
      </SafeAreaView>
    )
  }

  // ---------------- READY ----------------
  if (phase === "ready") {
    return (
      <View style={styles.container}>
        <Text style={styles.level}>{block.constraint}</Text>

        <Text style={styles.progress}>
          {attemptsDone} / {targetAttempts}
        </Text>

        <View style={styles.buttonWrapper}>
          <CustomButton
            title="Record Attempt"
            onPress={() => setShowCamera(true)}
          />
        </View>

        {showCamera && (
          <View style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "black",
          }}>
            <VideoRecorder
              onFinish={handleFinishRecording}
            />
          </View>
        )}
      </View>
    )
  }

  // ---------------- REVIEW ----------------
  if (phase === "review") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Warmup Review</Text>

        {attempts.map((a: any, i: number) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <Text>Attempt {i + 1}</Text>
          </View>
        ))}

        <CustomButton title="Continue" onPress={goToNextBlock} />
      </View>
    )
  }

  return null
}
function ProjectBlock({
  block,
  attemptsDone,
  logAttempt,
  restTimeRemaining,
  startRestTimer,
  attempts,
  goToNextBlock,
}: any) {
  const [phase, setPhase] = useState("intro")
  const [selectedLevel, setSelectedLevel] = useState(BoulderLevelOptions[2].value)
  const [success, setSuccess] = useState<boolean | null>(null)
  const [notes, setNotes] = useState("")

  const targetAttempts = block.targetAttempts ?? 1

  useEffect(() => {
    if (phase === "rest" && restTimeRemaining === 0) {
      handleSaveAndContinue()
    }
  }, [restTimeRemaining])

  function handleSaveAndContinue() {
    if (success === null) return
    if (success === false && notes.trim() === "") return

    logAttempt({
      success,
      notes,
      level: selectedLevel,
    })

    const nextCount = attemptsDone + 1
    const reachedLimit = nextCount >= targetAttempts
    const sent = success === true && block.exitBySuccess

    setSuccess(null)
    setNotes("")

    if (reachedLimit || sent) {
      setPhase("review")
    } else {
      setPhase("ready")
    }
  }

  // ---------------- INTRO ----------------
  if (phase === "intro") {
    return (
      <SafeAreaView>
        <Text style={styles.title}>Project Bouldering</Text>
        <Text style={styles.description}>{block.description}</Text>

        <WheelPicker
          data={BoulderLevelOptions}
          value={selectedLevel}
          onValueChanged={({ item: { value } }) => setSelectedLevel(value)}
          itemHeight={30}
        />

        <CustomButton
          title="Start Project"
          onPress={() => setPhase("ready")}
        />
      </SafeAreaView>
    )
  }

  // ---------------- READY ----------------
  if (phase === "ready") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>project - {selectedLevel}</Text>

        <Text style={styles.progressValue}>{attemptsDone}</Text>

        <CustomButton
          title="Log Attempt"
          onPress={() => {
            startRestTimer(block.restTime ?? 120)
            setPhase("rest")
          }}
        />
      </View>
    )
  }

  // ---------------- REST ----------------
  if (phase === "rest") {
    return (
      <View style={styles.container}>
        <Text style={styles.restTitle}>Rest</Text>

        <AnimatedCircularProgress
          size={250}
          width={10}
          fill={
            restTimeRemaining && block.restTime
              ? (restTimeRemaining / block.restTime) * 100
              : 0
          }
          tintColor="#25343F"
          backgroundColor="#e6e6e6"
        >
          {() => (
            <Text style={styles.timer}>
              {restTimeRemaining > 0 ? `${restTimeRemaining}s` : "time's up"}
            </Text>
          )}
        </AnimatedCircularProgress>

        <Text>Did you send?</Text>

        <CustomButton
          title="Yes"
          onPress={() => {
            setSuccess(true)
            handleSaveAndContinue()
          }}
        />

        <CustomButton
          title="No"
          onPress={() => setSuccess(false)}
        />

        {success === false && (
          <>
            <TextInput
              placeholder="What went wrong?"
              value={notes}
              onChangeText={setNotes}
              style={styles.input}
            />

            <CustomButton
              title="Save"
              onPress={handleSaveAndContinue}
            />
          </>
        )}
      </View>
    )
  }

  // ---------------- REVIEW ----------------
  if (phase === "review") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Project Review</Text>

        {attempts.map((a: any, i: number) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <Text>
              Attempt {i + 1} — {a.success ? "✅" : "❌"}
            </Text>
            {a.notes ? <Text>{a.notes}</Text> : null}
          </View>
        ))}

        <CustomButton title="Continue" onPress={goToNextBlock} />
      </View>
    )
  }

  return null
}

const styles = StyleSheet.create({
timerInner: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
},
  container: {
    flex:1,
    width: "100%",
    padding: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 10,
  },
  card: {
  width: "100%",
  padding: 20,
  borderRadius: 16,
  backgroundColor: "#f2f2f2",
  marginBottom: 30,
},

label: {
  fontSize: 14,
  opacity: 0.6,
  marginBottom: 10,
  textAlign: "center",
},

footer: {
  width: "100%",
  marginTop: "auto",
},
  level: {
    fontSize: 20,
    fontWeight: "500",
    marginBottom: 5,
    textTransform: "capitalize",
  },
  description: {
    fontSize: 16,
    textAlign: "center",
    marginVertical: 10,
    lineHeight: 22,
  },
  progress: {
    fontSize: 18,
    fontWeight: "500",
    marginVertical: 10,
  },
  buttonWrapper: {
    marginTop: 15,
    width: "100%",
  },
  placeholder: {
    fontSize: 16,
    opacity: 0.6,
    textAlign: "center",
  },
  progressContainer: {
  alignItems: "center",
  marginBottom: 40,
},

progressLabel: {
  fontSize: 14,
  opacity: 0.6,
},

progressValue: {
  fontSize: 48,
  fontWeight: "700",
  marginTop: 5,
},
restTitle: {
  fontSize: 22,
  fontWeight: "600",
  textAlign: "center",
  marginBottom: 10,
},

timer: {
  fontSize: 48,
  fontWeight: "700",
  textAlign: "center",
  marginBottom: 30,
},

question: {
  fontSize: 18,
  textAlign: "center",
  marginBottom: 20,
},

buttonGroup: {
  width: "100%",
  color: "#635555",
  gap: 20,
  flexDirection: "row",
  marginBottom: 20,
},

notesContainer: {
  width: "100%",
  marginTop: 10,
  gap: 10,
},

notesLabel: {
  fontSize: 14,
  opacity: 0.6,
},

input: {
  borderWidth: 1,
  borderColor: "#ddd",
  borderRadius: 10,
  padding: 10,
  color: "black"
  
},
safeContainer: {
  flex: 1,
  padding: 20,
},

topSection: {
  alignItems: "center",
  marginBottom: 20,
},

middleSection: {
  flex: 1,
  justifyContent: "center", // keeps picker nicely centered
},

bottomSection: {
    flex:1,
  paddingBottom: 20,
},
})