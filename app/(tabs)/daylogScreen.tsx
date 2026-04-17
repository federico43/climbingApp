//DayLogScreen. 
//
import React, { useMemo } from "react"
import { View, Text, FlatList, Pressable } from "react-native"
import { useRouter, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useDeleteRow, BOULDER_TABLE } from "@/services/BoulderGraphService"
import { useBoulderGraph } from "../../hooks/BoulderGraphToolKit"
import BoulderRow from "../../components/BoulderRow"
import { SafeAreaView } from "react-native-safe-area-context"



// Optional: helper to compare dates
function isSameDay(d1: Date, d2: Date) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

export default function DayLogScreen() {
  const [refreshKey, setRefreshKey] = React.useState(0)
  

  // 🚦 Router (for navigation)
  const router = useRouter()

  // 📦 Get params from Expo Router
  const { date } = useLocalSearchParams()
  const selectedDate = new Date(date as string)

  // 📊 Get ALL data
  const { normalized, levelTable } = useBoulderGraph(refreshKey,0)

  // 🎯 Filter only that day's boulders
  const bouldersForDay = useMemo(() => {
    return normalized.filter(b => isSameDay(b.date, selectedDate))
  }, [normalized, selectedDate])

async function handleDelete(id: string) {
  try {
    await useDeleteRow(BOULDER_TABLE, id)
    console.log("changing the refresh key")
    setRefreshKey(prev => prev + 1) // 👈 forces re-fetch
  } catch (error) {
    throw error
  }
}

  // 🧼 Empty state
  if (!bouldersForDay.length) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
         {/* 🔙 Back button */}
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Ionicons name="arrow-back" size={24} color="black" />
        </Pressable>
        <Text>No boulders logged this day 🧗‍♂️</Text>
      </View>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      
      {/* 🗓️ Header */}
      <View style={{
        padding: 16,
        flexDirection: "row",
        alignItems: "center"
      }}>

        {/* 🔙 Back button */}
        <Pressable onPress={() => router.replace("/")} style={{ marginRight: 12 }}>
          <Ionicons name="arrow-back" size={24} color="black" />
        </Pressable>

        {/* 📅 Date */}
        <Text style={{ fontSize: 18, fontWeight: "bold" }}>
          {selectedDate.toDateString()}
        </Text>
      </View>

      {/* 📋 List */}
      <FlatList
        data={bouldersForDay}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const level = levelTable[item.levelID]

          return (
            <BoulderRow
              item={{
                ...item,
                label: level?.label,
                color: level?.color
              }}
              onDelete={handleDelete}
            />
          )
        }}
      />

    </SafeAreaView>
  )
}