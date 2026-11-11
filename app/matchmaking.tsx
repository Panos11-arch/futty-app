import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WizardModal } from '@/components/wizard-modal';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
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
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

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
      <ThemedText type="title" style={styles.stepTitle}>
        {meta.title}
      </ThemedText>
      <ThemedText style={styles.stepSubtitle}>{meta.subtitle}</ThemedText>

      {theirLatest && step === 'date' ? (
        <ThemedView style={[styles.theirProposalCard, { borderColor: border }]}>
          <ThemedText style={styles.theirProposalText}>
            They proposed {theirLatest.proposed_day} at {theirLatest.proposed_time.slice(0, 5)},{' '}
            {theirLatest.venue?.name ?? 'a pitch'}.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              propose(theirLatest.proposed_day, theirLatest.proposed_time.slice(0, 5), theirLatest.venue_id)
            }
            style={styles.agreeButton}>
            <ThemedText style={styles.agreeButtonText}>Agree to this instead</ThemedText>
          </Pressable>
        </ThemedView>
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
          {venuesState.status === 'loading' ? <ActivityIndicator /> : null}
          {venuesState.status === 'error' ? (
            <ThemedText style={styles.note}>Could not load pitches: {venuesState.message}</ThemedText>
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

      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
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
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
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

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setWizardOpen(true)}
        style={[styles.row, { borderColor: border }]}>
        <View style={styles.rowText}>
          <ThemedText type="defaultSemiBold">vs {opponent?.name ?? 'Unknown team'}</ThemedText>
          <ThemedText style={styles.note}>
            {theirLatest
              ? `They proposed ${theirLatest.proposed_day} at ${theirLatest.proposed_time.slice(0, 5)}`
              : 'Not scheduled yet'}
          </ThemedText>
        </View>
        <ThemedText type="link" style={styles.scheduleLink}>
          Schedule
        </ThemedText>
      </Pressable>

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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: FuttyColors.white,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  scheduleLink: {
    fontSize: 13,
  },
  stepTitle: {
    fontSize: 26,
  },
  stepSubtitle: {
    fontSize: 13,
    opacity: 0.7,
    marginBottom: 16,
  },
  theirProposalCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  theirProposalText: {
    fontSize: 13,
  },
  agreeButton: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FuttyColors.emerald950,
  },
  agreeButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: FuttyColors.white,
  },
  errorText: {
    fontSize: 13,
    color: FuttyColors.rose600,
    marginTop: 12,
  },
});
