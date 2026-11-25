// A venue's phone and website (S5), set by its own staff from the
// dashboard. The server checks the caller and both values
// (set_venue_contact, supabase/migrations/20261124200000_pay_venue_contact.sql).
import { SERVER_ERROR_FALLBACK } from '@/lib/booking-errors';
import { supabase } from '@/lib/supabase';

export type VenueContact = { phone: string | null; website: string | null };

const ERRORS: Record<string, string> = {
  invalid_phone: 'Check the phone number and try again.',
  invalid_website: 'Check the website address and try again.',
  not_venue_staff: 'Only this venue’s staff can change this.',
};

/** A refusal in words: what happened and what to do. */
export function contactError(message: string): string {
  const code = Object.keys(ERRORS).find((c) => message.includes(c));
  return code ? ERRORS[code] : SERVER_ERROR_FALLBACK;
}

export async function saveVenueContact(
  venueId: string,
  phone: string,
  website: string,
): Promise<{ saved: VenueContact | null; error: string | null }> {
  const { data, error } = await supabase.rpc('set_venue_contact', { p_venue_id: venueId, p_phone: phone, p_website: website });
  if (error) return { saved: null, error: contactError(error.message) };
  return { saved: data as VenueContact, error: null };
}
