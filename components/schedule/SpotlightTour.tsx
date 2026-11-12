import { K as C, KF } from "@/components/schedule/calTheme"
import { markIntroSeen, onIntroReplay } from "@/components/schedule/FeatureIntro"
import { usePopupTurn } from "@/utils/popupTurn"
import AsyncStorage from "@react-native-async-storage/async-storage"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Modal, Pressable, StyleProp, StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native"

// First-run guided tour (Claude Design spec §4.6): everything dims except
// one highlighted part of the screen, and a card next to it says what it's
// for. Steps whose part isn't on screen (e.g. no requests) are skipped.
// Shown once per device; the screen's "i" button (same id) shows it again.

export interface TourStep {
  target: string // name of a <TourSpot>
  title: string
  text: string
}

// Parts of the screen a tour can point at, by name.
const spots = new Map<string, React.RefObject<View | null>>()

// Wrap a part of the screen so the tour can highlight it.
export function TourSpot({ name, style, children }: { name: string; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const ref = useRef<View>(null)
  useEffect(() => {
    spots.set(name, ref)
    return () => { if (spots.get(name) === ref) spots.delete(name) }
  }, [name])
  return <View ref={ref} collapsable={false} style={style}>{children}</View>
}

type Box = { x: number; y: number; w: number; h: number }

function measure(name: string): Promise<Box | null> {
  const v = spots.get(name)?.current
  if (!v) return Promise.resolve(null)
  return new Promise((done) => {
    v.measureInWindow((x, y, w, h) => done(w > 0 && h > 0 ? { x, y, w, h } : null))
  })
}

const KEY = (id: string) => `feature-intro-seen:${id}`
const PAD = 6
const DIM = "rgba(5,4,8,0.72)"

export function SpotlightTour({ id, steps, ready = true }: { id: string; steps: TourStep[]; ready?: boolean }) {
  const [want, setWant] = useState(false)
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const { width: W, height: H } = useWindowDimensions()
  // Nothing in the tour may sit under the iOS status bar / notch or home bar.
  const insets = useSafeAreaInsets()
  const minY = insets.top + 4
  const maxY = H - insets.bottom - 4

  useEffect(() => {
    AsyncStorage.getItem(KEY(id)).then((v) => { if (v !== "1") setWant(true) }).catch(() => {})
    return onIntroReplay(id, () => { setI(0); setBox(null); setWant(true) })
  }, [id])

  const visible = usePopupTurn(want && ready)

  // Find step i's part of the screen, or the next step whose part is shown.
  const go = useCallback(async (from: number) => {
    for (let n = from; n < steps.length; n++) {
      const b = await measure(steps[n].target)
      if (b) { setI(n); setBox(b); return }
    }
    setWant(false)
    markIntroSeen(id)
  }, [steps, id])

  useEffect(() => {
    if (!visible) return
    // Let the screen finish laying out before measuring.
    const t = setTimeout(() => go(i), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, W, H])

  const close = () => { setWant(false); markIntroSeen(id) }
  const step = steps[i]
  const last = !steps.slice(i + 1).length

  // The hole, a little larger than the part it shows.
  const holeY = box ? Math.max(minY, box.y - PAD) : 0
  const hole = box && { x: Math.max(0, box.x - PAD), y: holeY, w: Math.min(W, box.w + PAD * 2), h: Math.min(maxY, box.y + box.h + PAD) - holeY }
  const cardW = Math.min(380, W - 32)
  const below = hole ? maxY - (hole.y + hole.h) : 0
  const above = hole ? hole.y - minY : 0
  // Next to the hole where there's room, else over its lower part.
  const cardPos: ViewStyle = !hole ? { top: Math.max(minY, H / 3) }
    : below >= 210 ? { top: hole.y + hole.h + 12 }
    : above >= 210 ? { bottom: H - hole.y + 12 }
    : { bottom: insets.bottom + 32 }
  const cardLeft = hole ? Math.max(16, Math.min(W - cardW - 16, hole.x + hole.w / 2 - cardW / 2)) : (W - cardW) / 2

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      {hole ? (
        <>
          <View style={[s.dim, { left: 0, top: 0, width: W, height: hole.y }]} />
          <View style={[s.dim, { left: 0, top: hole.y + hole.h, width: W, bottom: 0 }]} />
          <View style={[s.dim, { left: 0, top: hole.y, width: hole.x, height: hole.h }]} />
          <View style={[s.dim, { left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h }]} />
          <View pointerEvents="none" style={[s.ring, { left: hole.x, top: hole.y, width: hole.w, height: hole.h }]} />
        </>
      ) : <View style={[s.dim, StyleSheet.absoluteFill]} />}
      {hole && step && (
        <View style={[s.card, cardPos, { left: cardLeft, width: cardW }]}>
          <View style={s.steps}>
            {steps.map((_, n) => (
              <View key={n} style={[s.stepDot, n === i && s.stepDotOn]}>
                <Text style={[s.stepN, n === i && { color: C.onMint }]}>{n + 1}</Text>
              </View>
            ))}
          </View>
          <Text style={s.title}>{step.title.toUpperCase()}</Text>
          <Text style={s.text}>{step.text}</Text>
          <View style={s.row}>
            <Pressable hitSlop={10} onPress={close}>
              <Text style={s.skip}>Skip tour</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [s.next, pressed && { opacity: 0.85 }]} onPress={() => (last ? close() : go(i + 1))}>
              <Text style={s.nextText}>{last ? "Done" : "Next →"}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Modal>
  )
}

const s = StyleSheet.create({
  dim: { position: "absolute", backgroundColor: DIM },
  ring: { position: "absolute", borderRadius: 14, borderWidth: 1.5, borderColor: C.green },
  card: {
    position: "absolute", backgroundColor: C.surface, borderRadius: 20, borderWidth: 1.5, borderColor: C.green,
    padding: 18, gap: 10,
  },
  steps: { flexDirection: "row", gap: 6 },
  stepDot: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  stepDotOn: { backgroundColor: C.green, borderColor: C.green },
  stepN: { fontFamily: KF.mono, fontSize: 10, color: C.textMuted },
  title: { fontFamily: KF.poster, fontSize: 30, lineHeight: 30, color: C.textPrimary, letterSpacing: 0.3 },
  text: { fontFamily: KF.body, fontSize: 15, lineHeight: 21, color: C.textSecondary },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  skip: { fontFamily: KF.mono, fontSize: 12, color: C.textMuted },
  next: { backgroundColor: C.green, borderRadius: 22, paddingVertical: 11, paddingHorizontal: 22 },
  nextText: { fontFamily: KF.bold, fontSize: 14, color: C.onMint },
})
