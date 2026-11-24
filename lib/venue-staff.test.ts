// S2: the Account menu's Venue dashboard row and the dashboard screen itself
// use one check, so the row never shows for someone the screen turns away.
import { isVenueStaff, VENUE_STAFF_ROLES } from '@/lib/venue-staff';

describe('isVenueStaff', () => {
  it('is true for every venue staff role the server has', () => {
    for (const role of VENUE_STAFF_ROLES) {
      expect(isVenueStaff({ status: 'ready', profile: { role } })).toBe(true);
    }
    expect(VENUE_STAFF_ROLES).toContain('venue_owner');
  });

  it('is false for a player', () => {
    expect(isVenueStaff({ status: 'ready', profile: { role: 'player' } })).toBe(false);
  });

  it('is false for an unknown or missing role', () => {
    expect(isVenueStaff({ status: 'ready', profile: { role: 'admin' } })).toBe(false);
    expect(isVenueStaff({ status: 'ready', profile: { role: null } })).toBe(false);
    expect(isVenueStaff({ status: 'ready', profile: {} })).toBe(false);
  });

  it('is false until the profile has loaded', () => {
    expect(isVenueStaff({ status: 'loading' })).toBe(false);
    expect(isVenueStaff({ status: 'missing' })).toBe(false);
    expect(isVenueStaff({ status: 'error' })).toBe(false);
  });
});
