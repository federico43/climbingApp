import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import CustomButton from '@/components/customButton'
import { useEffect, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { APPWRITE_ENDPOINT } from '@/components/AppWrite'
import { canReachServer, OFFLINE_MESSAGE } from '@/utils/network'
import CustomTextInput from '@/components/customTextInput'
import { colors, MainStyles } from '@/theme/colors'
import { C } from '@/utils/theme'
import { ConsumeAuth } from '@/components/auth-context'
import { useRouter } from 'expo-router'

type Mode = "signin" | "signup" | "forgot"

export default function AuthScreen() {
  const router = useRouter()
  const { signIn, signUp, sendRecovery, error, errorKind, refreshUser } = ConsumeAuth()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [userName, setUserName] = useState('')
  const [loading, setLoading]   = useState(false)
  const [mode, setMode]         = useState<Mode>("signin")
  const [recoverySent, setRecoverySent] = useState(false)
  // No connection to the server: checked on open (a light ping, no native
  // module), after a sign-in fails for lack of one, and on Retry.
  const [offline, setOffline] = useState(false)
  const [checking, setChecking] = useState(false)

  async function checkConnection(): Promise<boolean> {
    setChecking(true)
    const ok = await canReachServer(`${APPWRITE_ENDPOINT}/health/version`)
    setOffline(!ok)
    setChecking(false)
    return ok
  }

  useEffect(() => { checkConnection() }, [])
  useEffect(() => { if (errorKind === "network") setOffline(true) }, [errorKind])

  // Back online: re-read the session too — the app may have opened offline
  // with a saved session, which then signs the athlete straight in.
  async function retry() {
    if (await checkConnection()) await refreshUser()
  }

  async function handleSubmit() {
    if (loading) return
    // Known offline: check again rather than sending a request that can't arrive.
    if (offline && !(await checkConnection())) return

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

  const offlineBanner = offline && (
    <View style={styles.offline}>
      <Ionicons name="cloud-offline-outline" size={22} color={C.textPrimary} />
      <Text style={styles.offlineText}>{OFFLINE_MESSAGE}</Text>
      <Pressable onPress={retry} disabled={checking} style={styles.retryBtn} hitSlop={6}>
        {checking ? <ActivityIndicator size="small" color={C.bg} /> : <Text style={styles.retryText}>Retry</Text>}
      </Pressable>
    </View>
  )
  // The offline banner already says it; other errors show as before.
  const errorText = error && !(offline && errorKind === "network") ? error : null

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
              Enter the email address for your account and we&apos;ll send you a link to reset your password.
            </Text>
            {offlineBanner}
            <CustomTextInput placeHolder="email" onChangeText={setEmail} />
            {errorText && <Text style={styles.errorText}>{errorText}</Text>}
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

      {offlineBanner}

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

      {errorText && <Text style={styles.errorText}>{errorText}</Text>}

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
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surfaceHigh,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  offlineText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
    lineHeight: 19,
  },
  retryBtn: {
    minWidth: 64,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
    color: C.bg,
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
