// "Missing a venue?": a venue name and town, sent to the founders. The
// server allows 5 a day.
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Sheet, Text, TextField } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { makeStyles } from '@/lib/theme';

export type MissingVenueSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Sends it; rejects with the words to show. */
  onSend: (venueName: string, town: string) => Promise<void>;
};

export function MissingVenueSheet({ visible, onClose, onSend }: MissingVenueSheetProps) {
  const styles = useStyles();
  const [name, setName] = useState('');
  const [town, setTown] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName('');
      setTown('');
      setError(null);
    }
  }, [visible]);

  const ready = name.trim().length > 0 && town.trim().length > 0;

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(name, town);
      haptic.success();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t send this. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Missing a venue?"
      primaryAction={{ label: 'Send', testID: 'missing-venue-send', disabled: !ready, loading: sending, onPress: send }}>
      <View style={styles.form}>
        <TextField testID="missing-venue-name" label="Venue name" value={name} onChangeText={setName} maxLength={100} />
        <TextField testID="missing-venue-town" label="Town" value={town} onChangeText={setTown} maxLength={60} />
        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  form: { gap: space.md },
}));
