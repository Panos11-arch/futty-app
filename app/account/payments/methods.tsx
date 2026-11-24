import { CustomerSheet } from '@stripe/stripe-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';
import { createSetupIntent } from '@/lib/payments';

/** Stripe's own CustomerSheet renders the actual list/add/remove-card UI —
 *  this screen just fetches the customer + ephemeral key + SetupIntent
 *  (create-setup-intent), initializes it, and opens it. Nothing here ever
 *  sees raw card data. Uses the imperative CustomerSheet.initialize/present
 *  API (there's no useCustomerSheet hook in the installed SDK version). */
export default function PaymentMethodsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [ready, setReady] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error: fetchError } = await createSetupIntent();
      if (fetchError || !data) {
        setError('Could not load payment methods — try again in a moment.');
        return;
      }

      const { error: initError } = await CustomerSheet.initialize({
        customerId: data.customerId,
        customerEphemeralKeySecret: data.ephemeralKey,
        setupIntentClientSecret: data.setupIntentClientSecret,
        merchantDisplayName: 'Futty',
        applePayEnabled: true,
        googlePayEnabled: true,
      });

      if (initError) {
        setError(initError.message);
        return;
      }

      setReady(true);
      const selection = await CustomerSheet.retrievePaymentOptionSelection();
      if (selection.paymentOption) setSelectedLabel(selection.paymentOption.label);
    })();
    // Only ever runs once per screen visit — re-initing on every render would
    // fight Stripe's own sheet state.
  }, []);

  async function openSheet() {
    setBusy(true);
    setError(null);
    const { error: presentError, paymentOption } = await CustomerSheet.present();
    setBusy(false);
    if (presentError) {
      setError(presentError.localizedMessage ?? 'Could not open payment methods.');
    } else if (paymentOption) {
      setSelectedLabel(paymentOption.label);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.content}>
        <View style={styles.noteRow}>
          <IconSymbol name="creditcard.fill" size={ICON.small} color={colors.inkMuted} />
          <Text variant="callout" tone="inkMuted" style={styles.flex}>
            Saved cards are used to pay your own share of a booking — managed entirely by Stripe.
          </Text>
        </View>

        {!ready && !error ? (
          <Card testID="methods-skeleton">
            <SkeletonText lines={2} />
          </Card>
        ) : null}

        {ready ? (
          <Card style={styles.card}>
            <Text variant="headline">{selectedLabel ? `Default: ${selectedLabel}` : 'No saved card yet'}</Text>
            <Button label="Manage payment methods" onPress={openSheet} loading={busy} />
          </Card>
        ) : null}

        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { gap: space.lg, padding: space.lg },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  card: { gap: space.md },
}));
