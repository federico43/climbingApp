import { View, Text, StyleSheet, Pressable } from 'react-native'
import CustomButton from '@/components/customButton'
import { useState } from 'react'
import CustomTextInput from '@/components/customTextInput'
import { colors, MainStyles } from '@/theme/colors'
import { C } from '@/utils/theme'
import { ConsumeAuth } from '@/components/auth-context'
import { useRouter } from 'expo-router'

type Mode = "signin" | "signup" | "forgot"

export default function AuthScreen() {
  const router = useRouter()
  const { signIn, signUp, sendRecovery, error } = ConsumeAuth()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [userName, setUserName] = useState('')
  const [loading, setLoading]   = useState(false)
  const [mode, setMode]         = useState<Mode>("signin")
  const [recoverySent, setRecoverySent] = useState(false)

  async function handleSubmit() {
    if (loading) return

    if (mode === "forgot") {
      if (!email) return
      setLoading(true)
      try {
        const ok = await sendRecovery(email)
        if (ok) setRecoverySent(true)
      } finally {
        setLoading(false)
      }
      return
    }

    if (!email || !password || (mode === "signup" && !userName)) return
    setLoading(true)
    try {
      if (mode === "signin") {
        const success = await signIn(email, password)
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

  // ── Forgot password screens ────────────────────────────────────────────────
  if (mode === "forgot") {
    return (
      <View style={styles.container}>
        <Text style={MainStyles.ScreenTitle}>Reset password</Text>

        {recoverySent ? (
          <>
            <Text style={styles.successText}>
              Check your email — we sent a reset link. Click it to set a new password.
            </Text>
            <CustomButton title="Back to sign in" onPress={() => { setMode("signin"); setRecoverySent(false) }} />
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Enter the email address for your account and we'll send you a link to reset your password.
            </Text>
            <CustomTextInput placeHolder="email" onChangeText={setEmail} />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <CustomButton title={loading ? "Sending…" : "Send reset link"} onPress={handleSubmit} disabled={loading} />
            <CustomButton title="Back to sign in" onPress={() => setMode("signin")} mode="text" />
          </>
        )}
      </View>
    )
  }

  // ── Sign in / Sign up ──────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Text style={MainStyles.ScreenTitle}>
        {mode === "signin" ? "Welcome Back" : "Create Account"}
      </Text>

      {mode === "signup" && (
        <CustomTextInput placeHolder="user name" onChangeText={setUserName} />
      )}
      <CustomTextInput placeHolder="email" onChangeText={setEmail} />
      <CustomTextInput placeHolder="password" onChangeText={setPassword} secureTextEntry />

      <CustomButton
        title={mode === "signin" ? "Sign In" : "Sign Up"}
        onPress={handleSubmit}
        disabled={loading}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      {mode === "signin" && (
        <Pressable onPress={() => setMode("forgot")} style={styles.forgotBtn}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>
      )}

      <CustomButton
        title={mode === "signin" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
        onPress={() => setMode(mode === "signin" ? "signup" : "signin")}
        mode="text"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 4,
    backgroundColor: C.bg,
  },
  errorText: {
    color: colors.text,
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 20,
  },
  successText: {
    fontSize: 15,
    color: C.textPrimary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  forgotBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
  },
  forgotText: {
    fontSize: 14,
    color: C.textSecondary,
  },
})
