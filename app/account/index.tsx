import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuRow, MenuSection } from '@/components/menu-row';
import { useAuth } from '@/lib/auth';
import { fetchMyPlayerCard } from '@/lib/player-card';
import { isPremiumPlayer } from '@/lib/premium';
import { useUnreadMessages } from '@/lib/use-messages';
import { useProfile } from '@/lib/use-profile';
import { isVenueStaff } from '@/lib/venue-staff';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/**
 * Account, opened from the menu button in every tab's header (S2, spec 15
 * section 0.5): My bookings, Payments, Saved searches, Premium, Settings,
 * Help, and Venue dashboard for venue staff only. Messages (S13) shows the
 * unread count.
 * "More" holds what has no other place yet (spec 15 section 0.9): Play
 * (Teams, Matches, Leagues) until S6–S9, Leaderboards until S15, and Your
 * activity until S8. Terms, Privacy policy and How Futty works are in Help.
 * Every row is one tap from here.
 */
export default function AccountMenuScreen() {
  const styles = useStyles();
  const { signOut } = useAuth();
  const profile = useProfile();
  const premium = isPremiumPlayer(profile) === true;
  const unread = useUnreadMessages();
  // Share follows the player card (S8): no Share for a minor or a player
  // without a username (my_player_card's show_qr). Hidden until it's known.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    let live = true;
    fetchMyPlayerCard().then((card) => {
      if (live) setCanShare(card.status === 'ready' && card.card.show_qr);
    });
    return () => {
      live = false;
    };
  }, []);

  async function shareProfile() {
    const name = profile.status === 'ready' ? profile.profile.username ?? profile.profile.full_name : null;
    await Share.share({
      message: name
        ? `Play with me on Futty — find me as @${name}.`
        : 'Play with me on Futty — book pitches, join squads, and track your games.',
    });
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView testID="account-menu" contentContainerStyle={styles.content}>
        <MenuSection>
          <MenuRow
            testID="account-my-bookings"
            icon="sportscourt.fill"
            label="My bookings"
            onPress={() => router.push('/my-bookings')}
          />
          <MenuRow
            testID="account-payments"
            icon="creditcard.fill"
            label="Payments"
            onPress={() => router.push('/account/payments')}
          />
          <MenuRow
            testID="account-messages"
            icon="bubble.left.fill"
            label="Messages"
            badge={unread}
            onPress={() => router.push('/messages')}
          />
          <MenuRow
            testID="account-saved-searches"
            icon="magnifyingglass"
            label="Saved searches"
            onPress={() => router.push('/account/saved-searches')}
          />
          <MenuRow
            testID="account-premium"
            icon="crown.fill"
            label={premium ? 'Manage Premium' : 'Go Premium'}
            onPress={() => router.push('/account/premium')}
          />
          <MenuRow
            testID="account-settings"
            icon="gearshape.fill"
            label="Settings"
            onPress={() => router.push('/account/settings')}
          />
          <MenuRow
            testID="account-help"
            icon="questionmark.circle.fill"
            label="Help"
            onPress={() => router.push('/account/help')}
          />
          {isVenueStaff(profile) ? (
            <MenuRow
              testID="account-venue-dashboard"
              icon="building.columns.fill"
              label="Venue dashboard"
              onPress={() => router.push('/venue-dashboard')}
            />
          ) : null}
        </MenuSection>

        <MenuSection title="More">
          {/* tab-play: this row now does the old Play tab's job (.maestro). */}
          <MenuRow testID="tab-play" icon="sportscourt.fill" label="Play" onPress={() => router.push('/play')} />
          {/* S6: the posts list (publish your games, older opposition posts). */}
          <MenuRow
            testID="account-posts"
            icon="person.2.fill"
            label="Posts"
            onPress={() => router.push('/squad-posts')}
          />
          <MenuRow
            testID="account-leaderboards"
            icon="trophy.fill"
            label="Leaderboards"
            onPress={() => router.push('/match/leaderboards')}
          />
          {/* S8: the streak and "Players you play with most" left the Profile tab (image 19). */}
          <MenuRow
            testID="account-streak"
            icon="calendar"
            label="Streak"
            onPress={() => router.push('/account/activity/streak')}
          />
          <MenuRow
            testID="account-teammates"
            icon="person.2.fill"
            label="Teammates"
            onPress={() => router.push('/account/activity/teammates')}
          />
          <MenuRow
            testID="account-activity"
            icon="flag.checkered"
            label="Your activity"
            onPress={() => router.push('/account/activity')}
          />
          <MenuRow
            testID="account-edit-profile"
            icon="pencil"
            label="Edit profile"
            onPress={() => router.push('/edit-profile')}
          />
          {canShare ? (
            <MenuRow testID="account-share-profile" icon="square.and.arrow.up" label="Share profile" onPress={shareProfile} />
          ) : null}
        </MenuSection>

        <View style={styles.logoutSection}>
          <MenuSection>
            <MenuRow
              testID="account-log-out"
              icon="rectangle.portrait.and.arrow.right"
              label="Log out"
              destructive
              onPress={signOut}
            />
          </MenuSection>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  flex: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    gap: space.xl,
    padding: space.lg,
    paddingBottom: space.xxl,
  },
  logoutSection: {
    marginTop: space.lg,
  },
}));
