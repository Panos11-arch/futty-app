import { CustomerSheet } from '@stripe/stripe-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError } from '@/components/auth-form';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { FuttyColors } from '@/constants/futty-theme';
import { createSetupIntent } from '@/lib/payments';

/** Stripe's own CustomerSheet renders the actual list/add/remove-card UI —
 *  this screen just fetches the customer + ephemeral key + SetupIntent
 *  (create-setup-intent), initializes it, and opens it. Nothing here ever
 *  sees raw card data. Uses the imperative CustomerSheet.initialize/present
 *  API (there's no useCustomerSheet hook in the installed SDK version). */
export default function PaymentMethodsScreen() {
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
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <View style={styles.content}>
        <IconLabel icon="creditcard.fill" iconColor={FuttyColors.stone500} style={styles.note}>
          Saved cards are used to pay your own share of a booking — managed entirely by Stripe.
        </IconLabel>

        {!ready ? <ActivityIndicator style={styles.loading} /> : null}

        {ready ? (
          <>
            <ThemedText style={styles.currentLabel}>
              {selectedLabel ? `Default: ${selectedLabel}` : 'No saved card yet'}
            </ThemedText>
            <AuthButton label="Manage payment methods" onPress={openSheet} busy={busy} compact />
          </>
        ) : null}

        {error ? <AuthError>{error}</AuthError> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 14,
    padding: 16,
  },
  note: {
    fontSize: 12,
    opacity: 0.8,
  },
  loading: {
    marginTop: 24,
  },
  currentLabel: {
    fontSize: 14,
    color: FuttyColors.stone900,
    fontWeight: '600',
  },
});
