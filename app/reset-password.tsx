import { paperSheet, useSheet } from "@/theme/paper/legacy"
import { account } from '@/components/AppWrite'
import CustomButton from '@/components/customButton'
import CustomTextInput from '@/components/customTextInput'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Melt, PaperBackground, PosterHeadline } from '@/components/paper'

export default function ResetPasswordScreen() {
  const styles = useSheet(stylesSheet)
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
      <PaperBackground>
      <View style={styles.container}>
        <Title>Password updated</Title>
        <Text style={styles.subtitle}>Your password has been changed. You can now sign in with your new password.</Text>
        <CustomButton title="Sign in" onPress={() => router.replace('/auth')} />
      </View>
      </PaperBackground>
    )
  }

  return (
    <PaperBackground>
    <View style={styles.container}>
      <Title>New password</Title>
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
    </PaperBackground>
  )
}

// The screen's poster headline (one per screen) with the melt behind it.
function Title({ children }: { children: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Melt top={10} height={240} />
      <PosterHeadline size={64}>{children}</PosterHeadline>
    </View>
  )
}

const stylesSheet = paperSheet((C) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
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
}))
