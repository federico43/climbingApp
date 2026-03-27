import { View, Text, Platform} from 'react-native'
import React from 'react'
import { Modal } from 'react-native'
import { useState } from 'react'
import WheelPicker from '@quidone/react-native-wheel-picker';
import CustomButton from './customButton';
import DateTimePicker from "@react-native-community/datetimepicker";
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons'
import { Pressable } from "react-native";
import { getBoulderLevels, logRecord } from '@/services/BoulderGraphService';
import { ID } from 'appwrite';
import { Level } from '@/hooks/BoulderGraphToolKit';
import { account } from './AppWrite';


type ModalProp = {
    modalVisible: boolean,
    setModalVisibility: (boolean: boolean) => void
    onLogged: () => void
    levels: Record<string, Level>

}
const BoulderLevelOptions = [
    {
        label: "Blue",
        value: "blue",
    },
    {
        label: "Green",
        value: "green",
    },
    
    {
        label: "yellow",
        value: "yellow",
    },
    {
        label: "red",
        value: "red",
    },
    {
        label: "black",
        value: "black",
    },
]
const BoulderAttemptsOptions = [
    {
        label: "flash",
        value: "1",
    },
    {
        label: "2nd attempt",
        value: "2",
    },
    
    {
        label: "3+ attempts",
        value: "3",
    },
]
const BoulderMultiplierOption = [
  {
        label: "x1",
        value: "1",
  },
  {
        label: "x2",
        value: "2",
  },
  {
        label: "x3",
        value: "3",
  },
  {
        label: "x4",
        value: "4",
  },

]
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(44, 44, 44, 0.5)",
  },
  modal: {
    padding: 60,
    borderRadius: 8,
    backgroundColor: "white",
    width: "85%",
    height: "50%",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    borderColor: 'red'
  }
})
export default function LogBoulderModal({modalVisible, setModalVisibility, onLogged, levels}:ModalProp) {
    const [dateLog, setDateLog] = useState<Date>(new Date());
    const [showDatePicker, setShow] = useState<boolean>(false);
    const [chosenLevel, setLevel] = useState("green")
    const [chosenAttempt, setAttempts] = useState('1') //the starting value has to be 'value' parameter in the oprtons of rthe picker
    const [chosenMultiplier, setMultiplier] = useState('1')
    const onChange = (event: any, selectedDate?: Date) => {
      const currentDate = selectedDate || dateLog;
      setShow(Platform.OS === "ios");  // if its android it will be false -> close the picker 
      setDateLog(currentDate);
    };

    return (
     <Modal
  transparent
  animationType="slide"
  visible={modalVisible}
  onRequestClose={() => setModalVisibility(false)}
>
  <View style={styles.overlay}>
    
    {/* Invisible layer that captures outside touches */}
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={() => setModalVisibility(false)}
    />

    {/* Modal content */}
    <View
      style={styles.modal}
      onStartShouldSetResponder={() => true}
    >
      <View style={{ gap: 19, flexDirection: 'row' }}>
        <WheelPicker
          data={BoulderLevelOptions}
          value={chosenLevel}
          onValueChanged={({ item: { value } }) => setLevel(value)}
          enableScrollByTapOnItem={true}
        />
        <WheelPicker
          data={BoulderAttemptsOptions}
          value={chosenAttempt}
          onValueChanged={({ item: { value } }) => setAttempts(value)}
          enableScrollByTapOnItem={true}
        />
        <WheelPicker
          data={BoulderMultiplierOption}
          value={chosenMultiplier}
          onValueChanged={({ item: { value } }) => setMultiplier(value)}
          enableScrollByTapOnItem={true}
        />
      </View>

      <Pressable onPress={() => setShow(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Ionicons name="calendar-outline" size={28} color="black" />
          <Text>{createLabelDate(dateLog)}</Text>
        </View>
      </Pressable>

      {showDatePicker && (
        <DateTimePicker
          value={dateLog}
          mode="date"
          display="default"
          onChange={onChange}
        />
      )}

      <CustomButton
        title="log"
        onPress={() => {
          setModalVisibility(false)
          sendData(
            chosenLevel,
            chosenAttempt,
            dateLog,
            onLogged,
            levels,
            chosenMultiplier
          )
        }}
      />
    </View>
  </View>
</Modal>
  )
}

function createLabelDate(date: Date): string| undefined {
  const today = new Date()
  const yesterday = new Date()
  let label = ''

  yesterday.setDate(today.getDate() - 1)

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()

  if (isSameDay(date, today)) {
    label ="Today"
  }

  else if (isSameDay(date, yesterday)) {
    label = "Yesterday"
  }
  else{ 
     const day = date.getDate()
    //get the currently processed date 
    const month = date.toLocaleString("en-US", { month: "short" })
    label = `${month} ${day}`
    
  }
    return (label)
  }

async function sendData(
  chosenLevel: string,
  chosenAttempt: string,
  chosenDate: Date,
  onLogged: () => void,
  levels: Record<string, Level>,
  multiplier: string
) {
  const levelID = Object.entries(levels)
    .find(([_, value]) => value.label === chosenLevel)?.[0]

  if (!levelID) return

  const user = await account.get()

  const attempts = Number(chosenAttempt)
  const repeat = Number(multiplier)

  try {
    const promises = Array.from({ length: repeat }).map(() =>
      logRecord('boulders_realizados', {
        $id: ID.unique(),
        fecha: chosenDate,
        nivelesBoulder: levelID,
        attempts,
        userID: String(user.$id)
      })
    )

    await Promise.all(promises)

    onLogged()
  } catch (error) {
    console.log(error)
  }
}