// In-memory capture of console.log/warn/error so logs can be read from
// inside the app itself (see components/DebugLogOverlay.tsx) — for testing
// on a real device with no Metro/Xcode console attached, e.g. a standalone
// or ad-hoc build. console.warn/error calls execute regardless of build type
// (unlike the __DEV__-gated `dbg()` helpers in various components), so this
// captures those too.

export type LogEntry = { level: "log" | "warn" | "error"; message: string; atMs: number }

const MAX_ENTRIES = 400
let entries: LogEntry[] = []
let listeners: Array<() => void> = []
let installed = false

function stringifyArg(a: any): string {
  if (typeof a === "string") return a
  if (a instanceof Error) return a.message
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

function push(level: LogEntry["level"], args: any[]) {
  const message = args.map(stringifyArg).join(" ")
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), { level, message, atMs: Date.now() }]
  listeners.forEach((l) => l())
}

// Idempotent — safe to call from every screen that wants logging captured;
// only the first call actually wraps console.*.
export function installDebugLogCapture() {
  if (installed) return
  installed = true
  const origLog = console.log
  const origWarn = console.warn
  const origError = console.error
  console.log = (...args: any[]) => { push("log", args); origLog(...args) }
  console.warn = (...args: any[]) => { push("warn", args); origWarn(...args) }
  console.error = (...args: any[]) => { push("error", args); origError(...args) }
}

export function getDebugLogs(): LogEntry[] {
  return entries
}

export function subscribeDebugLogs(listener: () => void): () => void {
  listeners.push(listener)
  return () => { listeners = listeners.filter((l) => l !== listener) }
}

export function clearDebugLogs() {
  entries = []
  listeners.forEach((l) => l())
}

export function formatDebugLogs(): string {
  return getDebugLogs()
    .map((e) => `[${new Date(e.atMs).toLocaleTimeString()}] ${e.level.toUpperCase()}: ${e.message}`)
    .join("\n")
}
