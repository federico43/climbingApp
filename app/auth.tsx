import { View, Text, StyleSheet} from 'react-native'
import CustomButton from '@/components/customButton'
import { useState } from 'react'
import CustomTextInput from '@/components/customTextInput'
import { colors, MainStyles } from '@/theme/colors'
import { ConsumeAuth } from '@/components/auth-context'
import { useRouter } from 'expo-router'

export default function auth() {
  //re route to main page when user is authorized
  const router = useRouter()
  //holder variable for information 
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [userName, SetUserName] = useState('')
  //bool variables for functionality
  const [loading, setLoading] = useState(false)
  const [isSignIn, setIsSignIn] = useState(true)
  //important functions 
  const {signIn,signUp,error} = ConsumeAuth()
  //funct to uptade Sign in variable. 
  const toggleAuthMode = () => setIsSignIn(prev => !prev)
  const button1Text = isSignIn ? "Sign In" : "Sign Up"
  const button2Text = isSignIn
    ? "Don't have an account? Sign up"
    : "Already have an account? Sign in"
  
  //Decides what service to use (sign up or sign in)
  //this services com from auth-context.tsx
  const handleSubmit = async () => {
  //if variables are empty don't call api
  if (!email || !password || (!isSignIn && !userName)) {
    return
  }
  //if a request is being procesed don't call api again
  else if(loading) return
  //change loading state
  setLoading(true)

  try { 
    //if we are signin in
    if (isSignIn) {
      //call sing in function
      const success = await signIn(email, password)
      //if the sign in function has an error it will be shown in the error variable .
      if (success) router.replace('/')
    } else {
      const created = await signUp(email, password, userName)
      if (created) {
        const loggedIn = await signIn(email, password)
        if (loggedIn) router.replace('/OnBoarding')
      }
    }
  } finally {
    setLoading(false)
  }
}

  return (
    <View style = {styles.container}>
      <Text style= {MainStyles.ScreenTitle}>
        {isSignIn ? "Welcome Back" : "Create Account"}
      </Text>
      {!isSignIn && (
  <CustomTextInput
    placeHolder="user name"
    onChangeText={SetUserName}
    style={{color:"black"}}
  />
)}
      <CustomTextInput  placeHolder='email' onChangeText={setEmail} style={{color:"black"}}/>
      <CustomTextInput  placeHolder='password' onChangeText={setPassword} style={{color:"black"}} />
      {/* button 1*/}
      <CustomButton title={button1Text} onPress={handleSubmit}  disabled={loading} /> 
      {error && (
      <Text style={{color: colors.text, textAlign: 'center'}}>
      {error}
  </Text>
)}
      {/* button 2*/}
      <CustomButton title={button2Text} onPress={toggleAuthMode} mode='text'/> 
    </View>
  )
}
const styles = StyleSheet.create({
  container: {
    flex: 1,                 // takes full screen height
    justifyContent: "center", // vertical center
    paddingHorizontal: 20,
    backgroundColor: colors.backGround
  },
});

