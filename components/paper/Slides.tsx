import { Card } from "@/components/paper/Cards"
import { Body, CardTitle, Mono, PosterHeadline } from "@/components/paper/Type"
import { IconButton, PrimaryCTA, TextButton } from "@/components/paper/Buttons"
import { IconCircle } from "@/components/paper/Rows"
import { Melt, PaperBackground } from "@/components/paper/Surface"
import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { space } from "@/theme/paper/tokens"
import { usePopupTurn } from "@/utils/popupTurn"
import { Ionicons } from "@expo/vector-icons"
import { useState } from "react"
import { Modal, View } from "react-native"
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context"

// Full-screen Paper Mint slides that introduce something: a poster word, then a
// card with an icon, a title and a short text; dots, Next / Back. First used by
// Conditioning basics (coach 2026-11-11), shared with the next-session tasks
// intro. It waits its turn behind any other pop-up (utils/popupTurn.ts).

type IconName = React.ComponentProps<typeof Ionicons>["name"]

export interface Slide {
  poster: string // the slide's poster word(s)
  icon: IconName
  title: string
  text: string
}

// The slides themselves, for a screen that is already full screen (the
// workout's first-task intro). `onFinish`: the last slide's button; `onClose`: ✕.
export function SlidesBody({ label, slides, finishLabel, onFinish, onClose }: {
  label: string       // top left, before "01 / 04"
  slides: Slide[]
  finishLabel: string // the last slide's button
  onFinish: () => void
  onClose: () => void
}) {
  const t = usePaper()
  const [i, setI] = useState(0)
  const slide = slides[Math.min(i, slides.length - 1)]
  const last = i >= slides.length - 1
  const num = (n: number) => String(n).padStart(2, "0")
  if (!slide) return null

  return (
    <SafeAreaView style={{ flex: 1, paddingHorizontal: space.gutter }} edges={["top", "bottom"]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8 }}>
        <Mono>{label} · {num(i + 1)} / {num(slides.length)}</Mono>
        <IconButton icon="close" label="Close" onPress={onClose} />
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
        label={last ? finishLabel : "Next"}
        icon={last ? "checkmark" : "arrow-forward"}
        onPress={() => (last ? onFinish() : setI(i + 1))}
      />
      <View style={{ alignItems: "center", paddingVertical: 12, minHeight: 44 }}>
        {i > 0 && <TextButton label="Back" onPress={() => setI(i - 1)} />}
      </View>
    </SafeAreaView>
  )
}

// The slides as a full-screen pop-up. Every showing starts on the first slide.
export function Slides({ visible, label, slides, finishLabel, onClose }: {
  visible: boolean
  label: string
  slides: Slide[]
  finishLabel: string
  onClose: () => void
}) {
  const shown = usePopupTurn(visible && slides.length > 0)
  return (
    <Modal visible={shown} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {/* A modal is its own native window: it needs its own safe-area provider. */}
      <SafeAreaProvider>
        <PaperBackground>
          {shown && <SlidesBody label={label} slides={slides} finishLabel={finishLabel} onFinish={onClose} onClose={onClose} />}
        </PaperBackground>
      </SafeAreaProvider>
    </Modal>
  )
}
