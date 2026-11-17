import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/chip';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { WizardModal } from '@/components/wizard-modal';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
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

type WizardStep = 'date' | 'time' | 'venue';
const WIZARD_STEPS: WizardStep[] = ['date', 'time', 'venue'];
const STEP_META: Record<WizardStep, { title: string; name: string; subtitle: string }> = {
  date: { title: 'Pick a date', name: 'Date', subtitle: `Within the next ${FIXTURE_SCHEDULING_WINDOW_DAYS} days.` },
  time: { title: 'Kickoff time', name: 'Time', subtitle: 'When should the match start?' },
  venue: { title: 'Which pitch?', name: 'Venue', subtitle: 'Propose a venue for this fixture.' },
};

function needsScheduling(fixture: Fixture) {
  return fixture.status === 'unscheduled' || fixture.status === 'proposed';
}

/** Item 8 — the same WizardModal shell Book uses (title, thin progress bar,
 *  "Step X of Y", full-width Continue, back chevron only), so scheduling a
 *  league fixture feels like the same product as booking a pitch instead of
 *  a separate, differently-styled flow. */
function ScheduleWizard({
  fixture,
  opponentName,
  theirLatest,
  onClose,
  onScheduled,
}: {
  fixture: Fixture;
  opponentName: string;
  theirLatest: FixtureProposal | null;
  onClose: () => void;
  onScheduled: () => void;
}) {
  // A venue that isn't live never appears in the booking flow (spec 13).
  const venuesState = useVenues({ liveOnly: true });
  const schedulingDays = useDays(FIXTURE_SCHEDULING_WINDOW_DAYS + 1);

  const [step, setStep] = useState<WizardStep>('date');
  const [dateKey, setDateKey] = useState(toDateKey(schedulingDays[0]));
  const [time, setTime] = useState(KICKOFF_TIMES[9]);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = WIZARD_STEPS.indexOf(step);

  async function propose(day: string, kickoff: string, venue: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: proposeError } = await proposeFixtureSchedule(fixture.id, day, `${kickoff}:00`, venue);
    setBusy(false);
    if (proposeError) {
      setError(describeLeagueError(proposeError));
    } else {
      onScheduled();
      onClose();
    }
  }

  function canAdvance() {
    if (step === 'date') return !!dateKey;
    if (step === 'time') return !!time;
    return !!venueId;
  }

  function goNext() {
    if (step === 'venue') {
      if (venueId) propose(dateKey, time, venueId);
      return;
    }
    setStep(WIZARD_STEPS[stepIndex + 1]);
  }

  function goBack() {
    if (stepIndex === 0) {
      onClose();
      return;
    }
    setStep(WIZARD_STEPS[stepIndex - 1]);
  }

  const meta = STEP_META[step];

  return (
    <WizardModal
      visible
      title={`vs ${opponentName}`}
      stepIndex={stepIndex}
      stepCount={WIZARD_STEPS.length}
      stepName={meta.name}
      onBack={goBack}
      continueLabel={step === 'venue' ? 'Propose to opponent' : 'Continue'}
      onContinue={goNext}
      continueDisabled={!canAdvance()}
      continueBusy={busy}>
      <View style={styles.stepHeader}>
        <Text variant="title" accessibilityRole="header">
          {meta.title}
        </Text>
        <Text variant="callout" tone="inkMuted">
          {meta.subtitle}
        </Text>
      </View>

      {theirLatest && step === 'date' ? (
        <View style={styles.theirProposal}>
          <Text variant="callout" tabular>
            They proposed {theirLatest.proposed_day} at {theirLatest.proposed_time.slice(0, 5)},{' '}
            {theirLatest.venue?.name ?? 'a pitch'}.
          </Text>
          <Button
            label="Agree to this instead"
            fullWidth
            onPress={() =>
              propose(theirLatest.proposed_day, theirLatest.proposed_time.slice(0, 5), theirLatest.venue_id)
            }
          />
        </View>
      ) : null}

      {step === 'date' ? (
        <View style={styles.wrapRow}>
          {schedulingDays.map((day) => {
            const key = toDateKey(day);
            return (
              <Chip key={key} label={dayLabel(day)} selected={dateKey === key} onPress={() => setDateKey(key)} />
            );
          })}
        </View>
      ) : null}

      {step === 'time' ? (
        <View style={styles.wrapRow}>
          {KICKOFF_TIMES.map((t) => (
            <Chip key={t} label={t} selected={time === t} onPress={() => setTime(t)} />
          ))}
        </View>
      ) : null}

      {step === 'venue' ? (
        <View style={styles.wrapRow}>
          {venuesState.status === 'loading' ? <SkeletonText lines={2} /> : null}
          {venuesState.status === 'error' ? (
            <Banner
              tone="danger"
              message={`Could not load pitches: ${venuesState.message}`}
              action={{ label: 'Try again', onPress: venuesState.reload }}
            />
          ) : null}
          {venuesState.status === 'ready'
            ? venuesState.venues.map((venue) => (
                <Chip
                  key={venue.id}
                  label={venue.name}
                  sublabel={venue.city}
                  selected={venueId === venue.id}
                  onPress={() => setVenueId(venue.id)}
                />
              ))
            : null}
        </View>
      ) : null}

      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </WizardModal>
  );
}

function FixtureRow({
  fixture,
  myCaptainTeamIds,
  onChanged,
}: {
  fixture: Fixture;
  myCaptainTeamIds: Set<string>;
  onChanged: () => void;
}) {
  const [proposals, setProposals] = useState<FixtureProposal[] | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const loadProposals = useCallback(async () => {
    const { data } = await listFixtureProposals(fixture.id);
    setProposals((data ?? []) as unknown as FixtureProposal[]);
  }, [fixture.id]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const opponent = myCaptainTeamIds.has(fixture.home_team_id) ? fixture.away_team : fixture.home_team;
  const theirTeamId = myCaptainTeamIds.has(fixture.home_team_id) ? fixture.away_team_id : fixture.home_team_id;
  const theirLatest = proposals?.find((p) => p.proposed_by_team_id === theirTeamId) ?? null;
  const title = `vs ${opponent?.name ?? 'Unknown team'}`;

  return (
    <>
      <Card padded={false}>
        <ListRow
          title={title}
          subtitle={
            theirLatest
              ? `They proposed ${theirLatest.proposed_day} at ${theirLatest.proposed_time.slice(0, 5)}`
              : 'Not scheduled yet'
          }
          accessibilityLabel={`${title}. Schedule`}
          trailing={
            <Text variant="callout" tone="brand">
              Schedule
            </Text>
          }
          chevron
          onPress={() => setWizardOpen(true)}
        />
      </Card>

      {wizardOpen ? (
        <ScheduleWizard
          fixture={fixture}
          opponentName={opponent?.name ?? 'Unknown team'}
          theirLatest={theirLatest}
          onClose={() => setWizardOpen(false)}
          onScheduled={onChanged}
        />
      ) : null}
    </>
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
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="callout" tone="inkMuted">
          Pick a date and pitch — match the other captain&apos;s pick to lock it in.
        </Text>

        {fixtures.status === 'loading' ? (
          <Card testID="matchmaking-skeleton">
            <SkeletonText lines={3} />
          </Card>
        ) : null}
        {fixtures.status === 'error' ? (
          <Banner
            tone="danger"
            message={`Could not load fixtures: ${fixtures.message}`}
            action={{ label: 'Try again', onPress: fixtures.reload }}
          />
        ) : null}

        {fixtures.status === 'ready' && myCaptainTeamIds.size === 0 ? (
          <EmptyState icon="info.circle.fill" message="Captain a team to schedule fixtures." />
        ) : null}

        {fixtures.status === 'ready' && myCaptainTeamIds.size > 0 && actionable.length === 0 ? (
          <EmptyState icon="calendar" message="Nothing to schedule right now." />
        ) : null}

        {actionable.map((fixture) => (
          <FixtureRow
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
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stepHeader: { gap: space.xs, marginBottom: space.lg },
  theirProposal: {
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
    marginBottom: space.lg,
  },
  error: { marginTop: space.md },
});
