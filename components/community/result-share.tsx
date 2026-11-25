// S7: Share on the feed's result card. Loads the match page (any signed-in
// player may open a confirmed match's page; names already follow A5) and
// opens the same sheet as the match page: a 1080 x 1920 story card through
// the phone's share sheet (Instagram Stories, WhatsApp, save).
import { useState } from 'react';
import { View } from 'react-native';

import { MatchShareSheet } from '@/components/match/match-share';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import type { MatchPage } from '@/lib/match/page';
import { getMatchPage } from '@/lib/match/page-api';
import { shareCardData } from '@/lib/match/share-card';
import { makeStyles } from '@/lib/theme';

export const SHARE_OPEN_FAILED = "Couldn't open the card. Try again.";

export function ResultShare({ matchId }: { matchId: string }) {
  const styles = useStyles();
  const [page, setPage] = useState<MatchPage | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function press() {
    if (busy) return;
    if (page) {
      setOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    const { page: loaded, error: loadError } = await getMatchPage(matchId);
    setBusy(false);
    if (loadError || !loaded || !shareCardData(loaded)) {
      setError(SHARE_OPEN_FAILED);
      return;
    }
    setPage(loaded);
    setOpen(true);
  }

  return (
    <View style={styles.wrap}>
      <Button
        testID={`feed-result-share-${matchId}`}
        label="Share"
        variant="secondary"
        fullWidth
        loading={busy}
        onPress={press}
      />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {page ? <MatchShareSheet page={page} visible={open} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.xs },
}));
