import { colors } from "@/theme/colors";
import { spacing } from '@/theme/spacing';
import { StyleSheet, Pressable,Text } from "react-native";

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
  },
  contained: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 12,
  },
  text:{
    color: colors.dark,  // or colors.background for contrast
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  textMode: {
    backgroundColor: "transparent",
  },
  containedLabel: {
    color: "black",
  },

  textLabel: {
    color: colors.text,
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
};

//add the functionality 
export default function CustomButton({ title, onPress, mode = "contained",
  disabled = false, fontSize = 16 }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        mode === "contained" && styles.contained,
        mode === "text" && styles.textMode,
        pressed && !disabled && { opacity: 0.7 },
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.text,
          mode === "contained" && styles.containedLabel,
          mode === "text" && styles.textLabel,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

