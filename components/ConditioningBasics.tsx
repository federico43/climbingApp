import { Body, Card, CardTitle, GhostButton, IconCircle, Slides, type Slide } from "@/components/paper"
import { spreadSlideText, type Weekday } from "@/utils/extraSession"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useState } from "react"
import { View } from "react-native"

// Conditioning basics (coach 2026-11-11): full-screen Paper Mint slides that
// teach the athlete what matters in S&C — close to failure, full range, no
// pain, consistency, and spreading it over the week (with their own gym days
// and the extra session's days, utils/extraSession.ts). Shown once on the
// Plan page of a plan with S&C; the "How to train S&C" card opens it again.

export type BasicsSlide = Slide

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
// once on iOS; Slides also waits its turn behind other pop-ups).
export function ConditioningBasics({ gymDays, ready = true }: { gymDays: Weekday[]; ready?: boolean }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    AsyncStorage.getItem(SEEN_KEY).then((v) => { if (!cancelled && v !== "1") setShow(true) }).catch(() => {})
    return () => { cancelled = true }
  }, [ready])

  useEffect(() => {
    const open = () => setShow(true)
    openers.add(open)
    return () => { openers.delete(open) }
  }, [])

  const close = () => {
    setShow(false)
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {})
  }

  return (
    <Slides visible={show} label="Conditioning basics" slides={conditioningSlides(gymDays)} finishLabel="Let's train" onClose={close} />
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
