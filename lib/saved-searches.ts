// Saved searches (decided 18 November; spec 13 "Saved searches"). A player
// saves a search from the booking search and gets one alert a day when a
// matching slot frees up or a matching game asks for players. The server
// checks every rule (the limit, how far ahead, the place); the app only
// shows what it says.
import { endTime, slotLabel } from '@/lib/booking-search';
import { ruleText } from '@/lib/rules';
import { supabase } from '@/lib/supabase';

export type SavedSearch = {
  id: string;
  /** A Cyprus date, or null for a weekday search. */
  day: string | null;
  /** ISO weekday, 1 = Monday ... 7 = Sunday; null for a dated search. */
  weekday: number | null;
  from_local: string;
  to_local: string;
  minutes: number;
  /** Null = any format. */
  format: string | null;
  /** A whole city, or one exact area, or neither (anywhere). */
  city: string | null;
  area: string | null;
  created_at: string;
};

export type SavedSearchDraft = Omit<SavedSearch, 'id' | 'created_at'>;

/** A city of a live venue and its areas ("Nicosia (Strovolos)"). */
export type SearchPlace = { city: string; areas: string[] };

const COLUMNS = 'id, day, weekday, from_local, to_local, minutes, format, city, area, created_at';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** "18:00:00" -> "18:00". */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** ISO weekday of a "YYYY-MM-DD" day (1 = Monday). */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** A new search from the booking search: that day, that game, from its start. */
export function draftFromSearch(query: { day: string; start: string; minutes: number; format: string | null }): SavedSearchDraft {
  return {
    day: query.day,
    weekday: null,
    from_local: query.start,
    to_local: endTime(query.start, query.minutes) ?? '24:00',
    minutes: query.minutes,
    format: query.format,
    city: null,
    area: null,
  };
}

/** Every half hour of the day, "00:00" to "24:00", for the window's ends. */
export function halfHours(): string[] {
  return Array.from({ length: 49 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
}

/** Whether the game fits between the window's ends (the server checks it too). */
export function gameFits(draft: Pick<SavedSearchDraft, 'from_local' | 'to_local' | 'minutes'>): boolean {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return toMin(draft.to_local) - toMin(draft.from_local) >= draft.minutes;
}

/** "Thu 20 Nov · 18:00–21:00" or "Every Thursday · 18:00–21:00". */
export function savedSearchTitle(s: Pick<SavedSearch, 'day' | 'weekday' | 'from_local' | 'to_local'>): string {
  if (s.day) return slotLabel(s.day, s.from_local, s.to_local);
  return `Every ${WEEKDAYS[(s.weekday ?? 1) - 1]} · ${hhmm(s.from_local)}–${hhmm(s.to_local)}`;
}

/** "60 min · 5-a-side · Nicosia" / "90 min · Any format · Anywhere". */
export function savedSearchDetail(s: Pick<SavedSearch, 'minutes' | 'format' | 'city' | 'area'>): string {
  return `${s.minutes} min · ${s.format ?? 'Any format'} · ${s.area ?? s.city ?? 'Anywhere'}`;
}

/** The server's refusal in plain words. */
export function savedSearchErrorMessage(message: string): string {
  if (message.includes('saved_search_limit')) {
    return ruleText(
      (r) => `You can save up to ${r.saved_searches_max} searches. Delete one to save this.`,
      'You’ve saved as many searches as you can. Delete one to save this.',
    );
  }
  if (message.includes('saved_search_too_far')) return 'That day is further ahead than you can book.';
  if (message.includes('saved_search_in_past')) return 'That day has passed. Pick another day.';
  if (message.includes('saved_search_unknown_place')) return 'No venue on Futty is there yet. Pick another place.';
  if (message.includes('saved_searches_fits')) return 'The game doesn’t fit between those times.';
  return 'Couldn’t save this search. Try again.';
}

export async function fetchSavedSearches(): Promise<SavedSearch[]> {
  const { data, error } = await supabase.from('saved_searches').select(COLUMNS).order('created_at');
  if (error) throw new Error('Couldn’t load your saved searches.');
  return (data ?? []) as SavedSearch[];
}

export async function fetchSearchPlaces(): Promise<SearchPlace[]> {
  const { data, error } = await supabase.rpc('saved_search_places');
  if (error) throw new Error('Couldn’t load the places.');
  return (data ?? []) as SearchPlace[];
}

/** Saves it; throws the refusal in plain words. */
export async function createSavedSearch(draft: SavedSearchDraft): Promise<void> {
  const { error } = await supabase.from('saved_searches').insert(draft);
  if (error) throw new Error(savedSearchErrorMessage(error.message));
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const { error } = await supabase.from('saved_searches').delete().eq('id', id);
  if (error) throw new Error('Couldn’t delete this search. Try again.');
}
