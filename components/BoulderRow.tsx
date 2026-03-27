import React, { useRef } from "react"
import { View, Text, Pressable } from "react-native"
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable'

type BoulderRowProps = {
  item: {
    id: string
    levelID: string
    label?: string
    color?: string
  }
  onDelete: (id: string) => void
}

export default function BoulderRow({ item, onDelete }: BoulderRowProps) {

  // 🧠 Ref to control this swipeable row (useful later if you want to close it programmatically)
  const swipeableRef = useRef<any>(null)

  // 👉 What appears when user swipes LEFT
  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        swipeableRef.current?.close() // close swipe UI after pressing
        onDelete(item.id)             // trigger delete logic from parent
      }}
      style={{
        backgroundColor: "red",
        justifyContent: "center",
        alignItems: "center",
        width: 80
      }}
    >
      <Text style={{ color: "white", fontWeight: "bold" }}>
        Delete
      </Text>
    </Pressable>
  )

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false} // prevents weird bounce effect
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",

          // 🎨 visual style
          padding: 16,
          backgroundColor: "#fff",
          borderBottomWidth: 1,
          borderColor: "#eee"
        }}
      >

        {/* 🎯 Difficulty color indicator (left bar) */}
        <View
          style={{
            width: 6,
            height: "100%",
            backgroundColor: item.color || "#ccc",
            marginRight: 12,
            borderRadius: 3
          }}
        />

        {/* 📄 Boulder info */}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "600" }}>
            {item.label || item.levelID}
          </Text>
        </View>

      </View>
    </Swipeable>
  )
}