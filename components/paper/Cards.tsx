import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { radius, space } from "@/theme/paper/tokens"
import { Ionicons } from "@expo/vector-icons"
import React from "react"
import { Pressable, StyleProp, View, ViewStyle } from "react-native"
import { CardTitle, Mono } from "./Type"

type CardProps = {
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  /** Coach-assigned homework: pink border + pink "Homework" eyebrow. */
  homework?: boolean
  /** Eyebrow above the content (mono, uppercase). */
  eyebrow?: string
  padded?: boolean
}

/**
 * Frosted card floating over the paper / melt. (No backdrop blur yet:
 * expo-blur needs a new app build, so cards use the translucent fill only.)
 */
export function Card({ children, style, homework, eyebrow, padded = true }: CardProps) {
  const t = usePaper()
  return (
    <View
      style={[
        {
          backgroundColor: t.card,
          borderRadius: radius.card,
          borderWidth: homework ? 1.5 : 1,
          borderColor: homework ? hexAlpha(t.pink, 0.38) : t.cardBorder,
          padding: padded ? space.cardPad : 0,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {(homework || eyebrow) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
          {homework && <Ionicons name="school" size={13} color={t.pink} />}
          <Mono color={homework ? t.pink : t.label}>{eyebrow ?? "Homework"}</Mono>
        </View>
      )}
      {children}
    </View>
  )
}

/** #RRGGBB + alpha → rgba(). */
export function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

type BlockCardProps = {
  category: string
  title: string
  /** Category dot colour. Default blockBlue (warm-up). */
  dotColor?: string
  open: boolean
  onToggle: () => void
  /** Long-press on the handle starts a drag (react-native-draggable-flatlist's `drag`). */
  onDrag?: () => void
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
}

/** Collapsible block card: drag handle, category dot + eyebrow, condensed title, chevron circle. */
export function CollapsibleBlockCard({ category, title, dotColor, open, onToggle, onDrag, children, style }: BlockCardProps) {
  const t = usePaper()
  return (
    <Card padded={false} style={style}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${category}: ${title}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: space.cardPad }}
      >
        {onDrag && (
          <Pressable onLongPress={onDrag} delayLongPress={150} hitSlop={10} accessibilityLabel="Reorder block">
            <DragDots color={t.ink} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dotColor ?? t.blockBlue }} />
            <Mono>{category}</Mono>
          </View>
          <CardTitle size={24} numberOfLines={2}>{title}</CardTitle>
        </View>
        <View
          style={{
            width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
            borderColor: open ? (t.mode === "dark" ? t.mint : t.ink) : t.ghostBorder,
            backgroundColor: open ? t.mint : "transparent", alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={open ? t.onMint : t.ink} />
        </View>
      </Pressable>
      {open && children != null && (
        <View style={{ borderTopWidth: 1, borderTopColor: t.hairline, padding: space.cardPad }}>{children}</View>
      )}
    </Card>
  )
}

function DragDots({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 3, opacity: 0.45 }}>
      {[0, 1].map((c) => (
        <View key={c} style={{ gap: 3 }}>
          {[0, 1, 2].map((r) => (
            <View key={r} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
          ))}
        </View>
      ))}
    </View>
  )
}
