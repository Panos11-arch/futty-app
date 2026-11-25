import { router } from 'expo-router';

import { IconButton } from '@/components/ui/icon-button';
import { futtyAiHref, NEW_CHAT } from '@/lib/futty-ai';

/**
 * The "?" in a header (spec 15 section 0.9: Book, the venue page and the
 * payment sheet): opens a new Futty AI chat. The venue page and the payment
 * sheet draw their own, beside Share and the booking line.
 */
export function AskAiButton({ testID }: { testID: string }) {
  return (
    <IconButton
      testID={testID}
      icon="questionmark.circle.fill"
      accessibilityLabel="Ask Futty AI"
      tone="inkMuted"
      onPress={() => router.push(futtyAiHref(NEW_CHAT))}
    />
  );
}
