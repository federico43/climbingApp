import { Body, Card, CardTitle, IconButton, IconCircle, Melt, Mono, PaperBackground, PosterHeadline, PrimaryCTA, TextButton, usePaper } from "@/components/paper"
import { space } from "@/theme/paper/tokens"
import { explorationFocusSlides } from "@/utils/routeExploration"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useState } from "react"
import { Modal, View } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"

// Route exploration's "why" (coach 2026-11-12): full-screen Paper Mint
// slides, same look as the S&C basics (components/ConditioningBasics.tsx).
// Exploration needs focus; the 2 min of breathing help the athlete
// concentrate on each move and not on the thoughts while they climb. Shown
// by itself the first time an athlete opens a route exploration with the
// warm-up and breathing; the block's "Why breathe?" link opens it again.

type IconName = React.ComponentProps<typeof Ionicons>["name"]

const SEEN_KEY = "feature-intro-seen:exploration-focus"

export interface ExplorationMinutes { warmup: number; breathing: number; flash: number; project: number }

// Whether this athlete hasn't seen the slides yet on this phone.
export function useExplorationFocusFirstTime(): boolean {
  const [first, setFirst] = useState(false)
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(SEEN_KEY).then((v) => { if (!cancelled && v !== "1") setFirst(true) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return first
}

export function ExplorationFocusSlides({ visible, minutes, onClose }: { visible: boolean; minutes: ExplorationMinutes; onClose: () => void }) {
  const t = usePaper()
  const [i, setI] = useState(0)
  const slides = explorationFocusSlides(minutes)

  useEffect(() => { if (visible) setI(0) }, [visible])

  const close = () => {
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {})
    onClose()
  }
  const slide = slides[Math.min(i, slides.length - 1)]
  const last = i >= slides.length - 1
  const num = (n: number) => String(n).padStart(2, "0")

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {/* A modal is its own native window: it needs its own safe-area provider. */}
      <SafeAreaProvider>
        <PaperBackground>
          <SafeAreaView style={{ flex: 1, paddingHorizontal: space.gutter }} edges={["top", "bottom"]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8 }}>
              <Mono>Route exploration · {num(i + 1)} / {num(slides.length)}</Mono>
              <IconButton icon="close" label="Close" onPress={close} />
            </View>

            <View style={{ marginTop: 28 }}>
              <Melt top={20} height={380} />
              <PosterHeadline>{slide.poster}</PosterHeadline>
            </View>

            <View style={{ flex: 1, justifyContent: "flex-end", paddingBottom: 20 }}>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <IconCircle icon={slide.icon as IconName} size={40} />
                  <CardTitle size={26} style={{ flex: 1 }}>{slide.title}</CardTitle>
                </View>
                <Body size={17} weight={600} muted style={{ lineHeight: 24 }}>{slide.text}</Body>
              </Card>

              <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", marginTop: 20 }}>
                {slides.map((_, n) => (
                  <View
                    key={n}
                    style={{
                      height: 6, borderRadius: 3, width: n === i ? 22 : 6,
                      backgroundColor: n <= i ? t.mintDeep : t.ringIdle,
                    }}
                  />
                ))}
              </View>
            </View>

            <PrimaryCTA
              label={last ? "Let's climb" : "Next"}
              icon={last ? "checkmark" : "arrow-forward"}
              onPress={() => (last ? close() : setI(i + 1))}
            />
            <View style={{ alignItems: "center", paddingVertical: 12, minHeight: 44 }}>
              {i > 0 && <TextButton label="Back" onPress={() => setI(i - 1)} />}
            </View>
          </SafeAreaView>
        </PaperBackground>
      </SafeAreaProvider>
    </Modal>
  )
}
