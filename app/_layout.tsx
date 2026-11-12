import { APPLE_PAY_MERCHANT_ID } from '@/lib/wallet-pay';
import { Sentry } from '@/lib/sentry';

import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { ThemeProvider } from '@react-navigation/native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { FuttyAiChat } from '@/components/futty-ai-chat';
import { LockScreen } from '@/components/lock-screen';
import { FuttyColors, FuttyFonts, FuttyNavigationTheme } from '@/constants/futty-theme';
import { AppLockProvider, useAppLock } from '@/lib/app-lock';
import { AuthProvider, useAuth } from '@/lib/auth';
import { PushTapHandler } from '@/lib/push-tap';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Held up until fonts finish loading (below), rather than the default
// auto-hide — otherwise the splash could hide before Home's brand fonts are
// ready, flashing the fallback system font for a frame.
SplashScreen.preventAutoHideAsync();

// Applied to every pushed screen with a native header (Book, Squads, Premium)
// so the header matches the fixed brand look instead of React Navigation's
// default chrome. The ThemeProvider below should cascade this on its own, but
// setting it explicitly too means it doesn't depend on that cascade working
// correctly on every platform — cheap insurance for something unverifiable
// without a real device in front of me.
const brandedHeaderOptions = {
  headerStyle: { backgroundColor: FuttyColors.stone50 },
  headerTintColor: FuttyColors.stone900,
  headerTitleStyle: { fontFamily: FuttyFonts.sansSemiBold, color: FuttyColors.stone900 },
  // Chevron only, no previous screen's title next to it — the default
  // shows e.g. "< Profile" beside the back arrow on every pushed screen,
  // which reads as clutter rather than useful context.
  headerBackButtonDisplayMode: 'minimal',
} as const;

function RootNavigator() {
  const { session, initializing, isRecovering } = useAuth();
  const { locked } = useAppLock();

  // Rendering the guards before the stored session is read would flash the
  // sign-in screen for users who are already signed in.
  if (initializing) return null;

  // Returned in place of the navigator, not layered over it, so no app content
  // is mounted — or screenshotted by the OS task switcher — while locked.
  if (locked) return <LockScreen />;

  // A recovery link signs the user in before they have chosen a new password,
  // so the session alone is not enough to let them into the app.
  const signedIn = !!session && !isRecovering;

  return (
    // Explicit flex:1, not a bare Fragment — FuttyAiChat's launcher is
    // absolutely positioned against this box (item 9: it was rendering too
    // high, overlapping the status bar). <Stack>'s screens are native-screens
    // views that don't reliably hand a bare Fragment ancestor a full-height
    // box to measure "bottom" against; a real flex:1 View guarantees it.
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="modal"
            options={{ presentation: 'modal', title: 'Modal', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="premium-plan"
            options={{ presentation: 'modal', headerShown: false }}
          />
          {/* transparentModal + animation:'none': the screen itself renders
              PopupModal (item 3), which already slides in on its own — this
              avoids a jarring double-transition (native push, then the
              popup's own slide) stacked on top of it. */}
          <Stack.Screen
            name="fixture-confirmed"
            options={{ presentation: 'transparentModal', animation: 'none', headerShown: false }}
          />
          <Stack.Screen name="book" options={{ title: 'Book a pitch', ...brandedHeaderOptions }} />
          <Stack.Screen
            name="booking-payment"
            options={{ title: 'Split payment', ...brandedHeaderOptions }}
          />
          <Stack.Screen name="squads" options={{ title: 'Squads', ...brandedHeaderOptions }} />
          <Stack.Screen
            name="edit-profile"
            options={{ title: 'Edit profile', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="matchmaking"
            options={{ title: 'Matchmaking', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="fixture-chat"
            options={{ title: 'Chat', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="upcoming-fixtures"
            options={{ title: 'Upcoming fixtures', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="my-bookings"
            options={{ title: 'Your bookings', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="previous-games"
            options={{ title: 'Previous games', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="notifications"
            options={{ title: 'Notifications', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/index"
            options={{ title: 'Account', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/premium"
            options={{ title: 'Go Premium', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/activity/index"
            options={{ title: 'Your Activity', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/activity/matches"
            options={{ title: 'Matches', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/activity/teams"
            options={{ title: 'Teams', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/payments/index"
            options={{ title: 'Your Payments', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/payments/methods"
            options={{ title: 'Payment Methods', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/payments/transactions"
            options={{ title: 'All Transactions', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/settings/index"
            options={{ title: 'Settings', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/settings/privacy"
            options={{ title: 'Privacy', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/settings/notifications"
            options={{ title: 'Notifications', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="account/settings/security"
            options={{ title: 'Security', ...brandedHeaderOptions }}
          />
          <Stack.Screen name="account/help" options={{ title: 'Help', ...brandedHeaderOptions }} />
          <Stack.Screen
            name="account/how-it-works"
            options={{ title: 'How Futty Works', ...brandedHeaderOptions }}
          />
          <Stack.Screen name="account/terms" options={{ title: 'Terms of Use', ...brandedHeaderOptions }} />
          <Stack.Screen
            name="account/privacy-policy"
            options={{ title: 'Privacy Policy', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="venue-dashboard"
            options={{ title: 'Venue Dashboard', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="join-squad-post"
            options={{ title: 'Join as Player', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="player-profile"
            options={{ title: 'Player', ...brandedHeaderOptions }}
          />
          <Stack.Screen
            name="team-profile"
            options={{ title: 'Team', ...brandedHeaderOptions }}
          />
        </Stack.Protected>

        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="confirm-email" options={{ headerShown: false }} />
          <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {/* Global overlay, not a screen — available from every tab/pushed
          screen rather than needing its own route. Signed-in only, since it
          calls an authenticated Edge Function. */}
      {signedIn ? <FuttyAiChat /> : null}
      {signedIn ? <PushTapHandler /> : null}
    </View>
  );
}

// Floor on how long the native splash screen (app.json's expo-splash-screen
// plugin config — swap assets/images/splash-icon.png for the real green "F"
// crest once that asset exists; see this session's summary for why it
// wasn't swapped here) stays up. Fonts on a fast device/cache can finish in
// well under this, and hiding the splash the instant they do reads as an
// instantaneous, flickery jump cut rather than a deliberate loading state.
// 1.5s sits in the middle of the "1-2 seconds" asked for.
const MIN_SPLASH_MS = 1500;

export default Sentry.wrap(function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  const [minDelayElapsed, setMinDelayElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinDelayElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontsLoaded && minDelayElapsed) SplashScreen.hideAsync();
  }, [fontsLoaded, minDelayElapsed]);

  if (!fontsLoaded || !minDelayElapsed) return null;

  return (
    // Root cause of the recurring "close button unreachable" reports (items
    // 1 & 2): react-native-gesture-handler is a dependency of React
    // Navigation's native-stack, but nothing ever wrapped the app in
    // GestureHandlerRootView — required at the app root per React
    // Navigation's own setup docs. Without it, gesture-handler's native
    // responder system isn't initialized, which is documented to cause
    // exactly this class of bug (unreliable/dropped touches on nested
    // Pressables, especially Android) no matter how the button itself is
    // styled — restyling/z-index/hitSlop changes alone could never have
    // fixed it.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StripeProvider
        publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
        merchantIdentifier={APPLE_PAY_MERCHANT_ID}>
        <AuthProvider>
          <AppLockProvider>
            <ThemeProvider value={FuttyNavigationTheme}>
              <RootNavigator />
              {/* Fixed, not "auto": the background is always the light stone-50
                  brand color now, so status bar content should always be dark,
                  regardless of system light/dark mode. */}
              <StatusBar style="dark" />
            </ThemeProvider>
          </AppLockProvider>
        </AuthProvider>
      </StripeProvider>
    </GestureHandlerRootView>
  );
});
