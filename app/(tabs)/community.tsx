// S7 (image 18): the Community tab. S2's header (title, bell, menu) stays on
// top; under it the dark band with Search, Messages (S13's inbox) and the
// tabs For you | Following | Find players, then the + button.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { CommunityBand, type CommunityTab } from '@/components/community/community-band';
import { Fab } from '@/components/community/fab';
import { FeedList } from '@/components/community/feed-list';
import { FindPlayers } from '@/components/community/find-players';
import { NewSheet } from '@/components/community/new-sheet';
import { NewTeamSheet } from '@/components/community/new-team-sheet';
import { Chip } from '@/components/ui/chip';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useFollows } from '@/lib/use-follows';
import { useUnreadMessages } from '@/lib/use-messages';

type ForYouView = 'all' | 'mine';

function ForYou({ onCreatePost }: { onCreatePost: () => void }) {
  const styles = useStyles();
  const [view, setView] = useState<ForYouView>('all');
  const chips = (
    <View style={styles.chips}>
      <Chip testID="community-chip-all" label="All" selected={view === 'all'} onPress={() => setView('all')} />
      <Chip
        testID="community-chip-your-posts"
        label="Your posts"
        selected={view === 'mine'}
        onPress={() => setView('mine')}
      />
    </View>
  );
  const empty = { message: 'No posts yet.', action: { label: 'Create post', onPress: onCreatePost } };
  return view === 'all' ? (
    <FeedList key="all" scope="for_you" testID="community-feed-for-you" header={chips} empty={empty} />
  ) : (
    <FeedList key="mine" scope="mine" testID="community-feed-mine" header={chips} empty={empty} />
  );
}

/** The Community tab's content under S2's header. */
export function CommunityContent() {
  const styles = useStyles();
  const [tab, setTab] = useState<CommunityTab>('for_you');
  // A tab, once opened, stays mounted (hidden with display:none) so coming
  // back doesn't load it again.
  const [opened, setOpened] = useState<Record<CommunityTab, boolean>>({
    for_you: true,
    following: false,
    find_players: false,
  });
  const [focusKey, setFocusKey] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const unread = useUnreadMessages();
  const follows = useFollows();

  function select(next: CommunityTab) {
    setOpened((o) => ({ ...o, [next]: true }));
    setTab(next);
  }

  function search() {
    select('find_players');
    setFocusKey((k) => k + 1);
  }

  const createPost = () => router.push('/my-bookings');

  return (
    <View style={styles.flex}>
      <CommunityBand
        tab={tab}
        onTab={select}
        onSearch={search}
        onMessages={() => router.push('/messages')}
        unread={unread}
      />
      <View style={styles.flex}>
        <View style={tab === 'for_you' ? styles.flex : styles.hidden}>
          <ForYou onCreatePost={createPost} />
        </View>
        {opened.following ? (
          <View style={tab === 'following' ? styles.flex : styles.hidden}>
            <FeedList
              scope="following"
              testID="community-feed-following"
              empty={{ message: 'No posts yet.', action: { label: 'Find players', onPress: () => select('find_players') } }}
            />
          </View>
        ) : null}
        {opened.find_players ? (
          <View style={tab === 'find_players' ? styles.flex : styles.hidden}>
            <FindPlayers follows={follows} focusKey={focusKey} onCreateTeam={() => setTeamOpen(true)} />
          </View>
        ) : null}
        <Fab accessibilityLabel="Create a post or team" onPress={() => setNewOpen(true)} />
      </View>
      <NewSheet visible={newOpen} onClose={() => setNewOpen(false)} onNewTeam={() => setTeamOpen(true)} />
      <NewTeamSheet visible={teamOpen} onClose={() => setTeamOpen(false)} />
    </View>
  );
}

/** The Community tab (S2, spec 15 section 0.5). The header comes from the tab layout. */
export default function CommunityScreen() {
  const styles = useStyles();
  return (
    <View testID="community-screen" style={styles.screen}>
      <CommunityContent />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  hidden: { display: 'none' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
