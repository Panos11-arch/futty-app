// A6 "Share" on the match page (docs/specs/05-product.md section 6, cut down
// for launch). Only a confirmed match with a score has cards (shareCardData
// decides; nothing is shown otherwise). Share opens a sheet with the result
// card and, once voting has closed, the man-of-the-match card; each shares
// as a 1080 x 1920 PNG through the share sheet. A failed export says so
// inline with "Try again".
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type Svg from 'react-native-svg';

import { MotmCard, ResultCard } from '@/components/match/share-card';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { space } from '@/constants/futty-theme';
import type { MatchPage } from '@/lib/match/page';
import { canShareMotm, shareCardData } from '@/lib/match/share-card';
import { shareCardPng } from '@/lib/match/share-export';

/** Each preview's on-screen width; two sit side by side in the sheet. */
const PREVIEW = space.xxl * 4;

type CardKind = 'result' | 'motm';

const CARDS: Record<CardKind, { button: string; title: string }> = {
  result: { button: 'Share result card', title: 'Result card' },
  motm: { button: 'Share man of the match card', title: 'Man of the match card' },
};

export type MatchShareProps = { page: MatchPage };

/** Share on the match page: the button and its sheet. */
export function MatchShare({ page }: MatchShareProps) {
  const data = useMemo(() => shareCardData(page), [page]);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <>
      <Button label="Share" variant="secondary" onPress={() => setOpen(true)} testID="match-share" />
      <MatchShareSheet page={page} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The sheet with the cards to share (S7: the feed's result card opens it too). */
export function MatchShareSheet({ page, visible, onClose }: MatchShareProps & { visible: boolean; onClose: () => void }) {
  const data = useMemo(() => shareCardData(page), [page]);
  const [busy, setBusy] = useState<CardKind | null>(null);
  const [error, setError] = useState<{ kind: CardKind; message: string } | null>(null);
  const refs = { result: useRef<Svg>(null), motm: useRef<Svg>(null) };

  if (!data) return null;

  const share = async (kind: CardKind) => {
    const svg = refs[kind].current;
    setError(null);
    if (!svg) {
      setError({ kind, message: "The card couldn't be shared. Try again." });
      return;
    }
    setBusy(kind);
    const result = await shareCardPng(svg, `futty-${kind}-${data.matchId}.png`, CARDS[kind].title);
    setBusy(null);
    if (result.status === 'error') setError({ kind, message: result.message });
  };

  const close = () => {
    setError(null);
    onClose();
  };

  const kinds: CardKind[] = canShareMotm(data) ? ['result', 'motm'] : ['result'];

  return (
    <Sheet visible={visible} onClose={close} title="Share the match">
      <View style={styles.cards}>
        {kinds.map((kind) => (
          <View key={kind} style={styles.card} accessible={false}>
            <View accessible accessibilityRole="image" accessibilityLabel={CARDS[kind].title}>
              {kind === 'result' ? (
                <ResultCard data={data} width={PREVIEW} ref={refs.result} />
              ) : (
                <MotmCard data={data} width={PREVIEW} ref={refs.motm} />
              )}
            </View>
            <Button
              label={CARDS[kind].button}
              variant="secondary"
              onPress={() => share(kind)}
              loading={busy === kind}
              disabled={busy !== null && busy !== kind}
              testID={`share-${kind}`}
            />
          </View>
        ))}
      </View>
      {error ? (
        <Banner
          tone="danger"
          message={error.message}
          action={{ label: 'Try again', onPress: () => share(error.kind) }}
        />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' },
  card: { width: PREVIEW + space.xxl * 2, gap: space.sm, alignItems: 'center' },
});
