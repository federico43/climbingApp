import { stackDataItem } from "react-native-gifted-charts"
import { Level } from "@/hooks/BoulderGraphToolKit";

export type StackDataWithDate = stackDataItem & {
  date?: Date
}

const weekDays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

function getWeekStart(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  //getDay -> current day sunday being 0, 6 being saturday
  
  const diff = day === 0 ? -6 : 1 - day
  //if day is monday, day = -6
  //else day = 1 - day
  d.setDate(d.getDate() + diff)
  //getDate -> day of the month 
  d.setHours(0,0,0,0)
  return d
}

function createEmptyWeek(): StackDataWithDate[] {
  return weekDays.map(day => ({
    label: day,
    stacks: [{ value: 0 }]
  }))
}

//MAIN TRASFORMATION FUNCTION
export function buildWeekChart(
  data: { date: Date; levelID: string }[],
  levelTable: Record<string, Level>,
  referenceDate: Date
): StackDataWithDate[] {
  // what goes after the ':' defines what the function returns 
  const weekStart = getWeekStart(referenceDate)
  const chartData = createEmptyWeek()
  // 🔥 Assign real dates to each day
  for (let i = 0; i < 7; i++) { //loops trhough the 7 days
    const dayDate = new Date(weekStart) //creates based on monday's date a new date
    dayDate.setDate(weekStart.getDate() + i) // updates the date depending on counter 

    // normalize to midnight (IMPORTANT)
    dayDate.setHours(0, 0, 0, 0) //adjusts it's hour.

    chartData[i].date = dayDate //on the orignialn structure add the date.
  }

  for (const item of data) {
    const diffDays = Math.floor(
      (item.date.getTime() - weekStart.getTime()) / (1000*60*60*24)
    )
    //getTime -> the date in millseconds since 1970
    if (diffDays < 0 || diffDays > 6) continue

    const stacks = chartData[diffDays].stacks
    //creates a shortcut variable
    
    const color = levelTable[item.levelID].color
    const existing = stacks.find(s => s.color === color)

    if (existing) {
      existing.value += 1
    } else {
      stacks.push({ value: 1, color })
    }
  }
  console.log("chartData", chartData)
  return chartData
}


export function getDataStats(
  data: { date: Date; levelID: string }[]
) {
  if (!data.length) {
    return { GraphHeight: 4, stats: "No stats yet 🙂" }
  }

  let maxPerDay = 0
  let currentWeekTotal = 0
  let lastWeekTotal = 0

  const today = new Date()

  const startCurrentWeek = new Date(today)
  startCurrentWeek.setDate(today.getDate() - today.getDay())

  const startLastWeek = new Date(startCurrentWeek)
  startLastWeek.setDate(startCurrentWeek.getDate() - 7)

  const dayCounts = new Map<string, number>()

  for (const item of data) {
    const key = item.date.toISOString().split("T")[0]
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)
  }

  for (const [dateKey, total] of dayCounts.entries()) {
    const date = new Date(dateKey)

    if (total > maxPerDay) maxPerDay = total

    if (date >= startCurrentWeek) {
      currentWeekTotal += total
    } else if (date >= startLastWeek && date < startCurrentWeek) {
      lastWeekTotal += total
    }
  }

  const GraphHeight = Math.max(4, Math.ceil(maxPerDay * 1.2))

  let stats = "No comparison available yet 🙂"

  if (lastWeekTotal > 0) {
    const diff = currentWeekTotal - lastWeekTotal

    // 🔑 CASE 1: small numbers → use absolute
    if (lastWeekTotal < 10) {
      if (diff > 0) {
        stats = `You climbed ${diff} more boulders than last week 💪`
      } else if (diff < 0) {
        stats = `You climbed ${Math.abs(diff)} fewer boulders than last week`
      } else {
        stats = "Same number of boulders as last week"
      }
    }

    // 🔑 CASE 2: medium → combine
    else if (lastWeekTotal < 30) {
      const percent = Math.round((diff / lastWeekTotal) * 100)

      if (diff > 0) {
        stats = `+${diff} boulders (${percent}%) vs last week 💪`
      } else if (diff < 0) {
        stats = `${diff} boulders (${percent}%) vs last week`
      } else {
        stats = "Same number of boulders as last week"
      }
    }

    // 🔑 CASE 3: large → percentage only
    else {
      const percent = Math.round((diff / lastWeekTotal) * 100)

      if (percent > 0) {
        stats = `You climbed ${percent}% more than last week 💪`
      } else if (percent < 0) {
        stats = `You climbed ${Math.abs(percent)}% less than last week`
      } else {
        stats = "Same number of boulders as last week"
      }
    }
  }

  return { GraphHeight, stats }
}


const COLOR_PRIORITY: Record<string, number> = {
  "#333333": 0, // black
  "#a3465a": 1, // red
  "#FFD786": 2, // yellow
  "#519A66": 3, // green
  "#87B6BC": 4  // blue
}
export function sortStackDataByColor(stackData: any[]) {
  return stackData.map(day => ({
    ...day,
    stacks: [...day.stacks].sort((a, b) => {
      const orderA = COLOR_PRIORITY[a.color ?? ""] ?? 999
      const orderB = COLOR_PRIORITY[b.color ?? ""] ?? 999
      return orderA - orderB
    })
  }))
}

export function getWeekLabel(weekOffset: number): string {
  weekOffset= weekOffset*-1
  if (weekOffset === 0) return " This Week"
  if (weekOffset === 1) return "Last Week  "
  return `  ${weekOffset} Weeks Ago `
}

