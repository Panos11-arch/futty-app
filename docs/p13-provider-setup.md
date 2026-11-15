# P13: Sign in with Apple and Google, setup for Panos

Dimitris holds no Apple or Google secrets. Everything below is set up by Panos, in the production Supabase project and the Apple and Google consoles. `<ref>` is the Supabase project ref.

## 1. Apple Developer (developer.apple.com → Certificates, Identifiers & Profiles)

1. **Identifiers → App ID `com.panosalepis.futtyapp`**: turn on **Sign in with Apple** (as a primary App ID). EAS picks this up from `ios.usesAppleSignIn` in app.json on the next build.
2. **Keys → +**: create a key with **Sign in with Apple** enabled and the primary App ID above configured. Download the `.p8` (it can only be downloaded once). Note its **Key ID** and your **Team ID** (top right of the portal).
3. **Identifiers → Services IDs → +** (e.g. `com.panosalepis.futtyapp.web`). This is only needed if Apple sign-in is ever offered on the web. The native iOS flow uses the bundle ID and does not need it.
   - Domains: `<ref>.supabase.co`
   - Return URL: `https://<ref>.supabase.co/auth/v1/callback`

## 2. Supabase Auth → Sign In / Providers → Apple

- **Enable** Apple.
- **Client IDs**: `com.panosalepis.futtyapp`. Add the Services ID after a comma only if you created one for web.
- **Secret Key (for OAuth)**: only needed with a Services ID. It is a JWT generated from the `.p8`, Team ID, Key ID and Services ID (Supabase's docs have a generator). **It expires after at most 6 months.** Put a calendar reminder to regenerate it.
- Leave **Skip nonce check** off. The app sends Apple a hashed nonce and Supabase the raw one, and Supabase must check them against each other.

## 3. Google Cloud Console (APIs & Services)

1. **OAuth consent screen**: app name Futty, support email, the scopes `openid`, `email` and `profile`, and the privacy policy and terms links. Publish it to production. In testing mode only listed test users can sign in.
2. **Credentials → Create OAuth client ID → Web application**:
   - Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`
   - Do **not** create iOS or Android clients. The app uses no native Google SDK.
3. Note the **Client ID** and **Client secret**.

## 4. Supabase Auth → Sign In / Providers → Google

- **Enable** Google.
- **Client IDs**: the Web client ID from step 3.
- **Client Secret**: the Web client secret from step 3.

The app uses the PKCE flow for Google: the redirect back carries only a one-time `?code=`, which the app exchanges for a session. No tokens are ever put in the redirect URL.

## 5. Supabase Auth → URL Configuration → Redirect URLs

- Add `futtyapp://auth/callback`. Google sign-in comes back here.
- Keep the existing `futtyapp://` and `futtyapp://reset-password` entries unchanged.
- Local and dev builds: the same three on the local or staging project.
- Expo Go only (local project, never production): Expo Go ignores the `futtyapp` scheme, so the redirect is `exp://<your computer's IP>:8081/--/auth/callback`. Add `exp://**/--/auth/callback` to the local project's Redirect URLs (or `additional_redirect_urls` in `supabase/config.toml`) to try Google there. Apple can't be tried in Expo Go.

## 6. Edge Function secrets (for `delete-account`, to revoke Apple tokens)

```
supabase secrets set \
  APPLE_TEAM_ID=<Team ID> \
  APPLE_SIGN_IN_KEY_ID=<Key ID of the Sign in with Apple key> \
  APPLE_SIGN_IN_PRIVATE_KEY="$(cat AuthKey_<KeyID>.p8)"
supabase functions deploy delete-account
```

The client ID is the bundle ID, already in `_shared/apple-app-store.ts`. These are separate from the App Store Server API key (`ASC_*`): a Sign in with Apple key is a different key type.

## 7. Identity linking

Keep Supabase's default **automatic linking**: an Apple or Google sign-in whose verified email matches an existing account joins that account. Do not enable manual linking. Apple's private relay emails (`…@privaterelay.appleid.com`) are accepted as they are, and never match an email account.

## 8. Build

Step 1 (`dimitris/p13-deps`) added `expo-apple-authentication`, `expo-crypto` and the Sign in with Apple capability, so a **new development build** is needed. Expo Go cannot show the Apple button.

## 9. Check after setup (on a dev build)

- Apple, first time: the name is saved → "Pick a username" → Home.
- Google: "Pick a username" → Home. The name from Google is already on the profile.
- Cancelling either shows no error.
- Delete an Apple account on iOS: the Apple sheet appears → the account is deleted. Futty then disappears from iOS Settings → Apple ID → Sign in with Apple.
- Delete an Apple account on iOS while the phone is signed into a different Apple ID: refused, nothing deleted.
- Delete an Apple-linked account on Android: deleted without the Apple sheet, and the `delete-account` logs say the revoke was skipped (decided 13 November, for Panos to confirm).
- Google on Android: after the browser closes there's no "Unmatched route" screen.
- Email sign-up, confirm and reset links still work as before.
