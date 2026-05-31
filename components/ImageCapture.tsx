import { CameraType, CameraView, useCameraPermissions } from "expo-camera"
import * as FileSystem from "expo-file-system/legacy"
import { useRef, useState } from "react"
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native"

interface Props {
  onFinish: (uri: string) => void
  onClose: () => void
}

export default function ImageCapture({ onFinish, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<any>(null)
  const [facing, setFacing] = useState<CameraType>("back")
  const [cameraReady, setCameraReady] = useState(false)
  const [capturing, setCapturing] = useState(false)

  if (!permission) return <View />

  if (!permission.granted) {
    return (
      <View style={{
        flex: 1, backgroundColor: "#111",
        alignItems: "center", justifyContent: "center",
        gap: 16, padding: 32,
      }}>
        <Text style={{ fontSize: 48 }}>📷</Text>
        <Text style={{ color: "white", fontSize: 18, fontWeight: "700", textAlign: "center" }}>
          Camera access needed
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
          To take a photo of your project, allow access to the camera.
        </Text>
        <TouchableOpacity
          onPress={requestPermission}
          style={{ backgroundColor: "white", paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 8 }}
        >
          <Text style={{ color: "#111", fontSize: 16, fontWeight: "700" }}>Grant permission</Text>
        </TouchableOpacity>
      </View>
    )
  }

  async function handleCapture() {
    if (!cameraRef.current || !cameraReady || capturing) return
    setCapturing(true)
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      })
      const filename = `project_${Date.now()}.jpg`
      const dest = FileSystem.documentDirectory + filename
      await FileSystem.copyAsync({ from: photo.uri, to: dest })
      onFinish(dest)
    } catch (e) {
      console.error(e)
    } finally {
      setCapturing(false)
    }
  }

  const shutterDisabled = !cameraReady || capturing

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing={facing}
        mode="picture"
        onCameraReady={() => setCameraReady(true)}
      />

      {/* Camera initialising overlay */}
      {!cameraReady && (
        <View style={{
          ...StyleSheet.absoluteFillObject,
          backgroundColor: "black",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <ActivityIndicator color="white" size="large" />
        </View>
      )}

      {/* Back button */}
      <TouchableOpacity
        onPress={onClose}
        style={{
          position: "absolute", top: 40, left: 20,
          width: 44, height: 44, borderRadius: 22,
          backgroundColor: "rgba(255,255,255,0.2)",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 20, color: "white" }}>←</Text>
      </TouchableOpacity>

      {/* Flip camera */}
      <TouchableOpacity
        onPress={() => {
          setCameraReady(false)
          setFacing((prev) => (prev === "back" ? "front" : "back"))
        }}
        style={{
          position: "absolute", top: 40, right: 20,
          width: 44, height: 44, borderRadius: 22,
          backgroundColor: "rgba(255,255,255,0.2)",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 20 }}>🔄</Text>
      </TouchableOpacity>

      {/* Shutter button */}
      <TouchableOpacity
        onPress={handleCapture}
        disabled={shutterDisabled}
        style={{
          position: "absolute", bottom: 40, alignSelf: "center",
          width: 80, height: 80, borderRadius: 40,
          backgroundColor: "white",
          alignItems: "center", justifyContent: "center",
          opacity: shutterDisabled ? 0.4 : 1,
        }}
      >
        {capturing && <ActivityIndicator color="#111" />}
      </TouchableOpacity>
    </View>
  )
}

