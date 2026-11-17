// Venue dashboard: redeem a player's post-match offer code (A8; spec 13,
// "Post-match offers"). One field: staff type the code, check what it's for,
// then confirm. The server checks the caller is this venue's staff, the
// code is this venue's, unused, unexpired and not their own.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { checkOfferCode, describeOfferError, offerPrices, redeemOfferCode, type OfferCode } from '@/lib/post-match-offers';

export function OfferRedeemSection({ venueId }: { venueId: string }) {
  const [code, setCode] = useState('');
  const [checked, setChecked] = useState<OfferCode | null>(null);
  const [busy, setBusy] = useState<'check' | 'redeem' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function edit(text: string) {
    setCode(text);
    setChecked(null);
    setError(null);
    setDone(null);
  }

  async function check() {
    if (busy) return;
    setBusy('check');
    setError(null);
    setDone(null);
    const { data, error: callError } = await checkOfferCode(venueId, code);
    setBusy(null);
    if (callError) setError(describeOfferError(callError));
    else setChecked(data as OfferCode);
  }

  async function redeem() {
    if (busy || !checked) return;
    setBusy('redeem');
    setError(null);
    const { data, error: callError } = await redeemOfferCode(venueId, checked.code);
    setBusy(null);
    if (callError) {
      setError(describeOfferError(callError));
      setChecked(null);
      return;
    }
    setDone(`Redeemed: ${(data as OfferCode).offer.name}.`);
    setChecked(null);
    setCode('');
  }

  const prices = checked ? offerPrices(checked.offer) : null;

  return (
    <View style={styles.stack} testID="offer-redeem">
      <SectionHeader title="Redeem an offer" />
      <TextField
        label="Offer code"
        value={code}
        onChangeText={edit}
        placeholder="K7M2QX"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
      />
      {checked ? (
        <View style={styles.stack}>
          <Text variant="headline">{checked.offer.name}</Text>
          {prices?.now ? (
            <Text variant="callout" tabular>
              {prices.was ? `${prices.now} (normally ${prices.was})` : prices.now}
            </Text>
          ) : null}
          {checked.offer.offer_text ? <Text variant="callout">{checked.offer.offer_text}</Text> : null}
          <Button label="Redeem" onPress={redeem} loading={busy === 'redeem'} fullWidth />
          <Button label="Cancel" variant="plain" onPress={() => edit(code)} disabled={busy !== null} />
        </View>
      ) : (
        <Button label="Check code" variant="secondary" onPress={check} loading={busy === 'check'} disabled={code.trim() === ''} fullWidth />
      )}
      {error ? <Banner tone="danger" message={error} /> : null}
      {done ? <Banner tone="info" message={done} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
