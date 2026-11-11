import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useState } from "react"

// The athlete's answer to "Do you go to class the same days every week?",
// kept on the phone. "no" stops the setup screen from showing again; a "yes"
// is saved as their usual classes (users.defaultClasses) instead.
export type FixedAnswer = "no" | null

const KEY = (user: string) => `fixed-schedule-answer:${user}`
const cache: Record<string, FixedAnswer | undefined> = {}
const listeners = new Set<() => void>()

export function setFixedAnswer(user: string, answer: FixedAnswer) {
  cache[user] = answer
  listeners.forEach((l) => l())
  ;(answer ? AsyncStorage.setItem(KEY(user), answer) : AsyncStorage.removeItem(KEY(user))).catch(() => {})
}

// undefined while it's still being read.
export function useFixedAnswer(user: string): FixedAnswer | undefined {
  const [, tick] = useState(0)
  useEffect(() => {
    const l = () => tick((n) => n + 1)
    listeners.add(l)
    if (!(user in cache)) {
      AsyncStorage.getItem(KEY(user))
        .then((v) => { cache[user] = v === "no" ? "no" : null })
        .catch(() => { cache[user] = null })
        .finally(() => listeners.forEach((x) => x()))
    }
    return () => { listeners.delete(l) }
  }, [user])
  return cache[user]
}
