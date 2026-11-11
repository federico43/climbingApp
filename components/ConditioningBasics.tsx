import { Body, Card, CardTitle, GhostButton, IconButton, IconCircle, Melt, Mono, PaperBackground, PosterHeadline, PrimaryCTA, TextButton, usePaper } from "@/components/paper"
import { space } from "@/theme/paper/tokens"
import { spreadSlideText, type Weekday } from "@/utils/extraSession"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useState } from "react"
import { Modal, View } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"

// Conditioning basics (coach 2026-11-11): full-screen Paper Mint slides that
// teach the athlete what matters in S&C — close to failure, full range, no
// pain, consistency, and spreading it over the week (with their own gym days
// and the extra session's days, utils/extraSession.ts). Shown once on the
// Plan page of a plan with S&C; the "How to train S&C" card opens it again.

type IconName = React.ComponentProps<typeof Ionicons>["name"]

export interface BasicsSlide {
  poster: string // the slide's poster word(s)
  icon: IconName
  title: string
  text: string
}

// Same key FeatureIntro used, so whoever saw the first version isn't shown it again.
const SEEN_KEY = "feature-intro-seen:conditioning-basics"
const openers = new Set<() => void>()

export function conditioningSlides(gymDays: Weekday[]): BasicsSlide[] {
  return [
    {
      poster: "The rules",
      icon: "barbell",
      title: "Conditioning, done right",
      text: "Strength and conditioning make you a stronger climber and keep injuries away. A few rules make every session count.",
    },
    {
      poster: "Failure",
      icon: "flame",
      title: "Get close to failure",
      text: "End each set with only 1 or 2 good reps left. If the last reps feel easy, it's time for more weight or reps. That's what makes you stronger.",
    },
    {
      poster: "Full range",
      icon: "resize",
      title: "Use the full range",
      text: "All the way down and all the way up, on every rep. If you can't, lower the weight before you cut the movement short.",
    },
    {
      poster: "No pain",
      icon: "medkit",
      title: "It shouldn't hurt",
      text: "Burning muscles and being tired are normal. Sharp pain or pain in a joint is not: stop that exercise and tell your coach.",
    },
    {
      poster: "Every week",
      icon: "repeat",
      title: "Be consistent",
      text: "Strength builds slowly, session after session. Doing every workout beats a perfect one now and then.",
    },
    {
      poster: "Spread it",
      icon: "calendar",
      title: "Spread it over the week",
      text: spreadSlideText(gymDays),
    },
  ]
}

// Opens the slides again (the "How to train S&C" card).
export function openConditioningBasics() {
  openers.forEach((o) => o())
}

// The slides. Shows itself once; `ready` holds the first showing back while
// another pop-up on the page needs the screen (two modals can't show at
// once on iOS).
export function ConditioningBasics({ gymDays, ready = true }: { gymDays: Weekday[]; ready?: boolean }) {
  const t = usePaper()
  const [show, setShow] = useState(false)
  const [i, setI] = useState(0)
  const slides = conditioningSlides(gymDays)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    AsyncStorage.getItem(SEEN_KEY).then((v) => { if (!cancelled && v !== "1") setShow(true) }).catch(() => {})
    return () => { cancelled = true }
  }, [ready])

  useEffect(() => {
    const open = () => { setI(0); setShow(true) }
    openers.add(open)
    return () => { openers.delete(open) }
  }, [])

  const close = () => {
    setShow(false)
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {})
  }
  const slide = slides[i]
  const last = i === slides.length - 1
  const num = (n: number) => String(n).padStart(2, "0")

  return (
    <Modal visible={show} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      {/* A modal is its own native window: it needs its own safe-area provider. */}
      <SafeAreaProvider>
        <PaperBackground>
          <SafeAreaView style={{ flex: 1, paddingHorizontal: space.gutter }} edges={["top", "bottom"]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8 }}>
              <Mono>Conditioning basics · {num(i + 1)} / {num(slides.length)}</Mono>
              <IconButton icon="close" label="Close" onPress={close} />
            </View>

            <View style={{ marginTop: 28 }}>
              <Melt top={20} height={380} />
              <PosterHeadline>{slide.poster}</PosterHeadline>
            </View>

            <View style={{ flex: 1, justifyContent: "flex-end", paddingBottom: 20 }}>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <IconCircle icon={slide.icon} size={40} />
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
              label={last ? "Let's train" : "Next"}
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

// The way back in, on the Plan page: its own card so it doesn't get lost.
export function ConditioningBasicsCard() {
  return (
    <Card eyebrow="Conditioning basics">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <IconCircle icon="school" size={40} />
        <View style={{ flex: 1, gap: 4 }}>
          <CardTitle size={24}>How to train S&C</CardTitle>
          <Body size={13.5} muted>Failure, full range, no pain, consistency and your extra day.</Body>
        </View>
      </View>
      <GhostButton label="See the 6 tips" icon="play" style={{ marginTop: 14, alignSelf: "flex-start" }} onPress={openConditioningBasics} />
    </Card>
  )
}
