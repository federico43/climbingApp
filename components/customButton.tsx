import { C } from "@/utils/theme";
import { spacing } from '@/theme/spacing';
import { ActivityIndicator, StyleSheet, Pressable, Text } from "react-native";

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
  },
  contained: {
    backgroundColor: C.green,
    padding: spacing.md,
    borderRadius: 12,
  },
  text:{
    color: C.bg,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  textMode: {
    backgroundColor: "transparent",
  },
  containedLabel: {
    color: C.bg,
  },

  textLabel: {
    color: C.green,
  },
  disabled: {
    opacity: 0.4,
  },

});

type Props = {
  title: string;
  onPress?: () => void;   // 👈 function passed from parent
  mode?: "contained" | "text";
  disabled?: boolean;
  fontSize?: number
  /** Shows a spinner in place of the title and blocks taps. */
  loading?: boolean
};

//add the functionality 
export default function CustomButton({ title, onPress, mode = "contained",
  disabled = false, fontSize = 16, loading = false }: Props) {
  const blocked = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        mode === "contained" && styles.contained,
        mode === "text" && styles.textMode,
        pressed && !blocked && { opacity: 0.7 },
        disabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={mode === "contained" ? C.bg : C.green} />
      ) : (
      <Text
        style={[
          styles.text,
          mode === "contained" && styles.containedLabel,
          mode === "text" && styles.textLabel,
        ]}
      >
        {title}
      </Text>
      )}
    </Pressable>
  );
}

