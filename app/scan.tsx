// S20: Scan (the player card's Scan button, lib/player-card.ts scanRoute).
// The camera reads another player's Futty card QR (futty.app/p/<username>,
// S19) and opens their sheet (app/p/[username].tsx). Anything else is
// refused here with one line; a blocked player, or for an adult a minor,
// is "Player not found" on the sheet (the server decides, A5).
//
// Camera permission, as the check-in scanner: not asked yet → Allow camera;
// denied → one line and Open settings.
//
// Not listed in app/_layout.tsx: like check-in.tsx, the route works on its own.
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { radius, space } from '@/constants/futty-theme';
import { parseFuttyQr, playerCardHref } from '@/lib/friends';
import { haptic } from '@/lib/haptics';
import { makeStyles, useTheme } from '@/lib/theme';

export const NOT_A_CARD = 'Not a Futty player card. Scan another code.';
export const CAMERA_DENIED = 'Camera is off for Futty. Allow it in Settings.';

const QR_ONLY = { barcodeTypes: ['qr' as const] };

export default function ScanScreen() {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState<string | null>(null);
  // One scan at a time: the camera reports the same QR many times a second.
  const lock = useRef(false);
  const [locked, setLocked] = useState(false);

  function hold(on: boolean) {
    lock.current = on;
    setLocked(on);
  }

  function scanned({ data }: BarcodeScanningResult) {
    if (lock.current) return;
    hold(true);
    const username = parseFuttyQr(data);
    if (!username) {
      haptic.error();
      setProblem(NOT_A_CARD);
      return;
    }
    haptic.tap();
    router.replace(playerCardHref(username));
  }

  function scanAgain() {
    setProblem(null);
    hold(false);
  }

  let content: React.ReactNode;
  if (!permission?.granted) {
    const askable = !permission || permission.canAskAgain;
    content = (
      <View style={styles.stack} testID="scan-permission">
        {permission && !askable ? <Text accessibilityRole="alert">{CAMERA_DENIED}</Text> : null}
        {askable ? (
          <Button testID="scan-allow-camera" label="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <Button testID="scan-open-settings" label="Open settings" variant="secondary" onPress={() => void Linking.openSettings()} />
        )}
      </View>
    );
  } else {
    content = (
      <View style={styles.stack}>
        <View style={styles.camera} testID="scan-camera" accessibilityLabel="Camera. Point it at a Futty player card.">
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={QR_ONLY}
            onBarcodeScanned={locked ? undefined : scanned}
          />
        </View>
        {problem ? (
          <>
            <Text testID="scan-problem" tone="danger" accessibilityRole="alert">
              {problem}
            </Text>
            <Button testID="scan-again" label="Scan again" onPress={scanAgain} />
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="scan-screen">
      <Stack.Screen
        options={{
          title: 'Scan',
          headerStyle: { backgroundColor: colors.canvas },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontFamily: type.headline.fontFamily, color: colors.ink },
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      {content}
      <Button testID="scan-cancel" label="Cancel" variant="plain" onPress={() => router.back()} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas, padding: space.lg, gap: space.lg },
  stack: { gap: space.md },
  camera: { aspectRatio: 1, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.night },
}));
