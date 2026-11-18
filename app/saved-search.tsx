import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SavedSearchForm } from '@/components/booking/saved-search-form';
import { EmptyState, SkeletonBlock } from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import { fetchSearchOptions, useLoad } from '@/lib/booking-search';
import { createSavedSearch, draftFromSearch, fetchSearchPlaces, type SavedSearchDraft } from '@/lib/saved-searches';
import { useRules } from '@/lib/use-rules';

/** Save a search (decided 18 November), prefilled from Book a pitch. */
export default function SaveSearchScreen() {
  // The limit in the refusal's words comes from the rules.
  useRules();
  const params = useLocalSearchParams<{ day?: string; start?: string; minutes?: string; format?: string }>();
  const options = useLoad('options', fetchSearchOptions);
  const places = useLoad('places', fetchSearchPlaces);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(draft: SavedSearchDraft) {
    setSaving(true);
    setError(null);
    try {
      await createSavedSearch(draft);
      router.replace('/account/saved-searches');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save this search. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const header = <Stack.Screen options={{ title: 'Save this search' }} />;
  if (options.state.status === 'loading') {
    return (
      <View style={styles.screen}>
        {header}
        <SkeletonBlock width="100%" height={220} />
      </View>
    );
  }
  if (options.state.status === 'error') {
    return (
      <View style={styles.screen}>
        {header}
        <EmptyState
          icon="exclamationmark.circle.fill"
          message={options.state.message}
          action={{ label: 'Try again', onPress: options.reload }}
        />
      </View>
    );
  }
  const today = options.state.data.today;
  const initial = draftFromSearch({
    day: params.day ?? today,
    start: params.start ?? '18:00',
    minutes: Number(params.minutes) || 60,
    format: params.format ?? null,
  });
  return (
    <>
      {header}
      <SavedSearchForm
        initial={initial}
        today={today}
        windowDays={options.state.data.window_days}
        places={places.state}
        saving={saving}
        error={error}
        onSave={save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas, padding: space.lg },
});
