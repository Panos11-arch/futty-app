import { useEffect, useState } from 'react';

import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';

export type ReportSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Resolves with an error line, or null once sent. */
  onSend: (reason: string) => Promise<string | null>;
};

/** Report a chat or a message: one reason, then Send report. */
export function ReportSheet({ visible, onClose, onSend }: ReportSheetProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setReason('');
      setError(null);
    }
  }, [visible]);

  async function send() {
    if (!reason.trim() || busy) return;
    setBusy(true);
    const result = await onSend(reason.trim());
    setBusy(false);
    if (result) setError(result);
    else onClose();
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Report"
      primaryAction={{ label: 'Send report', onPress: send, loading: busy, disabled: !reason.trim(), testID: 'report-send' }}
      secondaryAction={{ label: 'Cancel', testID: 'report-cancel' }}>
      <TextField label="Reason" value={reason} onChangeText={setReason} multiline testID="report-reason" />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}
