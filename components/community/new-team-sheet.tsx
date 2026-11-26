// S7: New team from Community: a name and a town, with the same roster
// defaults as the Leagues form (create_team checks everything on the server).
import type { PostgrestError } from '@supabase/supabase-js';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { describeLeagueError } from '@/lib/league-errors';
import { teamHref } from '@/lib/messages';
import { createTeam, ROSTER_SIZE_PRESETS, TEAM_CITIES } from '@/lib/teams';
import { makeStyles } from '@/lib/theme';

/** The Leagues form's defaults when no format is chosen. */
export const NEW_TEAM_ROSTER_SIZE = ROSTER_SIZE_PRESETS[3];
export const NEW_TEAM_SUBSTITUTES = 0;

export function NewTeamSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useStyles();
  const [name, setName] = useState('');
  const [city, setCity] = useState<string>(TEAM_CITIES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setName('');
    setError(null);
    onClose();
  }

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: createError } = await createTeam(name.trim(), city, NEW_TEAM_ROSTER_SIZE, NEW_TEAM_SUBSTITUTES);
    setBusy(false);
    const teamId = (data as { id?: string } | null)?.id;
    if (createError || !teamId) {
      haptic.error();
      setError(createError ? describeLeagueError(createError as PostgrestError) : "Couldn't create the team. Try again.");
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
      <TextField testID="new-team-name" label="Team name" value={name} onChangeText={setName} maxLength={40} />
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Town">
        {TEAM_CITIES.map((c) => (
          <Chip key={c} testID={`new-team-city-${c.toLowerCase()}`} label={c} selected={city === c} onPress={() => setCity(c)} />
        ))}
      </View>
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
