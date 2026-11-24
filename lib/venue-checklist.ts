// The venue dashboard's "Set up your venue" card (S5A): which parts the
// venue has entered, worked out by the server (venue_setup_status, staff of
// that venue only), each opening its setup screen. Hidden once complete.
import { supabase } from '@/lib/supabase';

export type SetupStatus = {
  photos: boolean;
  amenities: boolean;
  menu: boolean;
  hours: boolean;
  contact: boolean;
  pitches: boolean;
  prices: boolean;
  complete: boolean;
};

type StepKey = Exclude<keyof SetupStatus, 'complete'>;

const STEPS = [
  { key: 'photos', label: 'Photos', pathname: '/venue-photos' },
  { key: 'amenities', label: 'Amenities', pathname: '/venue-amenities' },
  { key: 'menu', label: 'Food & drink', pathname: '/venue-menu' },
  { key: 'hours', label: 'Opening hours', pathname: '/venue-hours' },
  { key: 'contact', label: 'Phone and website', pathname: '/venue-contact' },
  { key: 'pitches', label: 'Pitches', pathname: '/venue-pitches' },
  { key: 'prices', label: 'Prices', pathname: '/venue-prices' },
] as const satisfies readonly { key: StepKey; label: string; pathname: string }[];

export type SetupPathname = (typeof STEPS)[number]['pathname'];

export function setupSteps(status: SetupStatus) {
  return STEPS.map((s) => ({ ...s, done: status[s.key] }));
}

export async function fetchSetupStatus(venueId: string): Promise<SetupStatus> {
  const { data, error } = await supabase.rpc('venue_setup_status', { p_venue_id: venueId });
  if (error || !data) throw new Error('Could not load your venue. Try again.');
  return data as SetupStatus;
}
