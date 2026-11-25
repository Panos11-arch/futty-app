// delete-account: what the profile row keeps once the account is deleted.
// The row stays (bookings, payments and matches point at it); every
// personal field is cleared, the player card's favourite player (S19)
// included.
export const SCRUBBED_PROFILE = {
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
} as const;
