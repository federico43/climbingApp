import { useAuth } from "@/components/auth-context"
import { DailyCheckInModal } from "@/components/DailyCheckInModal"
import { HeroIntro } from "@/components/HeroIntro"
import { getCheckinForToday, listProjects, markProjectFailed } from "@/services/BoulderGraphService"
import { useFocusEffect } from "@react-navigation/native"
import { useCallback, useEffect, useState } from "react"

// What the app's home screen runs — Home without a plan, Plan with one:
// the hero intro (once per launch), the daily check-in (once per day, after
// the intro) and failing projects past their due date (on every focus).

// Module flag: survives tab switches, resets on relaunch.
let heroPlayed = false
export function introAlreadyPlayed(): boolean {
  return heroPlayed
}

export function LaunchExtras({ onIntroDone }: { onIntroDone?: () => void }) {
  const { User, userName } = useAuth()
  const [introDone, setIntroDone] = useState(heroPlayed)
  const [showCheckin, setShowCheckin] = useState(false)

  useEffect(() => {
    if (!User) return
    let cancelled = false
    getCheckinForToday(User.$id).then((row) => {
      if (!cancelled) setShowCheckin(!row)
    })
    return () => { cancelled = true }
  }, [User])

  useFocusEffect(
    useCallback(() => {
      if (!User) return
      const todayStr = new Date().toISOString().slice(0, 10)
      listProjects()
        .then((projects) => {
          for (const p of projects) {
            if (p.status === "active" && p.dueDate < todayStr) markProjectFailed(p.$id).catch(console.error)
          }
        })
        .catch(() => {})
    }, [User])
  )

  return (
    <>
      {!introDone && (
        <HeroIntro
          name={userName ?? ""}
          onDone={() => {
            heroPlayed = true
            setIntroDone(true)
            onIntroDone?.()
          }}
        />
      )}
      <DailyCheckInModal
        visible={introDone && showCheckin}
        onDone={() => setShowCheckin(false)}
        onClose={() => setShowCheckin(false)}
      />
    </>
  )
}
