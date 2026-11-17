// The venue's post-match offers on the match screen (A8; spec 05 "Food and
// drink after the game", spec 13 "Post-match offers"). The server decides
// which show (a score is in, the item is on now in Cyprus time) and makes
// the code; tapping an offer shows "Show this at the counter" with it.
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import {
  describeOfferError,
  offerPrices,
  openPostMatchOffer,
  usePostMatchOffers,
  type OfferCode,
  type PostMatchOffer,
} from '@/lib/post-match-offers';

export function PostMatchOffers({ matchId }: { matchId: string }) {
  const { state, reload } = usePostMatchOffers(matchId);
  const [opening, setOpening] = useState<string | null>(null);
  const [code, setCode] = useState<OfferCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(offer: PostMatchOffer) {
    if (opening) return;
    setOpening(offer.id);
    setError(null);
    const { data, error: callError } = await openPostMatchOffer(matchId, offer.id);
    setOpening(null);
    if (callError) {
      setError(describeOfferError(callError));
      reload();
      return;
    }
    setCode(data as OfferCode);
  }

  if (state.status === 'loading') return null;
  if (state.status === 'error') {
    return <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: reload }} />;
  }
  if (state.offers.length === 0) return null;

  return (
    <View style={styles.stack} testID="post-match-offers">
      <SectionHeader title="Post-match offers" />
      {error ? <Banner tone="danger" message={error} /> : null}
      {state.offers.map((offer) => (
        <OfferCard
          key={offer.id}
          offer={offer}
          photoUrl={offer.photo_path ? state.photoUrls[offer.photo_path] : undefined}
          onPress={() => open(offer)}
        />
      ))}
      <Sheet visible={code !== null} onClose={() => setCode(null)} title="Show this at the counter">
        {code ? <CodeView code={code} /> : null}
      </Sheet>
    </View>
  );
}

function Prices({ offer }: { offer: Pick<PostMatchOffer, 'price_cents' | 'offer_price_cents'> }) {
  const prices = offerPrices(offer);
  if (!prices.now) return null;
  return (
    <View style={styles.prices}>
      {prices.was ? (
        <Text variant="callout" tone="inkMuted" tabular style={styles.struck} accessibilityLabel={`was ${prices.was}`}>
          {prices.was}
        </Text>
      ) : null}
      <Text variant="headline" tabular>
        {prices.now}
      </Text>
    </View>
  );
}

function OfferCard({ offer, photoUrl, onPress }: { offer: PostMatchOffer; photoUrl?: string; onPress: () => void }) {
  return (
    <Card padded={false} onPress={onPress} accessibilityLabel={`${offer.name}, show the code`} testID={`post-match-offer-${offer.id}`}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} contentFit="cover" accessibilityLabel={offer.name} style={styles.photo} />
      ) : null}
      <View style={styles.body}>
        <View style={styles.title}>
          <Text variant="headline" style={styles.flex}>
            {offer.name}
          </Text>
          <Prices offer={offer} />
        </View>
        {offer.offer_text ? <Text variant="callout">{offer.offer_text}</Text> : null}
      </View>
    </Card>
  );
}

function CodeView({ code }: { code: OfferCode }) {
  return (
    <View style={styles.stack} testID="offer-code">
      <Text variant="display" tabular accessibilityLabel={`Code ${code.code.split('').join(' ')}`} style={styles.code}>
        {code.code}
      </Text>
      <View style={styles.title}>
        <Text variant="headline" style={styles.flex}>
          {code.offer.name}
        </Text>
        <Prices offer={code.offer} />
      </View>
      {code.offer.offer_text ? <Text variant="callout">{code.offer.offer_text}</Text> : null}
      <Text variant="callout" tone={code.redeemed_at ? 'success' : 'inkMuted'}>
        {code.redeemed_at ? 'Redeemed.' : 'Valid until midnight on the day of the match. It can be used once.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  flex: { flex: 1 },
  photo: { width: '100%', aspectRatio: 16 / 9, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  body: { padding: space.lg, gap: space.xs },
  title: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  prices: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  struck: { textDecorationLine: 'line-through' },
  code: { textAlign: 'center', letterSpacing: space.xs },
});
