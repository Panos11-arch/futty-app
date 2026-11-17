// P7: Team Premium is off for the first release. Nothing offers it, and the
// leagues that need it say they're coming soon.
import { leagueFormatOpen, openablePlan, TEAM_PREMIUM_ENABLED } from '@/lib/premium';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('Team Premium flag', () => {
  it('is off for the release', () => {
    expect(TEAM_PREMIUM_ENABLED).toBe(false);
  });

  it('closes only the leagues that need Team Premium while it is off', () => {
    expect(leagueFormatOpen('5-a-side')).toBe(true);
    expect(leagueFormatOpen('7-a-side')).toBe(true);
    expect(leagueFormatOpen('9-a-side')).toBe(false);
    expect(leagueFormatOpen('11-a-side')).toBe(false);
  });

  it('opens them again when it is on', () => {
    expect(leagueFormatOpen('9-a-side', true)).toBe(true);
    expect(leagueFormatOpen('11-a-side', true)).toBe(true);
  });

  it('turns a Team Premium link into Personal Premium while it is off', () => {
    expect(openablePlan('team-9-a-side')).toBe('personal');
    expect(openablePlan('team-11-a-side')).toBe('personal');
    expect(openablePlan('personal')).toBe('personal');
    expect(openablePlan('team-9-a-side', true)).toBe('team-9-a-side');
  });
});
