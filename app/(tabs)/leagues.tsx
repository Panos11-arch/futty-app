import type { PostgrestError } from '@supabase/supabase-js';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddPlayerRow } from '@/components/add-player-row';
import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { FixtureScoreForm } from '@/components/fixture-score-form';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { CAPACITY_OPTIONS } from '@/lib/booking';
import { canLogFixtureScore, formatFixtureWhen } from '@/lib/fixtures';
import { describeLeagueError } from '@/lib/league-errors';
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

function StandingsTable({ rows, highlightTeamIds }: { rows: StandingsRow[]; highlightTeamIds: Set<string> }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const tint = useThemeColor({}, 'tint');

  if (rows.length === 0) {
    return <ThemedText style={styles.note}>No teams registered yet.</ThemedText>;
  }

  return (
    <View style={[styles.table, { borderColor: border }]}>
      <View style={styles.tableRow}>
        <ThemedText style={[styles.tableTeam, styles.tableHeaderLabel]}>Team</ThemedText>
        <ThemedText style={styles.tableStatHeader}>P</ThemedText>
        <ThemedText style={styles.tableStatHeader}>W</ThemedText>
        <ThemedText style={styles.tableStatHeader}>D</ThemedText>
        <ThemedText style={styles.tableStatHeader}>L</ThemedText>
        <ThemedText style={styles.tableStatHeader}>F</ThemedText>
        <ThemedText style={styles.tableStatHeader}>A</ThemedText>
        <ThemedText style={styles.tableStatHeader}>GD</ThemedText>
        <ThemedText style={styles.tableStatHeader}>PTS</ThemedText>
      </View>
      {rows.map((row) => {
        const pts = row.won * 3 + row.drawn + row.pts_adjustment;
        const gd = row.goals_for - row.goals_against;
        const isMine = highlightTeamIds.has(row.team_id);
        return (
          <View key={row.id} style={[styles.tableRow, { borderTopColor: border, borderTopWidth: 1 }]}>
            <ThemedText style={[styles.tableTeam, isMine && { color: tint, fontWeight: '700' }]}>
              {row.team_name}
            </ThemedText>
            <ThemedText style={styles.tableStat}>{row.played}</ThemedText>
            <ThemedText style={styles.tableStat}>{row.won}</ThemedText>
            <ThemedText style={styles.tableStat}>{row.drawn}</ThemedText>
            <ThemedText style={styles.tableStat}>{row.lost}</ThemedText>
            <ThemedText style={styles.tableStat}>{row.goals_for}</ThemedText>
            <ThemedText style={styles.tableStat}>{row.goals_against}</ThemedText>
            <ThemedText style={styles.tableStat}>{gd >= 0 ? `+${gd}` : gd}</ThemedText>
            <ThemedText style={[styles.tableStat, styles.tablePts]}>{pts}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

function DivisionCard({ division, highlightTeamIds }: { division: League; highlightTeamIds: Set<string> }) {
  const standings = useLeagueStandings(division.id);
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  return (
    <View style={[styles.divisionCard, { borderColor: border }]}>
      <ThemedText type="defaultSemiBold">{division.name}</ThemedText>
      {standings.status === 'loading' ? <ActivityIndicator /> : null}
      {standings.status === 'error' ? (
        <ThemedText style={styles.note}>Could not load: {standings.message}</ThemedText>
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

  if (myTeams.status === 'loading') return <ActivityIndicator />;
  if (myTeams.status === 'error') {
    return <ThemedText style={styles.note}>Could not load your teams: {myTeams.message}</ThemedText>;
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
    return (
      <ThemedText style={styles.note}>You&apos;re already in this league.</ThemedText>
    );
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
      <View style={styles.section}>
        <ThemedText style={styles.note}>
          {!justCreatedRoster
            ? 'Loading roster…'
            : !rosterReady
              ? `${mainRemaining} more player${mainRemaining === 1 ? '' : 's'} needed.`
              : needsPremium
                ? `Squad ready — but ${format} needs Team Premium (€${PREMIUM_FORMAT_PRICES[format]}/season) first.`
                : 'Squad ready — register below.'}
        </ThemedText>

        {needsPremium ? (
          <AuthButton
            label="Buy Team Premium"
            variant="secondary"
            onPress={() => router.push('/team')}
            disabled={busy}
            compact
          />
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
          <ActivityIndicator />
        )}

        {error ? <AuthError>{error}</AuthError> : null}

        <AuthButton
          label={joinLabel}
          onPress={finishRegistration}
          disabled={!canRegister}
          busy={busy}
        />
        <AuthButton
          label="Finish squad later (won't register yet)"
          variant="secondary"
          onPress={() => {
            setJustCreated(null);
            setCreating(false);
            myTeams.reload();
          }}
          disabled={busy}
        />
      </View>
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
        <AuthButton label="Register a new team" onPress={() => setCreating(true)} disabled={busy} compact />

        {error ? <AuthError>{error}</AuthError> : null}

        {/* Every row here is one of the CURRENT user's own teams not yet in
         *  this league — i.e. an incomplete registration by definition, so
         *  "Finish register" is the one action every row needs (it opens the
         *  same roster/register screen either way: still filling the roster,
         *  or already full and ready to hit Register). No separate "Join" —
         *  it duplicated this with a button that just bounced back with
         *  roster_incomplete for anything not already full. */}
        {eligibleTeams.map(({ team }) => {
          const needsPremium = premiumGated && !hasTeamPremium(team, format);
          return (
            <View key={team.id} style={styles.joinRow}>
              <View style={styles.joinRowLabel}>
                {needsPremium ? (
                  <IconSymbol name="lock.fill" size={12} color={FuttyColors.stone500} />
                ) : null}
                <ThemedText style={styles.note}>{team.name}</ThemedText>
              </View>
              <AuthButton
                label={needsPremium ? 'Buy Team Premium' : 'Finish register'}
                variant="secondary"
                onPress={() => (needsPremium ? router.push('/team') : setJustCreated(team))}
                disabled={busy}
              />
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <ThemedText style={styles.note}>Squad size (including you)</ThemedText>
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

      <ThemedText style={styles.note}>Substitutes (optional)</ThemedText>
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

      <AuthField value={name} onChangeText={setName} placeholder="Team name" editable={!busy} />

      <ThemedText style={styles.note}>City</ThemedText>
      <View style={styles.wrapRow}>
        {CITIES.map((c) => (
          <Chip key={c} label={c} selected={c === city} onPress={() => setCity(c)} />
        ))}
      </View>

      {premiumGated ? (
        <View style={styles.premiumNoteRow}>
          <IconSymbol name="lock.fill" size={12} color={FuttyColors.stone500} />
          <ThemedText style={styles.note}>
            {format} needs Team Premium (€{price}/season) to register — buy it from the Team tab once this
            squad is created
          </ThemedText>
        </View>
      ) : null}

      {error ? <AuthError>{error}</AuthError> : null}

      <AuthButton label="Create team" onPress={createTeamOnly} disabled={!name.trim()} busy={busy} compact />
      <AuthButton
        label="Cancel"
        variant="secondary"
        onPress={() => setCreating(false)}
        disabled={busy}
        compact
      />
    </View>
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

  if (fixtures.status === 'loading') return <ActivityIndicator />;
  if (fixtures.status === 'error') {
    return <ThemedText style={styles.note}>Could not load fixtures: {fixtures.message}</ThemedText>;
  }

  // Completed fixtures aren't "upcoming" — excluded so a past result can't
  // outrank a not-yet-scheduled fixture just because it has an earlier date.
  const upcoming = fixtures.fixtures.filter((f) => f.status !== 'completed');

  if (upcoming.length === 0) {
    return (
      <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
        No upcoming fixtures yet.
      </IconLabel>
    );
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
      <View style={styles.fixtureRow}>
        <ThemedText type="defaultSemiBold">
          {next.home_team?.name ?? 'Unknown team'} vs {next.away_team?.name ?? 'Unknown team'}
        </ThemedText>
        <ThemedText style={styles.note}>{statusLabel}</ThemedText>
      </View>

      {canLogFixtureScore(next, myCaptainTeamIds) ? (
        <FixtureScoreForm fixture={next} onSubmitted={fixtures.reload} />
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => router.push('/upcoming-fixtures')}>
        <ThemedText type="link">Upcoming fixtures</ThemedText>
      </Pressable>
    </View>
  );
}

function StandardLeagueSection({ format, leagues }: { format: string; leagues: League[] }) {
  const league = leagues.find((l) => l.format === format && l.scope === 'Island-wide');
  const standings = useLeagueStandings(league?.id ?? '');

  if (!league) {
    return (
      <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
        No {format} league found yet.
      </IconLabel>
    );
  }

  const registeredTeamIds = new Set(standings.status === 'ready' ? standings.rows.map((r) => r.team_id) : []);

  return (
    <View style={styles.section}>
      <ThemedText type="defaultSemiBold">{league.name}</ThemedText>
      {standings.status === 'loading' ? <ActivityIndicator /> : null}
      {standings.status === 'error' ? (
        <ThemedText style={styles.note}>Could not load: {standings.message}</ThemedText>
      ) : null}
      {standings.status === 'ready' ? (
        <StandingsTable rows={standings.rows} highlightTeamIds={registeredTeamIds} />
      ) : null}

      <JoinLeagueControl
        leagueId={league.id}
        format={format}
        joinLabel="Join"
        registeredTeamIds={registeredTeamIds}
        onJoined={standings.reload}
      />

      <Chip label="League divisions — coming soon" selected={false} disabled locked onPress={() => {}} />
    </View>
  );
}

function OpenLeagueSection({
  format,
  city,
  leagues,
  reloadLeagues,
}: {
  format: string;
  city: string;
  leagues: League[];
  reloadLeagues: () => void;
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
    return (
      <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
        No {city} league found yet.
      </IconLabel>
    );
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
      <ThemedText type="defaultSemiBold">{hub.name}</ThemedText>
      <ThemedText style={styles.note}>
        {hub.stage === 'signup' ? 'Open for signups' : hub.stage === 'season' ? 'Season in progress' : 'In divisions'}
        {hub.capacity ? ` · ${hub.capacity} spots` : ''}
      </ThemedText>

      {hub.stage !== 'divisions' && standings.status === 'ready' ? (
        <StandingsTable rows={standings.rows} highlightTeamIds={treeTeamIds} />
      ) : null}

      {hub.stage === 'divisions' ? (
        <>
          {divisions.map((division) => (
            <DivisionCard key={division.id} division={division} highlightTeamIds={treeTeamIds} />
          ))}
          <ThemedText type="defaultSemiBold">Waiting pool</ThemedText>
          {standings.status === 'ready' ? (
            <StandingsTable rows={standings.rows} highlightTeamIds={treeTeamIds} />
          ) : null}
        </>
      ) : null}

      {error ? <AuthError>{error}</AuthError> : null}

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
        <AuthButton
          label="Start season (dev only)"
          variant="secondary"
          onPress={() => runAction(() => startLeagueSeason(hub.id))}
          busy={busy}
          compact
        />
      ) : null}

      {hub.stage === 'season' ? (
        <Chip label="League divisions — coming soon" selected={false} disabled locked onPress={() => {}} />
      ) : null}

      {hub.stage === 'divisions' ? (
        <Chip
          label="New divisions & promotion/relegation — coming soon"
          selected={false}
          disabled
          locked
          onPress={() => {}}
        />
      ) : null}
    </View>
  );
}

export default function LeaguesScreen() {
  const leaguesState = useLeagues();
  const [format, setFormat] = useState(FORMATS[0]);
  const [city, setCity] = useState(CITIES[0]);

  const leagues = leaguesState.status === 'ready' ? leaguesState.leagues : [];

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <IconLabel icon="trophy.fill" type="title" iconSize={28}>League</IconLabel>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/matchmaking')}
            style={styles.matchmakingLink}>
            <IconSymbol name="calendar" size={14} color={FuttyColors.emerald950} />
            <ThemedText style={styles.matchmakingLinkText}>Matchmaking</ThemedText>
            <IconSymbol name="chevron.right" size={16} color={FuttyColors.emerald950} />
          </Pressable>
        </View>

        <IconLabel icon="sportscourt.fill" type="subtitle">Format</IconLabel>
        <View style={styles.wrapRow}>
          {FORMATS.map((f) => (
            <Chip key={f} label={f} selected={f === format} onPress={() => setFormat(f)} />
          ))}
        </View>

        {leaguesState.status === 'loading' ? <ActivityIndicator /> : null}
        {leaguesState.status === 'error' ? (
          <ThemedText style={styles.note}>Could not load leagues: {leaguesState.message}</ThemedText>
        ) : null}

        {leaguesState.status === 'ready' ? (
          <>
            <IconLabel icon="globe" type="subtitle">Island-wide league</IconLabel>
            <StandardLeagueSection format={format} leagues={leagues} />

            <IconLabel icon="building.2.fill" type="subtitle">Open League city</IconLabel>
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
            />
          </>
        ) : null}

        <IconLabel icon="list.clipboard.fill" type="subtitle">Your fixtures</IconLabel>
        <FixturesSection />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 10,
    padding: 16,
    paddingBottom: 48,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fixtureRow: {
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  matchmakingLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  matchmakingLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: FuttyColors.stone900,
  },
  section: {
    gap: 8,
    marginBottom: 8,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  joinRowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  joinRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  premiumNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  divisionCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  table: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 3,
  },
  tableTeam: {
    flex: 1,
    fontSize: 12,
  },
  tableHeaderLabel: {
    fontSize: 10,
    opacity: 0.6,
    textTransform: 'uppercase',
  },
  tableStat: {
    width: 22,
    textAlign: 'center',
    fontSize: 11,
  },
  tablePts: {
    fontWeight: '700',
  },
  tableStatHeader: {
    width: 22,
    textAlign: 'center',
    fontSize: 9,
    opacity: 0.6,
    textTransform: 'uppercase',
  },
});
