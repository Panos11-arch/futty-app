import type { PostgrestError } from '@supabase/supabase-js';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AddPlayerRow } from '@/components/add-player-row';
import { Chip } from '@/components/chip';
import { FixtureScoreEntry } from '@/components/match/fixture-score-entry';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { colors, hairline, space, type } from '@/constants/futty-theme';
import { CAPACITY_OPTIONS } from '@/lib/booking';
import { canLogFixtureScore, formatFixtureWhen } from '@/lib/fixtures';
import { describeLeagueError } from '@/lib/league-errors';
import { playHref } from '@/lib/play-segments';
import { leagueFormatOpen } from '@/lib/premium';
import { registerTeamForLeague, startLeagueSeason, type League } from '@/lib/leagues';
import { supabase } from '@/lib/supabase';
import {
  createTeam,
  getTeamRoster,
  hasTeamPremium,
  isPremiumFormat,
  PREMIUM_FORMAT_PRICES,
  ROSTER_SIZE_PRESETS,
  type RosterMember,
  type Team,
} from '@/lib/teams';
import { useMyCaptainTeamIds, useMyFixtures } from '@/lib/use-fixtures';
import { useLeagues } from '@/lib/use-leagues';
import { useLeagueStandings, type StandingsRow } from '@/lib/use-league-standings';
import { useMyTeams } from '@/lib/use-my-teams';
import { useProfile } from '@/lib/use-profile';

const FORMATS = CAPACITY_OPTIONS.map((option) => option.format);
const CITIES = ['Nicosia', 'Limassol', 'Larnaca', 'Paphos'];

const STAT_COLUMNS = ['P', 'W', 'D', 'L', 'F', 'A', 'GD', 'Pts'] as const;

function ErrorText({ children }: { children: string }) {
  return (
    <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

function Note({ children }: { children: string }) {
  return (
    <Text variant="callout" tone="inkMuted">
      {children}
    </Text>
  );
}

/** A league table. Rows whose team is in `highlightTeamIds` (the user's own
 *  teams) sit on brandSoft. */
export function StandingsTable({ rows, highlightTeamIds }: { rows: StandingsRow[]; highlightTeamIds: Set<string> }) {
  if (rows.length === 0) {
    return <Note>No teams registered yet.</Note>;
  }

  return (
    <Card padded={false} testID="standings-table">
      <View style={styles.tableRow}>
        <Text variant="caption" tone="inkMuted" style={styles.tableTeam}>
          Team
        </Text>
        {STAT_COLUMNS.map((label) => (
          <Text key={label} variant="caption" tone="inkMuted" numberOfLines={1} style={styles.tableStat}>
            {label}
          </Text>
        ))}
      </View>
      {rows.map((row) => {
        const pts = row.won * 3 + row.drawn + row.pts_adjustment;
        const gd = row.goals_for - row.goals_against;
        const isMine = highlightTeamIds.has(row.team_id);
        const values = [
          row.played,
          row.won,
          row.drawn,
          row.lost,
          row.goals_for,
          row.goals_against,
          gd >= 0 ? `+${gd}` : gd,
        ];
        return (
          <View
            key={row.id}
            testID={isMine ? 'standings-row-mine' : 'standings-row'}
            style={[styles.tableRow, styles.tableRowDivider, isMine && styles.tableRowMine]}>
            <Text variant="callout" numberOfLines={1} style={styles.tableTeam}>
              {row.team_name}
            </Text>
            {values.map((value, i) => (
              <Text key={STAT_COLUMNS[i]} variant="callout" tabular numberOfLines={1} style={styles.tableStat}>
                {String(value)}
              </Text>
            ))}
            <Text variant="callout" tabular numberOfLines={1} style={[styles.tableStat, styles.tablePts]}>
              {String(pts)}
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

function DivisionCard({ division, highlightTeamIds }: { division: League; highlightTeamIds: Set<string> }) {
  const standings = useLeagueStandings(division.id);

  return (
    <View style={styles.section}>
      <Text variant="headline">{division.name}</Text>
      {standings.status === 'loading' ? <SkeletonText lines={3} /> : null}
      {standings.status === 'error' ? (
        <Banner
          tone="danger"
          message={`Could not load: ${standings.message}`}
          action={{ label: 'Try again', onPress: standings.reload }}
        />
      ) : null}
      {standings.status === 'ready' ? (
        <StandingsTable rows={standings.rows} highlightTeamIds={highlightTeamIds} />
      ) : null}
    </View>
  );
}

/**
 * Registers a team for a league — the one place team creation happens now,
 * rather than as a standalone "Team" feature. Lets the captain pick any of
 * their existing teams not already in this league, or create a new one and
 * populate its roster right here before finishing.
 */
function JoinLeagueControl({
  leagueId,
  format,
  joinLabel,
  registeredTeamIds,
  defaultCity,
  onJoined,
}: {
  leagueId: string;
  format: string;
  joinLabel: string;
  registeredTeamIds: Set<string>;
  defaultCity?: string;
  onJoined: () => void;
}) {
  const myTeams = useMyTeams();
  const myProfile = useProfile();

  // '7-a-side' -> 7. Not a real database constraint (roster_size is just a
  // number a team is created with), but it's the same mapping the roster
  // size presets below use — matching a team to a format by its size keeps
  // an existing 11-a-side team from cluttering the 5-a-side join list as if
  // it were a real option, which was crowding out "Register a new team".
  const expectedRosterSize = Number(format.split('-')[0]) || null;

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState(defaultCity ?? CITIES[0]);
  const [rosterSize, setRosterSize] = useState(expectedRosterSize ?? ROSTER_SIZE_PRESETS[3]);
  const [subSlots, setSubSlots] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A team you're actively filling the roster for — either just created, or
  // an existing-but-incomplete team resumed via "Finish register" below.
  const [justCreated, setJustCreated] = useState<Team | null>(null);
  const [justCreatedRoster, setJustCreatedRoster] = useState<RosterMember[] | null>(null);

  const loadJustCreatedRoster = useCallback((teamId: string) => {
    getTeamRoster(teamId).then(({ data }) => setJustCreatedRoster(data ?? []));
  }, []);

  useEffect(() => {
    if (!justCreated) {
      setJustCreatedRoster(null);
      return;
    }
    loadJustCreatedRoster(justCreated.id);
  }, [justCreated?.id, loadJustCreatedRoster]);

  if (myTeams.status === 'loading') return <SkeletonText lines={2} />;
  if (myTeams.status === 'error') {
    return (
      <Banner
        tone="danger"
        message={`Could not load your teams: ${myTeams.message}`}
        action={{ label: 'Try again', onPress: myTeams.reload }}
      />
    );
  }

  const inviterUsername = myProfile.status === 'ready' ? myProfile.profile.username : null;
  const eligibleTeams = myTeams.teams.filter(
    ({ team }) =>
      !registeredTeamIds.has(team.id) &&
      (expectedRosterSize === null || team.roster_size === expectedRosterSize)
  );
  const premiumGated = isPremiumFormat(format);
  const price = premiumGated ? PREMIUM_FORMAT_PRICES[format] : 0;

  // One team per captain per league — enforced again server-side
  // (already_have_team_in_league), this just avoids offering an action
  // that would only bounce back as an error.
  const alreadyHaveTeamHere = myTeams.teams.some(
    ({ team, role }) => role === 'captain' && registeredTeamIds.has(team.id)
  );

  if (alreadyHaveTeamHere && !justCreated) {
    return <Note>You’re already in this league.</Note>;
  }

  // 9-a-side and 11-a-side need Team Premium, which is off for the release
  // (lib/premium.ts): registration opens with it.
  if (!leagueFormatOpen(format)) {
    return <Note>{`${format} leagues are coming soon.`}</Note>;
  }

  if (justCreated) {
    // roster_size counts the captain as the first main-squad slot
    // (teams.sql), and the fetched roster already includes that row, so no
    // manual "-1" is needed here the way a session-only added-count would.
    const mainCount = justCreatedRoster ? justCreatedRoster.filter((m) => m.role !== 'substitute').length : 0;
    const subCount = justCreatedRoster ? justCreatedRoster.filter((m) => m.role === 'substitute').length : 0;
    const mainRemaining = justCreated.roster_size - mainCount;
    const subRemaining = justCreated.substitute_slots - subCount;
    const rosterReady = justCreatedRoster !== null && mainRemaining <= 0;
    const needsPremium = premiumGated && !hasTeamPremium(justCreated, format);
    const canRegister = rosterReady && !needsPremium;

    const justCreatedId = justCreated.id;
    function onMemberAdded() {
      loadJustCreatedRoster(justCreatedId);
    }

    async function finishRegistration() {
      if (!justCreated || !canRegister || busy) return;
      setBusy(true);
      setError(null);

      const { error: joinError } = await registerTeamForLeague(leagueId, justCreated.id);
      setBusy(false);

      if (joinError) {
        setError(describeLeagueError(joinError));
        return;
      }

      setJustCreated(null);
      setCreating(false);
      onJoined();
    }

    return (
      <Card style={styles.section}>
        <Note>
          {!justCreatedRoster
            ? 'Loading roster…'
            : !rosterReady
              ? `${mainRemaining} more player${mainRemaining === 1 ? '' : 's'} needed.`
              : needsPremium
                ? `Squad ready — but ${format} needs Team Premium (€${PREMIUM_FORMAT_PRICES[format]}/season) first.`
                : 'Squad ready — register below.'}
        </Note>

        {needsPremium ? (
          <Button label="Buy Team Premium" variant="secondary" onPress={() => router.push('/team')} disabled={busy} />
        ) : null}

        {justCreatedRoster ? (
          <>
            <AddPlayerRow
              teamId={justCreated.id}
              teamName={justCreated.name}
              inviterUsername={inviterUsername}
              role="player"
              remaining={mainRemaining}
              onAdded={onMemberAdded}
            />
            <AddPlayerRow
              teamId={justCreated.id}
              teamName={justCreated.name}
              inviterUsername={inviterUsername}
              role="substitute"
              remaining={subRemaining}
              onAdded={onMemberAdded}
            />
          </>
        ) : (
          <SkeletonText lines={2} />
        )}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <Button label={joinLabel} fullWidth onPress={finishRegistration} disabled={!canRegister} loading={busy} />
        <Button
          label="Finish squad later (won't register yet)"
          variant="secondary"
          fullWidth
          onPress={() => {
            setJustCreated(null);
            setCreating(false);
            myTeams.reload();
          }}
          disabled={busy}
        />
      </Card>
    );
  }

  async function createTeamOnly() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);

    const { data: team, error: createError } = await createTeam(name.trim(), city, rosterSize, subSlots);
    setBusy(false);

    if (createError || !team) {
      setError(describeLeagueError(createError!));
      return;
    }

    myTeams.reload();
    setJustCreated(team as unknown as Team);
  }

  if (!creating) {
    return (
      <View style={styles.section}>
        <Button label="Register a new team" onPress={() => setCreating(true)} disabled={busy} />

        {error ? <ErrorText>{error}</ErrorText> : null}

        {/* Every row here is one of the CURRENT user's own teams not yet in
         *  this league — i.e. an incomplete registration by definition, so
         *  "Finish register" is the one action every row needs (it opens the
         *  same roster/register screen either way: still filling the roster,
         *  or already full and ready to hit Register). No separate "Join" —
         *  it duplicated this with a button that just bounced back with
         *  roster_incomplete for anything not already full. */}
        {eligibleTeams.length > 0 ? (
          <Card padded={false}>
            {eligibleTeams.map(({ team }) => {
              const needsPremium = premiumGated && !hasTeamPremium(team, format);
              return (
                <ListRow
                  key={team.id}
                  title={team.name}
                  leading={needsPremium ? { icon: 'lock.fill' } : undefined}
                  trailing={
                    <Button
                      label={needsPremium ? 'Buy Team Premium' : 'Finish register'}
                      variant="secondary"
                      onPress={() => (needsPremium ? router.push('/team') : setJustCreated(team))}
                      disabled={busy}
                    />
                  }
                />
              );
            })}
          </Card>
        ) : null}
      </View>
    );
  }

  return (
    <Card style={styles.section}>
      <Note>Squad size (including you)</Note>
      <View style={styles.wrapRow}>
        {ROSTER_SIZE_PRESETS.map((size) => (
          <Chip
            key={size}
            label={String(size)}
            selected={size === rosterSize}
            onPress={() => setRosterSize(size)}
          />
        ))}
      </View>

      <Note>Substitutes (optional)</Note>
      <View style={styles.wrapRow}>
        {[0, 1, 2, 3, 4].map((count) => (
          <Chip
            key={count}
            label={count === 0 ? 'None' : String(count)}
            selected={count === subSlots}
            onPress={() => setSubSlots(count)}
          />
        ))}
      </View>

      <TextField label="Team name" value={name} onChangeText={setName} placeholder="Team name" editable={!busy} />

      <Note>City</Note>
      <View style={styles.wrapRow}>
        {CITIES.map((c) => (
          <Chip key={c} label={c} selected={c === city} onPress={() => setCity(c)} />
        ))}
      </View>

      {premiumGated ? (
        <View style={styles.iconRow}>
          <IconSymbol name="lock.fill" size={ICON.small} color={colors.inkMuted} />
          <Text variant="callout" tone="inkMuted" style={styles.flex}>
            {format} needs Team Premium (€{price}/season) to register — buy it from the Team tab once this
            squad is created
          </Text>
        </View>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={styles.buttonRow}>
        <Button label="Create team" onPress={createTeamOnly} disabled={!name.trim()} loading={busy} />
        <Button label="Cancel" variant="secondary" onPress={() => setCreating(false)} disabled={busy} />
      </View>
    </Card>
  );
}

/** Just the next fixture, plus a link to the full list (app/upcoming-fixtures.tsx)
 *  — the format/city pickers above only scope the standings view, so this
 *  stays a simple teaser rather than repeating the whole fixtures UI here. */
function FixturesSection() {
  const fixtures = useMyFixtures();
  const myCaptainTeamIds = useMyCaptainTeamIds();

  // useMyFixtures only fetches on mount — this tab stays mounted underneath
  // when Matchmaking is pushed on top of it, so without this a date agreed
  // there wouldn't show here until something else happened to trigger a
  // reload. Same fix as app/upcoming-fixtures.tsx.
  useFocusEffect(
    useCallback(() => {
      fixtures.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (fixtures.status === 'loading') return <SkeletonText lines={2} />;
  if (fixtures.status === 'error') {
    return (
      <Banner
        tone="danger"
        message={`Could not load fixtures: ${fixtures.message}`}
        action={{ label: 'Try again', onPress: fixtures.reload }}
      />
    );
  }

  // Completed fixtures aren't "upcoming" — excluded so a past result can't
  // outrank a not-yet-scheduled fixture just because it has an earlier date.
  const upcoming = fixtures.fixtures.filter((f) => f.status !== 'completed');

  if (upcoming.length === 0) {
    return <EmptyState icon="calendar" message="No upcoming fixtures yet." />;
  }

  const next = upcoming[0];
  const when = formatFixtureWhen(next);
  const statusLabel =
    next.status === 'agreed'
      ? `${when ?? 'Date tbc'} · ${next.venue?.name ?? 'pitch tbc'}`
      : next.status === 'proposed'
        ? 'Awaiting agreement'
        : 'Not yet scheduled';

  return (
    <View style={styles.section}>
      <Card style={styles.section}>
        <Text variant="headline">
          {next.home_team?.name ?? 'Unknown team'} vs {next.away_team?.name ?? 'Unknown team'}
        </Text>
        <Text variant="callout" tone="inkMuted" tabular>
          {statusLabel}
        </Text>
        {canLogFixtureScore(next, myCaptainTeamIds) ? (
          <FixtureScoreEntry fixture={next} onSubmitted={fixtures.reload} />
        ) : null}
      </Card>

      <Button label="Upcoming fixtures" variant="plain" onPress={() => router.push('/upcoming-fixtures')} />
    </View>
  );
}

function StandardLeagueSection({
  format,
  leagues,
  myTeamIds,
}: {
  format: string;
  leagues: League[];
  myTeamIds: Set<string>;
}) {
  const league = leagues.find((l) => l.format === format && l.scope === 'Island-wide');
  const standings = useLeagueStandings(league?.id ?? '');

  if (!league) {
    return <EmptyState icon="trophy.fill" message={`No ${format} league found yet.`} />;
  }

  const registeredTeamIds = new Set(standings.status === 'ready' ? standings.rows.map((r) => r.team_id) : []);

  return (
    <View style={styles.section}>
      <Text variant="headline">{league.name}</Text>
      {standings.status === 'loading' ? <SkeletonText lines={3} /> : null}
      {standings.status === 'error' ? (
        <Banner
          tone="danger"
          message={`Could not load: ${standings.message}`}
          action={{ label: 'Try again', onPress: standings.reload }}
        />
      ) : null}
      {standings.status === 'ready' ? (
        <StandingsTable rows={standings.rows} highlightTeamIds={myTeamIds} />
      ) : null}

      <JoinLeagueControl
        leagueId={league.id}
        format={format}
        joinLabel="Join"
        registeredTeamIds={registeredTeamIds}
        onJoined={standings.reload}
      />

      <View style={styles.wrapRow}>
        <Chip label="League divisions — coming soon" selected={false} disabled locked onPress={() => {}} />
      </View>
    </View>
  );
}

function OpenLeagueSection({
  format,
  city,
  leagues,
  reloadLeagues,
  myTeamIds,
}: {
  format: string;
  city: string;
  leagues: League[];
  reloadLeagues: () => void;
  myTeamIds: Set<string>;
}) {
  const hub = leagues.find((l) => l.format === format && l.scope === city && !l.parent_league_id);
  const standings = useLeagueStandings(hub?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every team already placed anywhere under this hub — the pool AND every
  // division — so a team already in Division 1 isn't also offered a pool spot.
  const [treeTeamIds, setTreeTeamIds] = useState<Set<string>>(new Set());

  const divisions = leagues
    .filter((l) => hub && l.parent_league_id === hub.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (!hub) return;
    const divisionIds = divisions.map((d) => d.id);
    supabase
      .from('league_teams')
      .select('team_id')
      .in('league_id', [hub.id, ...divisionIds])
      .then(({ data }) => setTreeTeamIds(new Set((data ?? []).map((row) => row.team_id))));
    // divisions is derived fresh from `leagues` each render; comparing its ids
    // (not the array reference) is what should actually trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, divisions.map((d) => d.id).join(',')]);

  if (!hub) {
    return <EmptyState icon="trophy.fill" message={`No ${city} league found yet.`} />;
  }

  async function runAction(action: () => Promise<{ error: PostgrestError | null }>) {
    setBusy(true);
    setError(null);
    const { error: actionError } = await action();
    setBusy(false);
    if (actionError) {
      setError(describeLeagueError(actionError));
    } else {
      standings.reload();
      reloadLeagues();
    }
  }

  return (
    <View style={styles.section}>
      <Text variant="headline">{hub.name}</Text>
      <Text variant="callout" tone="inkMuted" tabular>
        {hub.stage === 'signup' ? 'Open for signups' : hub.stage === 'season' ? 'Season in progress' : 'In divisions'}
        {hub.capacity ? ` · ${hub.capacity} spots` : ''}
      </Text>

      {hub.stage !== 'divisions' && standings.status === 'ready' ? (
        <StandingsTable rows={standings.rows} highlightTeamIds={myTeamIds} />
      ) : null}

      {hub.stage === 'divisions' ? (
        <>
          {divisions.map((division) => (
            <DivisionCard key={division.id} division={division} highlightTeamIds={myTeamIds} />
          ))}
          <Text variant="headline">Waiting pool</Text>
          {standings.status === 'ready' ? (
            <StandingsTable rows={standings.rows} highlightTeamIds={myTeamIds} />
          ) : null}
        </>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      {hub.stage !== 'season' ? (
        <JoinLeagueControl
          leagueId={hub.id}
          format={format}
          joinLabel={hub.stage === 'divisions' ? 'Join waiting pool' : 'Register'}
          registeredTeamIds={treeTeamIds}
          defaultCity={city}
          onJoined={() => {
            standings.reload();
            reloadLeagues();
          }}
        />
      ) : null}

      {/* Dev-only: for real users a signup-stage league only moves to
       *  'season' once its capacity fills (see register_team_for_league) —
       *  there's no legitimate reason to skip that early, so this manual
       *  trigger must never reach production. */}
      {__DEV__ && hub.stage === 'signup' ? (
        <Button
          label="Start season (dev only)"
          variant="secondary"
          onPress={() => runAction(() => startLeagueSeason(hub.id))}
          loading={busy}
        />
      ) : null}

      {hub.stage === 'season' ? (
        <View style={styles.wrapRow}>
          <Chip label="League divisions — coming soon" selected={false} disabled locked onPress={() => {}} />
        </View>
      ) : null}

      {hub.stage === 'divisions' ? (
        <View style={styles.wrapRow}>
          <Chip
            label="New divisions & promotion/relegation — coming soon"
            selected={false}
            disabled
            locked
            onPress={() => {}}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Leagues, shown in Play's Leagues segment (app/(tabs)/play.tsx). Scrolls
 *  itself. */
export function LeaguesContent() {
  const leaguesState = useLeagues();
  const [format, setFormat] = useState(FORMATS[0]);
  const [city, setCity] = useState(CITIES[0]);

  const leagues = leaguesState.status === 'ready' ? leaguesState.leagues : [];
  // Table rows are highlighted only for the user's own teams (Anghelo, #93);
  // nothing while those are loading or failed to load.
  const myTeams = useMyTeams();
  const myTeamIds = new Set(myTeams.status === 'ready' ? myTeams.teams.map(({ team }) => team.id) : []);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Card padded={false}>
        <ListRow
          title="Matchmaking"
          leading={{ icon: 'calendar' }}
          chevron
          onPress={() => router.push('/matchmaking')}
        />
      </Card>

      <View style={styles.section}>
        <SectionHeader title="Format" />
        <View style={styles.wrapRow}>
          {FORMATS.map((f) => (
            <Chip key={f} label={f} selected={f === format} onPress={() => setFormat(f)} />
          ))}
        </View>
      </View>

      {leaguesState.status === 'loading' ? (
        <Card testID="leagues-skeleton">
          <SkeletonText lines={4} />
        </Card>
      ) : null}
      {leaguesState.status === 'error' ? (
        <Banner
          tone="danger"
          message={`Could not load leagues: ${leaguesState.message}`}
          action={{ label: 'Try again', onPress: leaguesState.reload }}
        />
      ) : null}

      {leaguesState.status === 'ready' ? (
        <>
          <View style={styles.section}>
            <SectionHeader title="Island-wide league" />
            <StandardLeagueSection format={format} leagues={leagues} myTeamIds={myTeamIds} />
          </View>

          <View style={styles.section}>
            <SectionHeader title="Open League city" />
            <View style={styles.wrapRow}>
              {CITIES.map((c) => (
                <Chip key={c} label={c} selected={c === city} onPress={() => setCity(c)} />
              ))}
            </View>
            <OpenLeagueSection
              format={format}
              city={city}
              leagues={leagues}
              reloadLeagues={leaguesState.reload}
              myTeamIds={myTeamIds}
            />
          </View>
        </>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="Your fixtures" />
        <FixturesSection />
      </View>
    </ScrollView>
  );
}

/** /leagues is no longer a tab: it opens Play on Leagues. */
export default function LeaguesRoute() {
  return <Redirect href={playHref('leagues')} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  section: { gap: space.sm },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.xs,
  },
  tableRowDivider: { borderTopWidth: hairline, borderTopColor: colors.border },
  tableRowMine: { backgroundColor: colors.brandSoft },
  tableTeam: { flex: 1 },
  tableStat: { minWidth: space.xxl, textAlign: 'right' },
  tablePts: { fontFamily: type.title.fontFamily },
});
