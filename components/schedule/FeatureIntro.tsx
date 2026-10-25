import { C } from "@/utils/theme"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useState } from "react"
import { Modal, Pressable, StyleSheet, Text, View } from "react-native"

export interface IntroPage {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  text: string
}

const KEY = (id: string) => `feature-intro-seen:${id}`
// Pop-ups asked to show again (the "i" button), by id.
const replay = new Set<(id: string) => void>()

// Small "i" button that opens the screen's pop-ups again.
export function IntroButton({ id }: { id: string }) {
  return (
    <Pressable hitSlop={10} onPress={() => replay.forEach((l) => l(id))} accessibilityLabel="How this screen works">
      <Ionicons name="information-circle-outline" size={24} color={C.textSecondary} />
    </Pressable>
  )
}

// A centered pop-up that explains a new feature the first time a screen opens
// (like the ones Spotify shows): picture on top, title, short text, one button.
// Several pages step through with "Next". Once closed it never shows again on
// this device, unless its IntroButton is tapped.
export function FeatureIntro({ id, pages }: { id: string; pages: IntroPage[] }) {
  const [show, setShow] = useState(false)
  const [i, setI] = useState(0)

  useEffect(() => {
    AsyncStorage.getItem(KEY(id)).then((v) => setShow(v !== "1")).catch(() => {})
    const l = (which: string) => {
      if (which !== id) return
      setI(0)
      setShow(true)
    }
    replay.add(l)
    return () => { replay.delete(l) }
  }, [id])

  const close = () => {
    setShow(false)
    AsyncStorage.setItem(KEY(id), "1").catch(() => {})
  }
  const page = pages[i]
  const last = i === pages.length - 1

  return (
    <Modal visible={show} transparent animationType="fade" onRequestClose={close}>
      <View style={s.scrim}>
        <View style={s.card}>
          <View style={s.art}>
            <View style={s.ring}>
              <Ionicons name={page.icon} size={56} color={C.green} />
            </View>
            <Pressable style={s.close} hitSlop={10} onPress={close} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </Pressable>
          </View>
          <View style={s.body}>
            <Text style={s.title}>{page.title}</Text>
            <Text style={s.text}>{page.text}</Text>
            {pages.length > 1 && (
              <View style={s.dots}>
                {pages.map((_, n) => <View key={n} style={[s.dot, n === i && s.dotOn]} />)}
              </View>
            )}
            <Pressable
              style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
              onPress={() => (last ? close() : setI(i + 1))}
            >
              <Text style={s.btnText}>{last ? "Got it" : "Next"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 28 },
  card: { width: "100%", maxWidth: 380, backgroundColor: C.surface, borderRadius: 20, overflow: "hidden" },
  art: { height: 190, backgroundColor: "#1B2A22", alignItems: "center", justifyContent: "center" },
  ring: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: "rgba(111,207,151,0.12)",
    borderWidth: 1, borderColor: "rgba(111,207,151,0.35)", alignItems: "center", justifyContent: "center",
  },
  close: { position: "absolute", top: 14, right: 14 },
  body: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 24, alignItems: "center", gap: 12 },
  title: { fontSize: 22, fontWeight: "800", color: C.textPrimary, textAlign: "center", letterSpacing: -0.3 },
  text: { fontSize: 15, lineHeight: 21, color: C.textSecondary, textAlign: "center" },
  dots: { flexDirection: "row", gap: 6, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.surfaceHigh },
  dotOn: { backgroundColor: C.green, width: 18 },
  btn: { marginTop: 8, backgroundColor: C.green, borderRadius: 24, paddingVertical: 13, paddingHorizontal: 40 },
  btnText: { fontSize: 15, fontWeight: "800", color: "#10251A", letterSpacing: 0.3 },
})
