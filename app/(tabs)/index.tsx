import CustomButton from '@/components/customButton'
//custom button I made. 
import LogBoulderModal from '@/components/logBoulderModal';
//Modal component that holds the log logic too.
import { View, Text,} from 'react-native'
import { ConsumeAuth } from '@/components/auth-context'
import {useState } from "react";
import { BarChart } from "react-native-gifted-charts";
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet,Dimensions} from "react-native";
import { useBoulderGraph } from '@/hooks/BoulderGraphToolKit'; 
import {Gesture, GestureDetector} from 'react-native-gesture-handler'
import { useRouter } from "expo-router"
import { useFocusEffect } from '@react-navigation/native'
import { useCallback } from 'react'
export default function index() {
  useFocusEffect(
  useCallback(() => {
    setRefreshKey(prev => prev + 1)
  }, [])
)
  //help handle the change of the graph. 
  const [weekOffset, setWeekOffset] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  const refreshGraph = () => setRefreshKey(prev => prev + 1)
  
  const GRAPH_WIDTH = Dimensions.get("window").width * 0.8
  
  //user Related information 
  const {signOut, userName, User} = ConsumeAuth()
  
  //Main variables needed to properly show the graph. 
  const {levelTable,stackData,stats,height,weekLabel,normalized, legend}= useBoulderGraph(refreshKey, weekOffset)
  
  //Modal related.
  const [modalVisible, setModalVisible] = useState(false)
  const openModal = () => setModalVisible(true)
  
  //change screens 
  const router = useRouter()
  
  //get day details
  function handleDayPress(item: any) {
  if (!item?.date) return

  router.push({
    pathname: "/daylogScreen",
    params: {
      date: item.date.toISOString()
    }
  })
}
  const swipeGesture = Gesture.Pan()
  .runOnJS(true)
  .onEnd((event) => {

    const x = event.translationX

    if (x < -20) {
      if (weekOffset<0){
        setWeekOffset(prev => prev + 1)
        console.log("x)")
      }
      
    }

    if (x > 20) {

      setWeekOffset(prev => prev - 1)
      
    }

  })

    
  return (
    
    <SafeAreaView style={styles.container}>

  {/* HEADER */}
  <Text style={styles.userName}>
    {userName}'s Recorded Boulders
  </Text>

  {/* GRAPH */}
  <GestureDetector gesture={swipeGesture}>
    <View style={styles.graphCard}>
      <Text style={styles.weekLabel}>
        {weekLabel}
      </Text>
      <BarChart
        stackData={stackData}
        width={GRAPH_WIDTH}
        height={height*30}
        maxValue={height}
        yAxisThickness={0}
        xAxisThickness={0}
        noOfSections={height}
        scrollToEnd={true}
          // 👈 reduce space before first bar
        spacing={10}          // 👈 reduce space BETWEEN bars
        //barWidth={18}
        onPress={(item:any) => handleDayPress(item)}
      />
      <View style={styles.legendContainer}>
        <Text> Difficulty:</Text>
         
        {legend?.map((item, index) => (
          <View key={index} style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: item.color }]} />
            <Text style={styles.legendLabel}>{item.label}</Text>
          </View>
        ))}
      </View> 
{/* PRIMARY ACTION */}
  <View style={styles.action}>
    <CustomButton title="Log Boulder" onPress={openModal} />
  </View>
    </View>
  </GestureDetector>

  

  {/* STATS */}
  <View style={styles.statsCard}>
    <Text style={styles.statsText}>{stats}</Text>
  </View>

  {/* FOOTER */}
  <View style={styles.bottom}>
    <CustomButton title="Sign Out" onPress={signOut} mode="text" />
  </View>

  <LogBoulderModal
    modalVisible={modalVisible}
    setModalVisibility={setModalVisible}
    onLogged={refreshGraph}
    levels={levelTable}
  />

</SafeAreaView>
    
  )
}

const styles = StyleSheet.create({
weekLabel: {
  fontSize: 16,
  fontWeight: '600',
  textAlign: 'center',
  marginBottom: 8,
  color: '#444',
},
container: {
  flex: 1,
  padding: 20,
  justifyContent: "space-between"
},

userName: {
  fontSize: 22,
  fontWeight: "600",
  textAlign: "center",
  marginBottom: 10
},

graphCard: {
  backgroundColor: "#fff",
  borderRadius: 16,
  padding: 10,
  alignItems: "center",
  elevation: 3,
 
},

statsCard: {
  marginTop: 10,
  padding: 15,
  borderRadius: 12,
  backgroundColor: "#f5f5f5"
},

statsText: {
  fontSize: 16,
  textAlign: "center"
},

action: {
  marginTop: 15,
  alignItems: "center"
},

bottom: {
  alignItems: "center",
  marginBottom: 10
},
legendContainer: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'center',
  marginTop: 10,
},

legendItem: {
  flexDirection: 'row',
  alignItems: 'center',
  marginHorizontal: 6,
  marginVertical: 4,

},

legendColor: {
  width: 12,
  height: 12,
  borderRadius: 3,
  marginRight: 6,
},

legendLabel: {
  fontSize: 12,
  color: '#444',
}
});



