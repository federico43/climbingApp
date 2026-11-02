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
    const m = /^\s+(?=[A-ZÁÉÍÓÚÑÜ0-9¿¡"“(])/.exec(line.slice(i + 1))
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

// Splits a step into plain and key parts. Digits glued to a letter (grades
// like "V5" or "6a+", names like "B2") are left alone.
export function noteParts(step: string): NotePart[] {
  const parts: NotePart[] = []
  let last = 0
  KEY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = KEY.exec(step))) {
    const before = step[m.index - 1]
    const after = step[m.index + m[0].length]
    if ((before && /[A-Za-z]/.test(before)) || (after && /[A-Za-z+]/.test(after) && !/[x×]/i.test(after))) {
      continue
    }
    if (m.index > last) parts.push({ text: step.slice(last, m.index), key: false })
    parts.push({ text: m[0], key: true })
    last = m.index + m[0].length
  }
  if (last < step.length) parts.push({ text: step.slice(last), key: false })
  return parts
}
