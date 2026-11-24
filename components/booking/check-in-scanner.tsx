// Scans the venue's check-in QR for one match (P6 check-in QR; expo-camera
// CameraView, QR codes only), or takes the code typed by hand. A QR for
// another game, or one that isn't Futty's, is refused here without asking
// the server; everything else goes to check_in_to_match through `onSubmit`.
//
// Camera permission: not asked yet → "Allow camera"; denied → a plain
// message, with Settings (or asking again, when the phone still allows it)
// and typing the code instead.
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Text, TextField } from '@/components/ui';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { checkLinkFor, normaliseCode, scanWords } from '@/lib/check-in';

export type CheckInScannerProps = {
  matchId: string;
  /** Resolves to the refusal in words, or null once checked in. */
  onSubmit: (code: string) => Promise<string | null>;
  onCancel: () => void;
};

const QR_ONLY = { barcodeTypes: ['qr' as const] };

export function CheckInScanner({ matchId, onSubmit, onCancel }: CheckInScannerProps) {
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'scan' | 'type'>('scan');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  // One scan at a time: the camera reports the same QR many times a second.
  const lock = useRef(false);
  const [locked, setLocked] = useState(false);

  function hold(on: boolean) {
    lock.current = on;
    setLocked(on);
  }

  async function submit(code: string) {
    setBusy(true);
    const refusal = await onSubmit(code);
    setBusy(false);
    setProblem(refusal);
  }

  async function scanned({ data }: BarcodeScanningResult) {
    if (lock.current) return;
    hold(true);
    const found = checkLinkFor(matchId, data);
    if (found.kind !== 'ok') {
      setProblem(scanWords(found.kind));
      return;
    }
    await submit(found.code);
  }

  function scanAgain() {
    setProblem(null);
    hold(false);
  }

  function backToCamera() {
    setProblem(null);
    hold(false);
    setMode('scan');
  }

  function typeCode() {
    setProblem(null);
    setMode('type');
  }

  const problemText = problem ? (
    <Text tone="danger" accessibilityRole="alert">
      {problem}
    </Text>
  ) : null;

  if (mode === 'type') {
    return (
      <View style={styles.stack}>
        <TextField
          label="Check-in code"
          helper="The code under the venue's QR. Spaces don't matter."
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        {problemText}
        <Button
          label="Check in with this code"
          loading={busy}
          disabled={normaliseCode(typed) === ''}
          onPress={() => submit(normaliseCode(typed))}
        />
        <Button label="Use the camera" variant="plain" onPress={backToCamera} />
        <Button label="Cancel" variant="plain" onPress={onCancel} />
      </View>
    );
  }

  if (!permission?.granted) {
    const denied = permission?.status === 'denied';
    const askable = !permission || permission.canAskAgain;
    return (
      <View style={styles.stack}>
        {permission ? (
          <Text>
            {denied
              ? "Futty can't use your camera. You can allow it in Settings, or type the code instead."
              : "Futty needs your camera to scan the venue's check-in code."}
          </Text>
        ) : null}
        {askable ? (
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <Button label="Open settings" variant="secondary" onPress={() => void Linking.openSettings()} />
        )}
        <Button label="Type the code" variant="secondary" onPress={typeCode} />
        <Button label="Cancel" variant="plain" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={QR_ONLY}
          onBarcodeScanned={locked ? undefined : scanned}
        />
      </View>
      <Text tone="inkMuted">{busy ? 'Checking you in…' : "Point your camera at the venue's check-in QR."}</Text>
      {problemText}
      {problem ? <Button label="Scan again" variant="secondary" onPress={scanAgain} /> : null}
      <Button label="Type the code instead" variant="plain" onPress={typeCode} />
      <Button label="Cancel" variant="plain" onPress={onCancel} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  stack: { gap: space.md },
  camera: {
    height: space.xxl * 9,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
}));
