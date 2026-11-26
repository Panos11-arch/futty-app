// Anything owed (debt, a failed guarantee, an unpaid spot, unticked cash), as
// one banner in Book's words (contract 6). Loading or an error shows nothing:
// Home is never blocked by it. Checks again on return, e.g. from "Pay what I
// owe". Moved from app/(tabs)/index.tsx in S3, unchanged.
import { router } from 'expo-router';
import { View } from 'react-native';

import { useReloadOn } from '@/components/home/refresh';
import { Banner } from '@/components/ui/banner';
import { debtBlockMessage, type Owed, owedBannerMessage, owedToName, useOwed, useReloadOnReturn } from '@/lib/use-owed';

const openPayOwed = () => router.push('/account/payments/owed');

/** Who the banner's money is owed to, picked from my_owed's own fields: the
 *  one venue (or Futty) every debt is owed to, else none; without a debt,
 *  the venue of the payment the sentence is about. */
function owedBannerTitle(owed: Owed): string | undefined {
  if (debtBlockMessage(owed)) {
    const names = new Set(owed.debts.map(owedToName));
    return names.size === 1 ? [...names][0] : undefined;
  }
  return owed.payments[0]?.venue_name;
}

export function OwedBanner({ refreshSignal }: { refreshSignal: number }) {
  const owed = useOwed();
  useReloadOnReturn(owed.reload);
  useReloadOn(refreshSignal, owed.reload);

  if (owed.state.status !== 'ready') return null;
  const message = owedBannerMessage(owed.state.data);
  if (!message) return null;

  return (
    <View testID="owed-banner">
      <Banner
        tone="danger"
        title={owedBannerTitle(owed.state.data)}
        message={message}
        action={{ label: 'Pay what I owe', onPress: openPayOwed }}
      />
    </View>
  );
}
