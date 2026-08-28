import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { FuttyColors } from '@/constants/futty-theme';
import { dayLabel, toDateKey, useDays } from '@/lib/days';
import {
  FIXTURE_SCHEDULING_WINDOW_DAYS,
  listFixtureProposals,
  proposeFixtureSchedule,
  type Fixture,
  type FixtureProposal,
} from '@/lib/fixtures';
import { describeLeagueError } from '@/lib/league-errors';
import { useMyCaptainTeamIds, useMyFixtures } from '@/lib/use-fixtures';
import { useVenues } from '@/lib/use-venues';

// A fixed set of common evening/weekend kickoff hours — simpler than tying
// into each venue's own open/close hours, which aren't known until a pitch
// is picked in this same form.
const KICKOFF_TIMES = Array.from({ length: 14 }, (_, i) => `${String(9 + i).padStart(2, '0')}:00`);

function needsScheduling(fixture: Fixture) {
  return fixture.status === 'unscheduled' || fixture.status === 'proposed';
}

function FixtureScheduleCard({
  fixture,
  myCaptainTeamIds,
  onChanged,
}: {
  fixture: Fixture;
  myCaptainTeamIds: Set<string>;
  onChanged: () => void;
}) {
  const venuesState = useVenues();
  const schedulingDays = useDays(FIXTURE_SCHEDULING_WINDOW_DAYS + 1);
  const [proposals, setProposals] = useState<FixtureProposal[] | null>(null);
  const [dateKey, setDateKey] = useState(toDateKey(schedulingDays[0]));
  const [time, setTime] = useState(KICKOFF_TIMES[9]);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProposals = useCallback(async () => {
    const { data, error: loadError } = await listFixtureProposals(fixture.id);
    if (loadError) setError(loadError.message);
    else setProposals((data ?? []) as unknown as FixtureProposal[]);
  }, [fixture.id]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const opponent = myCaptainTeamIds.has(fixture.home_team_id) ? fixture.away_team : fixture.home_team;
  const theirTeamId = myCaptainTeamIds.has(fixture.home_team_id) ? fixture.away_team_id : fixture.home_team_id;
  const theirLatest = proposals?.find((p) => p.proposed_by_team_id === theirTeamId) ?? null;

  async function propose(day: string, kickoff: string, venue: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: proposeError } = await proposeFixtureSchedule(fixture.id, day, `${kickoff}:00`, venue);
    setBusy(false);
    if (proposeError) {
      setError(describeLeagueError(proposeError));
    } else {
      onChanged();
      loadProposals();
    }
  }

  return (
    <View style={styles.card}>
      <ThemedText type="defaultSemiBold">vs {opponent?.name ?? 'Unknown team'}</ThemedText>

      {theirLatest ? (
        <>
          <ThemedText style={styles.note}>
            They proposed {theirLatest.proposed_day} at {theirLatest.proposed_time.slice(0, 5)},{' '}
            {theirLatest.venue?.name ?? 'a pitch'}.
          </ThemedText>
          <AuthButton
            label="Agree to this"
            onPress={() =>
              propose(theirLatest.proposed_day, theirLatest.proposed_time.slice(0, 5), theirLatest.venue_id)
            }
            busy={busy}
          />
          <ThemedText style={styles.note}>Or propose something different:</ThemedText>
        </>
      ) : (
        <ThemedText style={styles.note}>Pick a date within the next week:</ThemedText>
      )}

      <View style={styles.wrapRow}>
        {schedulingDays.map((day) => {
          const key = toDateKey(day);
          return (
            <Chip key={key} label={dayLabel(day)} selected={dateKey === key} onPress={() => setDateKey(key)} />
          );
        })}
      </View>

      <ThemedText style={styles.note}>Kickoff time:</ThemedText>
      <View style={styles.wrapRow}>
        {KICKOFF_TIMES.map((t) => (
          <Chip key={t} label={t} selected={time === t} onPress={() => setTime(t)} />
        ))}
      </View>

      <ThemedText style={styles.note}>Pitch:</ThemedText>
      {venuesState.status === 'loading' ? <ActivityIndicator /> : null}
      {venuesState.status === 'error' ? (
        <ThemedText style={styles.note}>Could not load pitches: {venuesState.message}</ThemedText>
      ) : null}
      {venuesState.status === 'ready' ? (
        <View style={styles.wrapRow}>
          {venuesState.venues.map((venue) => (
            <Chip
              key={venue.id}
              label={venue.name}
              sublabel={venue.city}
              selected={venueId === venue.id}
              onPress={() => setVenueId(venue.id)}
            />
          ))}
        </View>
      ) : null}

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthButton
        label={theirLatest ? 'Propose different time' : 'Propose to opponent'}
        onPress={() => venueId && propose(dateKey, time, venueId)}
        disabled={!venueId}
        busy={busy}
      />
    </View>
  );
}

export default function MatchmakingScreen() {
  const fixtures = useMyFixtures();
  const myCaptainTeamIds = useMyCaptainTeamIds();

  const actionable =
    fixtures.status === 'ready'
      ? fixtures.fixtures.filter(
          (f) =>
            needsScheduling(f) &&
            (myCaptainTeamIds.has(f.home_team_id) || myCaptainTeamIds.has(f.away_team_id))
        )
      : [];

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconLabel icon="calendar" style={styles.intro} iconColor={FuttyColors.emerald950} iconSize={14}>
          Pick a date and pitch — match the other captain&apos;s pick to lock it in.
        </IconLabel>

        {fixtures.status === 'loading' ? <ActivityIndicator /> : null}
        {fixtures.status === 'error' ? (
          <ThemedText style={styles.note}>Could not load fixtures: {fixtures.message}</ThemedText>
        ) : null}

        {fixtures.status === 'ready' && myCaptainTeamIds.size === 0 ? (
          <IconLabel icon="info.circle.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            Captain a team to schedule fixtures.
          </IconLabel>
        ) : null}

        {fixtures.status === 'ready' && myCaptainTeamIds.size > 0 && actionable.length === 0 ? (
          <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            Nothing to schedule right now.
          </IconLabel>
        ) : null}

        {actionable.map((fixture) => (
          <FixtureScheduleCard
            key={fixture.id}
            fixture={fixture}
            myCaptainTeamIds={myCaptainTeamIds}
            onChanged={fixtures.reload}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 48,
  },
  intro: {
    fontSize: 13,
    opacity: 0.7,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    backgroundColor: FuttyColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    padding: 14,
    gap: 8,
  },
});
