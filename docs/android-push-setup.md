# Android push notifications (Firebase / FCM)

Android devices only get a push token from Expo when the native build carries a
Firebase config. Without it, `getExpoPushTokenAsync` fails on Android and the
athlete's row never gets a `pushToken`, so no pushes reach them.

## One-time setup

1. **Firebase project.** https://console.firebase.google.com → Add project
   (any name, Analytics off is fine).
2. **Android app in Firebase.** Project overview → Add app → Android.
   Package name must be exactly `com.fdqg18.testApp`. Skip the SDK steps.
3. **google-services.json.** Download it and put it at the repo root
   (`./google-services.json`, next to `app.json`). `app.json` points
   `android.googleServicesFile` at it. It is a client config, safe to commit.
4. **FCM V1 key for Expo.** Firebase → Project settings → Service accounts →
   Generate new private key (downloads a JSON; this one IS secret, never commit
   it). Then run `eas credentials -p android`, pick the `preview` profile →
   Google Service Account → Manage your Google Service Account Key for Push
   Notifications (FCM V1) → Upload a new service account key → choose that file.
5. **New Android build.** `eas build --platform android --profile preview`.
   Send the install link to the Android athletes; they install over the old app
   (same package and signing key, so their login stays).

## Runtime version

`runtimeVersion` uses the `appVersion` policy, so it stays `1.0.0`. Adding the
Firebase config doesn't change any JS-facing native module, so the new build and
the old builds keep receiving the same `eas update`s. No bump needed.

## Checking it works

Push can't be tested in the simulator. On a real Android phone with the new
build: sign in, accept notifications, then check the user's `pushToken` in
Appwrite (starts with `ExponentPushToken[`), and send a test from
https://expo.dev/notifications.
