import { C } from "@/utils/theme";
import { spacing } from '@/theme/spacing';
import { StyleSheet, Text, View, TextInput, TextInputProps } from "react-native";

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    color: C.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: C.textPrimary,
    backgroundColor: C.surfaceHigh,
  },
});

type InputProp = TextInputProps & {
  label?: string
  placeHolder?: string
}

export default function CustomTextInput({ label, placeHolder, ...props }: InputProp) {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={styles.input}
        placeholderTextColor={C.textMuted}
        placeholder={placeHolder}
        {...props}
      />
    </View>
  )
}