// S7 and S20A: New team from Community: a name, a town, a kit colour and
// friends to invite, with the same roster defaults as the Leagues form.
// create_my_team checks everything on the server (friends only, blocks,
// A4); each friend gets an invite and joins when they accept.
import { router } from 'expo-router';
import { useState } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';

import { TeamBadge } from '@/components/match/team-badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space, type KitColourName } from '@/constants/futty-theme';
import { avatarLook } from '@/lib/avatar';
import { FRIENDS_HREF } from '@/lib/friends';
import { haptic } from '@/lib/haptics';
import { teamHref } from '@/lib/messages';
import { createMyTeam, describeTeamError, KIT_COLOURS, ROSTER_SIZE_PRESETS, TEAM_CITIES } from '@/lib/teams';
import { makeStyles, useTheme } from '@/lib/theme';
import { useFriends } from '@/lib/use-friends';

/** The Leagues form's defaults when no format is chosen. */
export const NEW_TEAM_ROSTER_SIZE = ROSTER_SIZE_PRESETS[3];
export const NEW_TEAM_SUBSTITUTES = 0;

/** "kitSky" -> "Sky". */
export function kitLabel(kit: KitColourName) {
  return kit.slice(3);
}

export function NewTeamSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useStyles();
  const [name, setName] = useState('');
  const [city, setCity] = useState<string>(TEAM_CITIES[0]);
  const [kit, setKit] = useState<KitColourName>(KIT_COLOURS[0]);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setName('');
    setMembers([]);
    setError(null);
    onClose();
  }

  function toggle(profileId: string) {
    setMembers((m) => (m.includes(profileId) ? m.filter((id) => id !== profileId) : [...m, profileId]));
  }

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: createError } = await createMyTeam({
      name: name.trim(),
      city,
      kitColour: kit,
      rosterSize: NEW_TEAM_ROSTER_SIZE,
      substituteSlots: NEW_TEAM_SUBSTITUTES,
      memberIds: members,
    });
    setBusy(false);
    const teamId = (data as { id?: string } | null)?.id;
    if (createError || !teamId) {
      haptic.error();
      setError(describeTeamError(createError));
      return;
    }
    haptic.success();
    close();
    router.push(teamHref(teamId));
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="New team"
      primaryAction={{
        label: 'Create team',
        onPress: create,
        loading: busy,
        disabled: !name.trim(),
        testID: 'new-team-create',
      }}>
      <View style={styles.preview}>
        <TeamBadge name={name.trim() || 'New team'} kitColour={kit} size={space.xxl + space.lg} />
      </View>
      <TextField testID="new-team-name" label="Team name" value={name} onChangeText={setName} maxLength={40} />
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Town">
        {TEAM_CITIES.map((c) => (
          <Chip key={c} testID={`new-team-city-${c.toLowerCase()}`} label={c} selected={city === c} onPress={() => setCity(c)} />
        ))}
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Kit">
        {KIT_COLOURS.map((k) => (
          <Chip
            key={k}
            testID={`new-team-kit-${kitLabel(k).toLowerCase()}`}
            label={kitLabel(k)}
            selected={kit === k}
            onPress={() => setKit(k)}
          />
        ))}
      </View>
      <SectionHeader title="Add friends" />
      <FriendPicker selected={members} onToggle={toggle} onFindFriends={() => {
        close();
        router.push(FRIENDS_HREF);
      }} />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

function FriendPicker({
  selected,
  onToggle,
  onFindFriends,
}: {
  selected: string[];
  onToggle: (profileId: string) => void;
  onFindFriends: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { state, reload } = useFriends();

  if (state.status === 'loading') {
    return (
      <View testID="new-team-friends-skeleton">
        <SkeletonText lines={3} />
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.inline}>
        <Text variant="callout" tone="danger">
          {state.message}
        </Text>
        <Button label="Try again" variant="plain" onPress={reload} />
      </View>
    );
  }
  const friends = state.rows.filter((r) => r.kind === 'friend');
  if (friends.length === 0) {
    return (
      <View style={styles.inline}>
        <Text variant="callout" tone="inkMuted">
          No friends yet.
        </Text>
        <Button label="Find friends" variant="plain" onPress={onFindFriends} testID="new-team-find-friends" />
      </View>
    );
  }
  return (
    <ScrollView style={styles.friends} nestedScrollEnabled>
      {friends.map((f) => {
        const checked = selected.includes(f.profile_id);
        return (
          <ListRow
            key={f.profile_id}
            testID={`new-team-friend-${f.profile_id}`}
            title={f.name}
            leading={{ avatar: { name: f.name, kit: avatarLook(f) } }}
            trailing={
              checked ? <IconSymbol name="checkmark.circle.fill" size={space.xl} color={colors.ink} /> : null
            }
            onPress={() => {
              haptic.tap();
              onToggle(f.profile_id);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={f.name}
          />
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => ({
  preview: { alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  // The sheet doesn't scroll; the list does, within a third of the screen.
  friends: { maxHeight: Dimensions.get('window').height / 3 },
}));
