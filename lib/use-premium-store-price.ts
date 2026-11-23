// The App Store's live price for Personal Premium (premium_monthly_v2), for
// every screen that shows it (F6): the Go Premium list and the plan sheet
// show the same string. null until the store has answered (or when it isn't
// connected): callers fall back to the rules' label through
// personalPremiumPriceLabel.
import { useIAP } from 'expo-iap';
import { useEffect } from 'react';

import { PERSONAL_PREMIUM_SKU, warnIfPremiumPriceDiffers } from '@/lib/premium';

export function usePremiumStorePrice(rulesLabel: string | null | undefined): string | null {
  const { connected, subscriptions, fetchProducts } = useIAP();

  useEffect(() => {
    if (connected) fetchProducts({ skus: [PERSONAL_PREMIUM_SKU], type: 'subs' });
  }, [connected, fetchProducts]);

  const livePrice = subscriptions.find((s) => s.id === PERSONAL_PREMIUM_SKU)?.displayPrice ?? null;

  useEffect(() => {
    warnIfPremiumPriceDiffers(livePrice, rulesLabel);
  }, [livePrice, rulesLabel]);

  return livePrice;
}
