import { C } from '@/utils/theme'
import { account } from '@/components/AppWrite'
import CustomButton from '@/components/customButton'
import CustomTextInput from '@/components/customTextInput'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

export default function ResetPasswordScreen() {
  const router = useRouter()
  const { userId, secret } = useLocalSearchParams<{ userId?: string; secret?: string }>()

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [done, setDone]           = useState(false)

  async function handleReset() {
    setError('')
    if (!password || !confirm) { setError("Please fill in both fields."); return }
    if (password !== confirm)  { setError("Passwords don't match."); return }
    if (password.length < 8)   { setError("Password must be at least 8 characters."); return }
    if (!userId || !secret)    { setError("Invalid or expired reset link."); return }

    setLoading(true)
    try {
      await account.updateRecovery(userId, secret, password)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset password. The link may have expired.")
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Password updated</Text>
        <Text style={styles.subtitle}>Your password has been changed. You can now sign in with your new password.</Text>
        <CustomButton title="Sign in" onPress={() => router.replace('/auth')} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>New password</Text>
      <Text style={styles.subtitle}>Choose a strong password for your account.</Text>

      <CustomTextInput placeHolder="New password" onChangeText={setPassword} secureTextEntry />
      <CustomTextInput placeHolder="Confirm new password" onChangeText={setConfirm} secureTextEntry />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <CustomButton
        title={loading ? "Updating…" : "Update password"}
        onPress={handleReset}
        disabled={loading}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
    backgroundColor: C.bg,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: C.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 12,
    lineHeight: 20,
  },
  error: {
    fontSize: 14,
    color: '#ff6b6b',
    textAlign: 'center',
  },
})
