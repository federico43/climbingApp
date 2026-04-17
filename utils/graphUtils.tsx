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
  return chartData
}


function getDeadlineText(today: Date) {
  const day = today.getDay()
  const daysUntilFriday = (5 - day + 7) % 7

  if (daysUntilFriday === 0) return "today"
  if (daysUntilFriday === 1) return "by tomorrow"
  if (daysUntilFriday <= 3) return "before Friday"

  return "this week"
}

export function getDataStats(
  data: { date: Date; levelID: string }[],
  levelMap: Record<string, { label: string; color: string; difficulty: number }>
) {
  if (!data.length) {
  return {
    GraphHeight: 4,
    stats: {
      lastWeek: 0,
      thisWeek: 0,
      action: "No stats yet 🙂"
    }
  }
}
  //SETUP VARIABLES -------------------
  let maxPerDay = 0
  let totalCurrentWeek = 0
  let totalLastWeek = 0
   // create a dictionary, index the date. 
  const dayCounts = new Map<number, number>()
  // counts number of boulder by week. 
  const currentWeekCounts: Record<string, number> = {}
  // last weeks boudler 
  const lastWeekCounts: Record<string, number> = {}

  //SETUP DATE VARIABLES -----------------
  const today = new Date()
  //fetches today's date 
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  )
  //create a copy 
  const startCurrentWeek = new Date(todayMidnight)
  // get's the start of the week (sunday)
  startCurrentWeek.setDate(todayMidnight.getDate() - todayMidnight.getDay()+1)
  //setups last week 
  const startLastWeek = new Date(startCurrentWeek)
  startLastWeek.setDate(startCurrentWeek.getDate() - 7)
  
  // MAIN LOOP ---------------
  // pass through the data 
  for (const item of data) {
    // get the date of the data
    const d = item.date

    // search through the database level colors, get all the details of this boulder's level. 
    const level = levelMap[item.levelID]
    if (!level) continue // 🔥 skip if missing
    //get the color 
    const color = level.color.toLowerCase()

    //format the recorded date of the boulder. 
    const dayKey = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate()
    ).getTime()
    //UPDATE MAX DAY -----------
    // calculate the new total for the day
    const newTotal = (dayCounts.get(dayKey) ?? 0) + 1
    // set new calculation on dictionary
    dayCounts.set(dayKey, newTotal)
    //update max per day. 
    if (newTotal > maxPerDay) maxPerDay = newTotal

    //COUNT BOULDERS BY COLOR ---------
    //COUNT BOULDERS BY WEEK -------
    //if date is greater oR equal to sunday of the week 
    if (d >= startCurrentWeek) {
      //?new item in dict, adding 1 to color.
      currentWeekCounts[color] = (currentWeekCounts[color] ?? 0) + 1
      totalCurrentWeek += 1
    } else if (d >= startLastWeek && d < startCurrentWeek) {
      lastWeekCounts[color] = (lastWeekCounts[color] ?? 0) + 1
      totalLastWeek += 1
    }
  }
  //CALC GRAPH'S HEIGHT.
  const GraphHeight = Math.max(4, Math.ceil(maxPerDay * 1.2))

  // SUGGESTION VARIABLES.
  let stats = {
    lastWeek: totalLastWeek,
    thisWeek: totalCurrentWeek,
    action: "No comparison available yet 🙂"
  } 
  const suggestions: string[] = []
  let isBehind = false
  const COLOR_NAMES: Record<string, string> = {
    "#333333": "black",
    "#a3465a": "red",
    "#ffd786": "yellow",
    "#519a66": "green",
    "#87b6bc": "blue",
  }
  //FOR EACH COLOR GET # BOULDER MISSING THIS WEEK  --------------  
  Object.keys(lastWeekCounts).forEach((color) => {
    //for color get last week count nad current week count. 
    const last = lastWeekCounts[color] ?? 0
    
    const current = currentWeekCounts[color] ?? 0
    //get the difference 
    const diff = last - current
  
    // if last week was bigger... 
    if (diff > 0) {
      isBehind = true
      const name = COLOR_NAMES[color] ?? "climb"
      suggestions.push(
        // <boulder's rememaining>  <color (plural or not)>
        `${diff} ${name}${diff > 1 ? "s" : ""}`
      )
    }
  })

  if (isBehind) {
  const deadline = getDeadlineText(today)

  const formatted =
    suggestions.length > 1
      ? suggestions.slice(0, -1).join(", ") + " and " + suggestions.at(-1)
      : suggestions[0]

  stats.action = `Finish ${formatted} ${deadline} 💪`
  } else {
    stats.action = "You're on track with last week 💪"
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
const COLOR_WEIGHTS: Record<string, number> = {}

Object.entries(COLOR_PRIORITY).forEach(([color, priority]) => {
  COLOR_WEIGHTS[color] = 5 - priority
})
function getColorName(color: string) {
  switch (color) {
    case "#333333": return "black"
    case "#a3465a": return "red"
    case "#FFD786": return "yellow"
    case "#519A66": return "green"
    case "#87B6BC": return "blue"
    default: return "climb"
  }
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

export function getChartDimensions(height: number) {
  const MAX_PIXEL_HEIGHT = 360
  const PIXELS_PER_SECTION = 30

  // 🔥 force maxValue to be even
  let maxValue = height
  if (maxValue % 2 !== 0) maxValue += 1

  // we want step = 2
  const STEP = 2

  let noOfSections = maxValue / STEP
  let shownHeight = noOfSections * PIXELS_PER_SECTION

  // if too tall → compress
  if (shownHeight > MAX_PIXEL_HEIGHT) {
    const maxSections = Math.floor(MAX_PIXEL_HEIGHT / PIXELS_PER_SECTION)

    // make even
    const evenSections = maxSections % 2 === 0 ? maxSections : maxSections - 1

    noOfSections = evenSections
    shownHeight = MAX_PIXEL_HEIGHT
  }

  return {
    shownHeight,
    maxValue,
    noOfSections,
  }
}

