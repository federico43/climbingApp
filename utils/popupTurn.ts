import { useEffect, useState } from "react"

// One pop-up (React Native <Modal>) on screen at a time.
// iOS can't present a Modal while another one is up or still fading out: the
// second one never shows but stays as an invisible layer that swallows every
// touch, so after closing the first pop-up the screen looks frozen. This
// happened on Plan, where the class-card intro and the daily check-in both
// open on launch. Pop-ups ask for a turn here and wait in line.

// Time for a closing Modal's fade to finish before the next one opens.
const FADE_MS = 400

let current: symbol | null = null
let releasing = false
const queue: { key: symbol; grant: () => void }[] = []

function next() {
  if (current || releasing) return
  const w = queue.shift()
  if (!w) return
  current = w.key
  w.grant()
}

// Pass whether the pop-up wants to show; returns whether it may show now.
export function usePopupTurn(want: boolean): boolean {
  const [turn, setTurn] = useState(false)

  useEffect(() => {
    if (!want) return
    const key = Symbol("popup")
    queue.push({ key, grant: () => setTurn(true) })
    next()
    return () => {
      const i = queue.findIndex((w) => w.key === key)
      if (i >= 0) queue.splice(i, 1)
      setTurn(false)
      if (current === key) {
        current = null
        releasing = true
        setTimeout(() => {
          releasing = false
          next()
        }, FADE_MS)
      }
    }
  }, [want])

  return want && turn
}
