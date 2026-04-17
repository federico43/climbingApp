// VideoRecorder.tsx
import { CameraView, useCameraPermissions } from 'expo-camera';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRef, useState } from 'react';

export default function VideoRecorder({ onFinish }: any) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);

  if (!permission) return <View />;

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text>Need camera permission</Text>
        <TouchableOpacity onPress={requestPermission}>
          <Text style={{ color: "blue", marginTop: 10 }}>Grant permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const startRecording = async () => {
    if (!cameraRef.current) return;

    try {
      setIsRecording(true);

      const video = await cameraRef.current.recordAsync({
        maxDuration: 60,
        quality: "720p",
      });

      onFinish(video.uri); // ✅ return video
    } catch (err) {
      console.log(err);
    } finally {
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      cameraRef.current.stopRecording();
    }
  };

  return (
  <View style={{ flex: 1, backgroundColor: "black" }}>
    <CameraView
      ref={cameraRef}
      style={{ width: "100%", height: "100%" }} // ✅ FIX
      facing="back"
      mode="video"
    />

    {/* Record Button */}
    <TouchableOpacity
      onPress={isRecording ? stopRecording : startRecording}
      style={{
        position: "absolute",
        bottom: 40,
        alignSelf: "center",
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: isRecording ? "#8B0000" : "#FF3B30",
      }}
    />
  </View>
)
}