import { File, Paths } from 'expo-file-system';

export const saveVideoLocally = async (uri: string): Promise<string | null> => {
  try {
    const fileName = `video_${Date.now()}.mp4`;
    const dest = new File(Paths.document, fileName);
    const source = new File(uri);
    console.log(">>>")
    source.copy(dest);
    return dest.uri;
  } catch (err) {
    console.log("Save error:", err);
    return null;
  }
};