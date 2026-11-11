import { PrimaryCTA } from "@/components/paper/Buttons"
import { paperSheet, usePaperScope, useSheet } from "@/theme/paper/legacy"
import { font } from "@/theme/paper/tokens"
import { spacing } from '@/theme/spacing';
import { StyleSheet, Pressable,Text } from "react-native";

const sheet = paperSheet((C) => StyleSheet.create({
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
    color: C.onAccent,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  textMode: {
    backgroundColor: "transparent",
  },
  containedLabel: {
    color: C.onAccent,
  },

  textLabel: {
    color: C.green,
  },
  disabled: {
    opacity: 0.4,
  },

}));

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
  const styles = useSheet(sheet)
  const paper = usePaperScope()
  // Workout flow (Paper Mint): the primary CTA; "Start" gets the play circle.
  if (paper && mode === "contained") {
    return <PrimaryCTA label={title} icon={/^start\b/i.test(title) ? "play" : null} onPress={onPress} disabled={disabled} />
  }
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
          paper && { fontFamily: font.bold, fontWeight: undefined },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
