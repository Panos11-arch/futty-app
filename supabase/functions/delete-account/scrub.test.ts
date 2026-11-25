// delete-account: the profile row is scrubbed, not deleted. Every personal
// field is cleared, including the player card's favourite player (S19).
import { deepStrictEqual } from 'node:assert/strict';

import { SCRUBBED_PROFILE } from './scrub.ts';

Deno.test('every personal field on the profile is cleared', () => {
  deepStrictEqual(SCRUBBED_PROFILE, {
    email: null,
    username: null,
    full_name: 'Deleted player',
    phone: null,
    gender: null,
    date_of_birth: null,
    bio: null,
    city: null,
    position: null,
    preferred_foot: null,
    favourite_player: null,
    show_phone_publicly: false,
    stripe_customer_id: null,
  });
});
