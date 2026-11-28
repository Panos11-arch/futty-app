// S10A Knockout (SofaScore 17), top to bottom: the quarter-finals in bracket
// order (QF1 and QF3 feed SF1, QF2 and QF4 feed SF2, so a group's two teams
// can only meet in the final; decided 24 November), the semi-finals, then
// the final and the champion. Before a team is known its source shows ("A1",
// "Winner QF1"). A drawn game won on penalties shows AP with the shootout.
// Two cards per row so it reads at iPhone SE width and with large text.
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { KitTeamLink } from '@/components/competition/tournament/kit-team-link';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import {
  bracketHalves,
  fixtureStatusLabel,
  shootoutText,
  slotSide,
  stageTitle,
  type KnockoutSlot,
} from '@/lib/match/tournament-api';
import type { useTournamentKnockout } from '@/lib/match/use-tournament';
import { makeStyles, useTheme } from '@/lib/theme';

const SLOT_NAME: Record<string, string> = {
  QF1: 'QF1',
  QF2: 'QF2',
  QF3: 'QF3',
  QF4: 'QF4',
  SF1: 'SF1',
  SF2: 'SF2',
  F: 'Final',
};

function SlotCard({ slot }: { slot: KnockoutSlot }) {
  const styles = useStyles();
  const home = slotSide(slot, 'home');
  const away = slotSide(slot, 'away');
  const done = slot.status === 'completed';
  const homeWon = done && slot.winnerTeamId != null && slot.winnerTeamId === home.teamId;
  const awayWon = done && slot.winnerTeamId != null && slot.winnerTeamId === away.teamId;
  const shootout = slot.homePens !== undefined ? shootoutText({ homePens: slot.homePens ?? null, awayPens: slot.awayPens ?? null }) : null;
  const status =
    slot.status && slot.fixtureId
      ? fixtureStatusLabel({
          status: slot.status,
          kickoffAt: slot.kickoffAt ?? null,
          homePens: slot.homePens ?? null,
          awayPens: slot.awayPens ?? null,
        })
      : '';
  const score = (n: number | null | undefined) => (n == null ? '' : String(n));
  const open = slot.matchId ? () => router.push({ pathname: '/match/[id]', params: { id: slot.matchId! } }) : undefined;
  const spoken = [
    SLOT_NAME[slot.slot] ?? slot.slot,
    `${home.name} ${score(slot.homeScore)}`,
    `${away.name} ${score(slot.awayScore)}`,
    shootout ?? status,
  ]
    .filter((s) => s.trim())
    .join(', ');
  return (
    <View style={styles.cardWrap}>
      <Card testID={`tournament-knockout-${slot.slot}`} padded={false}>
        <Pressable
          accessibilityRole={open ? 'button' : undefined}
          accessibilityLabel={open ? `${spoken}. Open the match` : spoken}
          disabled={!open}
          onPress={open}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.cardHead}>
            <Text variant="caption" tone="inkMuted">
              {SLOT_NAME[slot.slot] ?? slot.slot}
            </Text>
            <Text variant="caption" tone="inkMuted" testID={`tournament-knockout-${slot.slot}-status`}>
              {shootout ?? status}
            </Text>
          </View>
          {[
            { side: home, won: homeWon, lost: awayWon, value: slot.homeScore },
            { side: away, won: awayWon, lost: homeWon, value: slot.awayScore },
          ].map(({ side, won, lost, value }, i) => (
            <View key={i} style={styles.side}>
              <KitTeamLink
                teamId={side.teamId}
                name={side.name}
                kitColour={side.kitColour}
                bold={won}
                tone={lost ? 'inkMuted' : 'ink'}
                testID={`tournament-knockout-${slot.slot}-${i === 0 ? 'home' : 'away'}`}
              />
              <Text variant="headline" tabular tone={lost ? 'inkMuted' : 'ink'}>
                {score(value)}
              </Text>
            </View>
          ))}
        </Pressable>
      </Card>
    </View>
  );
}

function Round({ title, slots }: { title: string; slots: KnockoutSlot[] }) {
  const styles = useStyles();
  if (slots.length === 0) return null;
  return (
    <View style={styles.round}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.grid}>
        {slots.map((s) => (
          <SlotCard key={s.slot} slot={s} />
        ))}
      </View>
    </View>
  );
}

export function KnockoutTab({
  knockout,
  championTeamId,
}: {
  knockout: ReturnType<typeof useTournamentKnockout>;
  championTeamId: string | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await knockout.reload();
    setRefreshing(false);
  };

  const halves = knockout.status === 'ready' ? bracketHalves(knockout.slots) : null;
  const final = halves?.final ?? null;
  const champion =
    final && championTeamId
      ? [slotSide(final, 'home'), slotSide(final, 'away')].find((s) => s.teamId === championTeamId) ?? null
      : null;

  return (
    <ScrollView
      testID="tournament-knockout"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {knockout.status === 'loading' ? (
        <View testID="tournament-knockout-skeleton" style={styles.round}>
          <SkeletonBlock width="100%" height={160} />
          <SkeletonBlock width="100%" height={120} />
        </View>
      ) : null}
      {knockout.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the knockout." action={{ label: 'Try again', onPress: knockout.reload }} />
      ) : null}
      {halves ? (
        <>
          <Round title={stageTitle('qf')} slots={[...halves.left.quarters, ...halves.right.quarters]} />
          <Round
            title={stageTitle('sf')}
            slots={[halves.left.semi, halves.right.semi].filter((s): s is KnockoutSlot => !!s)}
          />
          <Round title={stageTitle('final')} slots={final ? [final] : []} />
          {champion ? (
            <Card testID="tournament-champion">
              <View style={styles.champion}>
                <IconSymbol name="trophy.fill" size={ICON.regular} color={colors.ink} />
                <View style={styles.flex}>
                  <Text variant="caption" tone="inkMuted">
                    Champion
                  </Text>
                  <KitTeamLink teamId={champion.teamId} name={champion.name} kitColour={champion.kitColour} size={32} bold />
                </View>
              </View>
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => ({
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  round: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cardWrap: { flexBasis: '48%', flexGrow: 1 },
  card: { gap: space.xs, padding: space.md },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space.xs },
  side: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs },
  pressed: { opacity: 0.7 },
  champion: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
}));
