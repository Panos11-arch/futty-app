// S7: the Find players tab: search players and teams, Players | Teams.
// Players with no query: "Start following some accounts", then "From your
// contacts". Teams with no query: every team. Friends (S20) come here later.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ContactsSection } from '@/components/community/contacts-section';
import { FollowSuggestions } from '@/components/community/follow-suggestions';
import { FollowToggle } from '@/components/community/follow-toggle';
import { PersonRow, RowsSkeleton } from '@/components/community/person-row';
import { TeamsList } from '@/components/community/teams-list';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { avatarLook } from '@/lib/avatar';
import { SEARCH_MIN_LENGTH, searchPlayers, type CommunityPlayer } from '@/lib/community';
import { profileHref } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';
import type { useFollows } from '@/lib/use-follows';

export type FindView = 'players' | 'teams';

type SearchState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; players: CommunityPlayer[] };

function PlayerResults({ query, follows }: { query: string; follows: ReturnType<typeof useFollows> }) {
  const styles = useStyles();
  const [state, setState] = useState<SearchState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    // A short pause while typing, so each key doesn't query.
    const timer = setTimeout(() => {
      searchPlayers(query).then(({ data, error }) => {
        if (!active) return;
        setState(error || !data ? { status: 'error' } : { status: 'ready', players: data });
      });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, attempt]);

  if (state.status === 'loading') return <RowsSkeleton testID="player-search-skeleton" />;
  if (state.status === 'error') {
    return (
      <Banner tone="danger" message="Couldn't search." action={{ label: 'Try again', onPress: () => setAttempt((n) => n + 1) }} />
    );
  }
  if (state.players.length === 0) return <EmptyState icon="magnifyingglass" message="No players found." />;

  return (
    <View style={styles.list}>
      {state.players.map((p) => (
        <PersonRow
          key={p.id}
          testID={`player-result-${p.id}`}
          name={p.full_name}
          subtitle={p.username ? `@${p.username}` : null}
          kit={avatarLook(p)}
          onPress={() => router.push(profileHref(p.id))}
          actions={
            <FollowToggle
              testID={`player-follow-${p.id}`}
              targetType="player"
              targetId={p.id}
              name={p.full_name}
              follows={follows}
            />
          }
        />
      ))}
    </View>
  );
}

export function FindPlayers({
  follows,
  focusKey,
  onCreateTeam,
}: {
  follows: ReturnType<typeof useFollows>;
  /** Changes when the header's Search is tapped: the field takes focus. */
  focusKey: number;
  onCreateTeam: () => void;
}) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<FindView>('players');
  const searching = query.trim().length >= SEARCH_MIN_LENGTH;

  return (
    <ScrollView
      testID="community-find-players"
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <TextField
        key={focusKey}
        testID="community-search-input"
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="Players and teams"
        autoFocus={focusKey > 0}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <SegmentedControl
        accessibilityLabel="Players or teams"
        options={[
          { value: 'players', label: 'Players', testID: 'community-find-players-tab' },
          { value: 'teams', label: 'Teams', testID: 'community-find-teams-tab' },
        ]}
        value={view}
        onChange={setView}
      />

      {view === 'players' ? (
        searching ? (
          <PlayerResults query={query.trim()} follows={follows} />
        ) : (
          <View style={styles.sections}>
            <FollowSuggestions follows={follows} />
            <ContactsSection follows={follows} />
          </View>
        )
      ) : (
        <TeamsList query={searching ? query : ''} follows={follows} onCreateTeam={onCreateTeam} />
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => ({
  flex: { flex: 1 },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl * 3 },
  sections: { gap: space.xl },
  list: { gap: space.md },
}));
