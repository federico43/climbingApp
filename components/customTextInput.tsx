import { colors } from "@/theme/colors";
import { spacing } from '@/theme/spacing';
import { StyleSheet, Pressable,Text, View, TextInput, TextInputProps } from "react-native";

//show a default value
//save the state of whatever is saved. 
const styles = StyleSheet.create({
    container: {
    marginBottom: 16,
    backgroundColor: colors.textInputBox
  },
  label:{
    color: colors.dark,  // or colors.background for contrast
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
});

type InputProp = TextInputProps &{
    label?: string
    placeHolder?: string
}

export default function CustomTextInput ({label, placeHolder,...props}:InputProp) {
    return( 
        <View style={styles.container}>
          {label && <Text style={styles.label}>{label}</Text>}
    
          <TextInput
            style={[
              styles.input
            ]}
            placeholderTextColor= {colors.dark}

            placeholder= {placeHolder}
            {...props}
          />
        </View>
    )
}