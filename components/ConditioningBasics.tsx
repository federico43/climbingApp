import { C } from "@/utils/theme"
import { FeatureIntro, replayIntro, type IntroPage } from "@/components/schedule/FeatureIntro"
import { spreadSlideText, type Weekday } from "@/utils/extraSession"
import { Ionicons } from "@expo/vector-icons"
import { Pressable, StyleSheet, Text } from "react-native"

// Conditioning basics (coach 2026-11-11): a few slides that teach the athlete
// what matters in S&C — close to failure, full range, no pain, consistency,
// and spreading it over the week (with their own gym days and the extra
// session's days, utils/extraSession.ts). Shown once on the Plan page of a
// plan with S&C; "How to train S&C" opens it again.

const ID = "conditioning-basics"

export function conditioningPages(gymDays: Weekday[]): IntroPage[] {
  return [
    {
      icon: "barbell-outline",
      title: "Conditioning, done right",
      text: "Strength and conditioning make you a stronger climber and keep injuries away. A few rules make every session count.",
    },
    {
      icon: "flame-outline",
      title: "Get close to failure",
      text: "End each set with only 1 or 2 good reps left. If the last reps feel easy, it's time for more weight or reps. That's what makes you stronger.",
    },
    {
      icon: "resize-outline",
      title: "Use the full range",
      text: "All the way down and all the way up, on every rep. If you can't, lower the weight before you cut the movement short.",
    },
    {
      icon: "medkit-outline",
      title: "It shouldn't hurt",
      text: "Burning muscles and being tired are normal. Sharp pain or pain in a joint is not: stop that exercise and tell your coach.",
    },
    {
      icon: "repeat-outline",
      title: "Be consistent",
      text: "Strength builds slowly, session after session. Doing every workout beats a perfect one now and then.",
    },
    {
      icon: "calendar-outline",
      title: "Spread it over the week",
      text: spreadSlideText(gymDays),
    },
  ]
}

// The slides, shown once. `ready` holds them back while another pop-up on
// the page needs the screen (two modals can't show at once on iOS).
export function ConditioningBasics({ gymDays, ready = true }: { gymDays: Weekday[]; ready?: boolean }) {
  return <FeatureIntro id={ID} pages={conditioningPages(gymDays)} auto={ready} />
}

// "How to train S&C" — opens the slides again.
export function ConditioningBasicsLink() {
  return (
    <Pressable style={s.link} onPress={() => replayIntro(ID)} hitSlop={8} accessibilityLabel="How to train S&C">
      <Ionicons name="school-outline" size={14} color={C.green} />
      <Text style={s.linkText}>How to train S&C</Text>
    </Pressable>
  )
}

const s = StyleSheet.create({
  link: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 2 },
  linkText: { fontSize: 13, fontWeight: "700", color: C.green },
})
