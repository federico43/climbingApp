import { useEffect, useState, useMemo } from "react"
import {getDataStats,buildWeekChart,sortStackDataByColor, getWeekLabel} from "@/utils/graphUtils"
import { getBoulderLevels, getBoulderLogs,  } from "@/services/BoulderGraphService"
import { Models } from "appwrite"

export type Level = {
  label: string
  color: string
  difficulty: number
}

export function useBoulderGraph(refreshKey: number,weekOffset: number) {
  //VARIABLES
  const [logs, setLogs] = useState<Models.DefaultRow[]>([])

  //FETCH RAW DATA
  const [levelTable, setLevels] = useState<Record<string, Level>>({})
  useEffect(() => {
    async function fetchData() {
      const [logsData, levelData] = await Promise.all([
        getBoulderLogs(),
        getBoulderLevels()
      ])

      setLogs(logsData)
    //TRANSFORM LEVELS TABLE. 
    //re-arranges the level table into a dictionary
    //keys here are the row's id 
    //the values are dictionaries containing color and label keys. 
      const levelMap: Record<string, Level> = Object.fromEntries(
        levelData.map((c:any) => [c.$id, { label: c.label, color: c.color, difficulty: c.difficulty}])
      )
      setLevels(levelMap)
    }
    fetchData()
    
  }, [refreshKey])
  //BAISC DATA TRANSFORMATION. 
  const { stackData, stats, height, weekLabel, normalized, legend } = useMemo(() => {

  if ( !Object.keys(levelTable).length) {
    
    return { stackData: [], stats: "", height: 0, normalized: [] }
  }

  const normalized = logs
    .map((row:any) => ({
      id: row.$id, // ⚠️ IMPORTANT: add id for deletion
      date: new Date(row.fecha),
      levelID: row.nivelesBoulder
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const { GraphHeight, stats } = getDataStats(normalized,levelTable)

  const referenceDate = new Date()
  referenceDate.setDate(referenceDate.getDate() + weekOffset * 7)

  const rawStackData = buildWeekChart(normalized, levelTable, referenceDate)

  const stackData = sortStackDataByColor(rawStackData)

  const weekLabel = getWeekLabel(weekOffset)

  const legend = getLegendItems(levelTable)

  return {
    stackData,
    stats,
    height: GraphHeight,
    weekLabel,
    normalized , // 👈 ADD THIS,
    legend
  }

  }, [logs, levelTable, weekOffset])

  
  // example of whats in the stack data:
  // [{"label": "Mar 7", "stacks": [[Object]]}]
  // it starts with an array Map<string, stackDataItem>()
  // which starts with data, data (stackDataItem)
  // then with this line Array.from(map.values())
  // we are left only with an array of values.
  // which is the second line we see in this comments. 
  //so we have an array of dictionaries. 

  //{GraphHeight,stats} = getDataStats(stackData)
  
  return {levelTable,stackData,stats, height, weekLabel, normalized, legend}
}

type LegendItem = {
  label: string
  color: string
}

function getLegendItems(levelMap: Record<string, Level>): LegendItem[] {
  return Object.values(levelMap)
    .sort((a, b) => a.difficulty - b.difficulty) // easiest → hardest
    .map(level => ({
      label: level.label,
      color: level.color,
    }))
}