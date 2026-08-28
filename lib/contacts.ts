import * as Contacts from 'expo-contacts';

import { supabase } from '@/lib/supabase';

export type DeviceContact = {
  id: string;
  name: string;
  phoneNumbers: string[];
};

export type ContactMatch = {
  profileId: string;
  username: string | null;
};

export type MatchedContact = DeviceContact & { match: ContactMatch };
export type UnmatchedContact = DeviceContact & { match: null };

/** Reads the device's contact list (name + phone numbers only) — never
 *  emails, addresses, or photos, since matching against Futty accounts is
 *  all the Community screen needs. Returns null if permission was denied
 *  rather than throwing, so the screen can show its own explanation. */
export async function readDeviceContacts(): Promise<DeviceContact[] | null> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') return null;

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers],
  });

  return data
    .filter((c) => c.name && c.phoneNumbers && c.phoneNumbers.length > 0)
    .map((c) => ({
      id: c.id ?? c.name!,
      name: c.name!,
      phoneNumbers: (c.phoneNumbers ?? []).map((p) => p.number).filter((n): n is string => !!n),
    }));
}

/** Splits a device contact list into who's already on Futty and who isn't —
 *  see supabase/contacts.sql's match_contacts_by_phone for how the match
 *  itself works (last-9-digits, server-side, never exposes un-opted-in
 *  phone numbers back to the client beyond "yes/no this number matched"). */
export async function matchContacts(
  contacts: DeviceContact[]
): Promise<{ matched: MatchedContact[]; unmatched: UnmatchedContact[]; error: Error | null }> {
  const allNumbers = [...new Set(contacts.flatMap((c) => c.phoneNumbers))];
  if (allNumbers.length === 0) return { matched: [], unmatched: contacts as UnmatchedContact[], error: null };

  const { data, error } = await supabase.rpc('match_contacts_by_phone', { p_phone_numbers: allNumbers });
  if (error) return { matched: [], unmatched: [], error: error as unknown as Error };

  const rows = (data ?? []) as { phone_number: string; profile_id: string; username: string | null }[];
  const matchByNumber = new Map(rows.map((row) => [row.phone_number, row]));

  const matched: MatchedContact[] = [];
  const unmatched: UnmatchedContact[] = [];

  for (const contact of contacts) {
    const hit = contact.phoneNumbers.map((n) => matchByNumber.get(n)).find((m) => m);
    if (hit) {
      matched.push({ ...contact, match: { profileId: hit.profile_id, username: hit.username } });
    } else {
      unmatched.push({ ...contact, match: null });
    }
  }

  return { matched, unmatched, error: null };
}
