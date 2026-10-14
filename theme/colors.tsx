
import { StyleSheet } from "react-native"
import { C } from "@/utils/theme"

export const colors = {
  text: C.textPrimary,
  backGround: C.bg,
  primary: C.green,
  dark: C.bg,
  textInputBox: C.surfaceHigh,
}

export const MainStyles = StyleSheet.create({
  ScreenTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: C.textPrimary,
    marginBottom: 8,
    textAlign: "center",
  },
})
