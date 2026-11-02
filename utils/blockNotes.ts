// Turns a coach's free-text block description into readable steps, and marks
// the numbers worth remembering (sets, seconds, kg, %…) so the UI can
// highlight them. Pure, no React.

export interface NotePart { text: string; key: boolean }

const BULLET = /^\s*(?:[-•*·–]|\d{1,2}[.)])\s+/

// One step per line. A single paragraph with several sentences becomes one
// step per sentence. Bullets and "1." / "2)" prefixes are dropped (the UI
// numbers the steps itself).
export function noteSteps(text: string | null | undefined): string[] {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(BULLET, "").trim())
    .filter(Boolean)
  if (lines.length !== 1) return lines
  return splitSentences(lines[0])
}

function splitSentences(line: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c !== "." && c !== "!" && c !== "?") continue
    // Sentence end: punctuation, then space, then an uppercase letter, digit,
    // or an opening ¿/¡. Skips "e.g. this" and decimals like "2.5".
    const m = /^\s+(?=[A-ZÁÉÍÓÚÑÜ0-9¿¡"“(*])/.exec(line.slice(i + 1))
    if (!m) continue
    if (c === "." && /\b(?:e\.g|i\.e|vs|approx|min|sec|max)$/i.test(line.slice(start, i))) continue
    out.push(line.slice(start, i + 1).trim())
    start = i + 1 + m[0].length
    i = start - 1
  }
  const rest = line.slice(start).trim()
  if (rest) out.push(rest)
  return out
}

const NUM = String.raw`\d+(?:[.,]\d+)?`
const UNIT = String.raw`(?:%|kg|lbs?|seconds?|secs?|s|minutes?|mins?|min|hours?|h|reps?|sets?|rounds?|series|boulders?|attempts?|tries|moves?|holds?|m|cm|mm)`
// "3 x 10", "30-45 s", "8 reps", "80%", "4x4", "1:30"
const KEY = new RegExp(
  String.raw`${NUM}(?::\d{2})?(?:\s*[x×]\s*${NUM})?(?:\s*(?:-|–|to)\s*${NUM})?(?:\s*${UNIT}(?![A-Za-zÁÉÍÓÚáéíóúñÑ]))?`,
  "gi",
)

// Rule words for constraint warm-ups ("only one hand", "no re-adjusting",
// "without a sound"…), highlighted like numbers.
export const CONSTRAINT_WORDS = [
  "only", "never", "no", "not", "don't", "do not", "without", "always", "silent", "silently",
  "both", "same", "one hand", "one foot", "hands", "hand", "feet", "foot", "slow", "slowly", "pause",
]

const LETTER = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ']/
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Applies `find` to the plain parts only, keeping the key ones as they are.
function splitPlain(parts: NotePart[], find: (text: string) => [number, number][]): NotePart[] {
  const out: NotePart[] = []
  for (const p of parts) {
    if (p.key) { out.push(p); continue }
    let last = 0
    for (const [a, b] of find(p.text)) {
      if (a > last) out.push({ text: p.text.slice(last, a), key: false })
      out.push({ text: p.text.slice(a, b), key: true })
      last = b
    }
    if (last < p.text.length) out.push({ text: p.text.slice(last), key: false })
  }
  return out
}

function numbers(text: string): [number, number][] {
  const out: [number, number][] = []
  KEY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = KEY.exec(text))) {
    const before = text[m.index - 1]
    const after = text[m.index + m[0].length]
    // Digits glued to a letter (grades like "V5" or "6a+", names like "B2") stay plain.
    if ((before && /[A-Za-z]/.test(before)) || (after && /[A-Za-z+]/.test(after) && !/[x×]/i.test(after))) continue
    out.push([m.index, m.index + m[0].length])
  }
  return out
}

function wordsIn(words: string[]) {
  if (words.length === 0) return () => []
  // Longest first, so "one hand" wins over "hand".
  const alt = [...words].sort((a, b) => b.length - a.length).map(esc).join("|")
  const re = new RegExp(`(?:${alt})`, "gi")
  return (text: string): [number, number][] => {
    const out: [number, number][] = []
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const a = m.index, b = a + m[0].length
      if ((a > 0 && LETTER.test(text[a - 1])) || (b < text.length && LETTER.test(text[b]))) continue
      out.push([a, b])
    }
    return out
  }
}

// Splits a step into plain and key parts: text the coach wrapped in *stars*,
// numbers with their units, and any of `words` (whole words, any case).
export function noteParts(step: string, words: string[] = []): NotePart[] {
  const parts: NotePart[] = []
  const star = /\*{1,2}([^*]+?)\*{1,2}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = star.exec(step))) {
    if (m.index > last) parts.push({ text: step.slice(last, m.index), key: false })
    parts.push({ text: m[1], key: true })
    last = m.index + m[0].length
  }
  if (last < step.length) parts.push({ text: step.slice(last), key: false })
  return splitPlain(splitPlain(parts, numbers), wordsIn(words))
}
