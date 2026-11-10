import { usePaper } from "@/theme/paper/PaperThemeProvider"
import { font, type } from "@/theme/paper/tokens"
import React from "react"
import { StyleProp, StyleSheet, Text, TextProps, TextStyle, useWindowDimensions, View, ViewStyle } from "react-native"

/** Size that fits the longest word on one line (~9 letters at 82pt on a 390pt screen). */
export function posterSize(text: string, base = 82, screenWidth = 390) {
  const longest = Math.max(1, ...text.split(/\s+/).map((w) => w.length))
  const fitted = longest > 9 ? (base * 9) / longest : base
  return Math.round(fitted * Math.min(1, screenWidth / 390))
}

type PosterProps = {
  children: string
  /** Default 82 (58 for the headline input look). */
  size?: number
  /** Break "POWER ENDURANCE" into one word per line. Default true. */
  wordPerLine?: boolean
  style?: StyleProp<ViewStyle>
  numberOfLines?: number
}

/**
 * The screen's one poster headline: huge, condensed, uppercase, with the
 * chromatic offset (mint copy left-down, blue copy right-up, ink on top).
 */
export function PosterHeadline({ children, size, wordPerLine = true, style, numberOfLines }: PosterProps) {
  const t = usePaper()
  const { width } = useWindowDimensions()
  const text = (wordPerLine ? children.trim().split(/\s+/).join("\n") : children).toUpperCase()
  const fontSize = size ?? posterSize(children, 82, width)
  const base: TextStyle = {
    ...type.poster,
    fontSize,
    lineHeight: Math.round(fontSize * 0.86),
    letterSpacing: -0.02 * fontSize,
    // Android adds font padding above caps; trim it so lines stack tight.
    includeFontPadding: false,
  }
  return (
    <View style={style} accessible accessibilityRole="header" accessibilityLabel={children}>
      <Text style={[base, styles.copy, { color: t.chromaA, transform: [{ translateX: -3 }, { translateY: 1 }] }]} numberOfLines={numberOfLines} importantForAccessibility="no">
        {text}
      </Text>
      <Text style={[base, styles.copy, { color: t.chromaB, transform: [{ translateX: 3 }, { translateY: -1 }] }]} numberOfLines={numberOfLines} importantForAccessibility="no">
        {text}
      </Text>
      <Text
        style={[
          base,
          { color: t.ink },
          t.glow ? { textShadowColor: "rgba(138,214,162,0.35)", textShadowRadius: 28, textShadowOffset: { width: 0, height: 0 } } : null,
        ]}
        numberOfLines={numberOfLines}
      >
        {text}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  copy: { position: "absolute", left: 0, right: 0, top: 0 },
})

/** Mono, uppercase, widely tracked: eyebrows, field labels, status text. */
export function Mono({ style, children, italic, color, size = 10.5, ...rest }: TextProps & { italic?: boolean; color?: string; size?: number }) {
  const t = usePaper()
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: italic ? font.monoItalic : font.mono, fontSize: size, letterSpacing: size * 0.12, color: color ?? t.label, textTransform: "uppercase" },
        style,
      ]}
    >
      {children}
    </Text>
  )
}

/** Section header: mono label then a 1.5px ink rule filling the row. */
export function SectionHeader({ children, style, right }: { children: string; style?: StyleProp<ViewStyle>; right?: React.ReactNode }) {
  const t = usePaper()
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 28, marginBottom: 12 }, style]} accessibilityRole="header">
      <Mono color={t.ink}>{children}</Mono>
      <View style={{ flex: 1, height: 1.5, backgroundColor: t.ink }} />
      {right}
    </View>
  )
}

/** One mono line; segments wrapped in *asterisks* render italic (key values). */
function SpecLine({ line, align }: { line: string; align: "left" | "right" }) {
  const t = usePaper()
  const parts = line.split(/(\*[^*]+\*)/).filter(Boolean)
  return (
    <Mono style={{ textAlign: align, lineHeight: 16 }} size={10}>
      {parts.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") ? (
          <Text key={i} style={{ fontFamily: font.monoItalic, color: t.ink }}>
            {p.slice(1, -1)}
          </Text>
        ) : (
          p
        )
      )}
    </Mono>
  )
}

/** Two columns of 10px mono under the headline (left: week/dates, right: days left/status). */
export function SpecsRow({ left, right, style }: { left: string[]; right?: string[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", justifyContent: "space-between", marginTop: 16, gap: 16 }, style]}>
      <View style={{ flexShrink: 1 }}>
        {left.map((l, i) => (
          <SpecLine key={i} line={l} align="left" />
        ))}
      </View>
      {right && (
        <View style={{ flexShrink: 1, alignItems: "flex-end" }}>
          {right.map((l, i) => (
            <SpecLine key={i} line={l} align="right" />
          ))}
        </View>
      )}
    </View>
  )
}

/** Condensed uppercase card title (22–44pt). */
export function CardTitle({ children, size = 26, style, numberOfLines }: { children: string; size?: number; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const t = usePaper()
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: font.title, fontSize: size, lineHeight: Math.round(size * 0.95), color: t.ink, textTransform: "uppercase", letterSpacing: -0.01 * size, includeFontPadding: false }, style]}
    >
      {children}
    </Text>
  )
}

/** Plain body text in Archivo. weight: 600 (default), 700 or 800. */
export function Body({ style, weight = 600, muted, size = 15, ...rest }: TextProps & { weight?: 600 | 700 | 800; muted?: boolean; size?: number }) {
  const t = usePaper()
  const family = weight === 800 ? font.bold : weight === 700 ? font.bodyBold : font.body
  return <Text {...rest} style={[{ fontFamily: family, fontSize: size, color: muted ? t.textMuted : t.ink }, style]} />
}
