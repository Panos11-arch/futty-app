import { useCallback, useState } from 'react';

import { matchContacts, readDeviceContacts, type MatchedContact, type UnmatchedContact } from '@/lib/contacts';

type ContactsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'error'; message: string }
  | { status: 'ready'; matched: MatchedContact[]; unmatched: UnmatchedContact[] };

/** Contacts access is opt-in (there's no reason to prompt for it before the
 *  Contacts tab is even opened) — starts 'idle' until load() is called. */
export function useContacts() {
  const [state, setState] = useState<ContactsState>({ status: 'idle' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });

    const contacts = await readDeviceContacts();
    if (contacts === null) {
      setState({ status: 'denied' });
      return;
    }

    const { matched, unmatched, error } = await matchContacts(contacts);
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }

    setState({ status: 'ready', matched, unmatched });
  }, []);

  return { ...state, load };
}
