import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { SavedSearchesList } from '@/components/booking/saved-searches-list';
import { useLoad } from '@/lib/booking-search';
import { deleteSavedSearch, fetchSavedSearches } from '@/lib/saved-searches';

/** The player's saved searches (decided 18 November): see them, delete any. */
export default function SavedSearchesScreen() {
  const searches = useLoad('saved-searches', fetchSavedSearches);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteSavedSearch(id);
      searches.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete this search. Try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Saved searches' }} />
      <SavedSearchesList
        searches={searches.state}
        deletingId={deletingId}
        error={error}
        onDelete={remove}
        onRetry={searches.reload}
        onNewSearch={() => router.push('/book')}
      />
    </>
  );
}
