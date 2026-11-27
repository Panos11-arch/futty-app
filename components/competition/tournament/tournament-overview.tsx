// S10A Overview (image 13), top to bottom: the stage card (the stage, its
// state and progress), while sign-up is open the registration card (dates or
// "Coming soon", the entry fee line, teams in, Register team or Edit squad,
// and my team's squad), Player of the tournament, Power rankings top 4, the
// banner ad, and Team of the tournament. Empty sections are hidden.
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { AdBanner } from '@/components/ads/ad-banner';
import { openPlayer } from '@/components/competition/team-link';
import { PlayerOfTheSeason, PowerTop, TeamOfTheSeason } from '@/components/competition/overview-tab';
import { TeamBadge } from '@/components/match/team-badge';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { competitionPlayerLook } from '@/lib/match/competition-api';
import {
  entryFeeLine,
  tournamentDates,
  tournamentStatusLabel,
  type Tournament,
} from '@/lib/match/tournament-api';
import { useCompetitionAwards } from '@/lib/match/use-competition';
import { makeStyles } from '@/lib/theme';

/** The stage card's right-hand state. */
export function stageState(t: Pick<Tournament, 'status' | 'startDate' | 'endDate'>): string {
  if (t.status === 'finished') return 'Finished';
  if (t.status === 'groups' || t.status === 'knockout') return 'In progress';
  return tournamentDates(t) === 'Coming soon' ? 'Coming soon' : 'Upcoming';
}

function StageCard({ tournament }: { tournament: Tournament }) {
  const styles = useStyles();
  const progress = tournament.progress;
  const share = progress && progress.total > 0 ? progress.played / progress.total : null;
  return (
    <Card testID="tournament-stage-card">
      <View style={styles.cardHead}>
        <Text variant="title" style={styles.flex}>
          {tournamentStatusLabel(tournament.status)}
        </Text>
        <Text variant="callout" tone="inkMuted">
          {stageState(tournament)}
        </Text>
      </View>
      {share != null ? (
        <View
          testID="tournament-progress"
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`${progress!.played} of ${progress!.total} matches played`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(share, 0.04) * 100}%` }]} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function RegistrationCard({
  tournament,
  action,
  onAction,
}: {
  tournament: Tournament;
  action: 'register' | 'edit' | null;
  onAction: () => void;
}) {
  const styles = useStyles();
  const mine = (tournament.myTeams ?? [])[0] ?? null;
  return (
    <Card testID="tournament-registration">
      <View style={styles.cardHead}>
        <Text variant="title" style={styles.flex}>
          Sign-up
        </Text>
        <Text variant="callout" tone="inkMuted" testID="tournament-teams-count">
          {`${tournament.teamsCount} of ${tournament.maxTeams} teams`}
        </Text>
      </View>
      <Text variant="body" testID="tournament-dates">
        {[tournamentDates(tournament), tournament.venueName].filter(Boolean).join(' · ')}
      </Text>
      <Text variant="callout" tone="inkMuted" testID="tournament-entry-fee">
        {entryFeeLine(tournament.entryFeeCents)}
      </Text>
      {mine ? (
        <View style={styles.squad} testID="tournament-my-squad">
          <View style={styles.teamRow}>
            <TeamBadge name={mine.teamName} kitColour={mine.kitColour} size={32} />
            <Text variant="headline" style={styles.flex} numberOfLines={1}>
              {mine.teamName}
            </Text>
          </View>
          {mine.squad.map((p) => (
            <Pressable
              key={p.profileId}
              testID={`tournament-squad-${p.profileId}`}
              accessibilityRole="link"
              accessibilityLabel={`Open ${p.name}`}
              onPress={() => openPlayer(p.profileId)}
              style={({ pressed }) => [styles.player, pressed && styles.pressed]}>
              <Avatar name={p.name} kit={competitionPlayerLook(p)} size={32} />
              <Text variant="body" numberOfLines={1} style={styles.flex}>
                {p.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {action ? (
        <Button
          label={action === 'edit' ? 'Edit squad' : 'Register team'}
          onPress={onAction}
          fullWidth
          testID={action === 'edit' ? 'tournament-edit-squad' : 'tournament-register'}
        />
      ) : null}
    </Card>
  );
}

export function TournamentOverview({
  tournament,
  action,
  onAction,
  onRefresh,
  onGoTab,
}: {
  tournament: Tournament;
  /** The registration card's main action (registrationAction). */
  action: 'register' | 'edit' | null;
  onAction: () => void;
  onRefresh: () => Promise<void>;
  onGoTab: (tab: 'stats' | 'power') => void;
}) {
  const styles = useStyles();
  const [matchday, setMatchday] = useState<number | null>(null);
  // A tournament is its own season for the awards (S10A reads).
  const awards = useCompetitionAwards(tournament.id, matchday);
  const [refreshing, setRefreshing] = useState(false);
  const started = tournament.status !== 'registration';

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([onRefresh(), awards.reload()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      testID="tournament-overview"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <StageCard tournament={tournament} />
      {tournament.status === 'registration' ? (
        <RegistrationCard tournament={tournament} action={action} onAction={onAction} />
      ) : null}
      {started ? <PlayerOfTheSeason awards={awards} onSeeMore={() => onGoTab('stats')} noun="tournament" /> : null}
      {started ? <PowerTop seasonId={tournament.id} onGo={() => onGoTab('power')} /> : null}
      <AdBanner testID="tournament-overview-ad" />
      {started ? <TeamOfTheSeason awards={awards} matchday={matchday} onMatchday={setMatchday} noun="tournament" /> : null}
      {started && awards.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the awards." action={{ label: 'Try again', onPress: awards.reload }} />
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  content: { gap: space.lg, padding: space.lg, paddingBottom: space.xxl },
  flex: { flex: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { height: space.sm, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.green },
  squad: { gap: space.xs },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  player: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  pressed: { opacity: 0.7 },
}));
