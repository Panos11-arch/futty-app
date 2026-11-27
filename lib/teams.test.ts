// S20A (a): the teams lib (lib/teams.ts): server calls and the one-line errors.
import {
  cancelTeamInvite,
  createMyTeam,
  createTeam,
  deleteTeam,
  describeTeamError,
  fetchPendingTeamInvites,
  fetchTeamCompetitions,
  getTeamRoster,
  hasTeamPremium,
  inviteTeamMember,
  isPremiumFormat,
  KIT_COLOURS,
  leaveTeam,
  passCaptaincy,
  removeTeamMember,
  teamKit,
  type Team,
} from '@/lib/teams';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: null, error: null });
});

const team = {
  id: 't1',
  name: 'Tigers',
  city: 'Nicosia',
  kit_colour: 'kitRed',
  deleted_at: null,
  premium_9aside: true,
  premium_11aside: false,
} as Team;

describe('server calls', () => {
  it('createMyTeam sends the trimmed name, kit, roster and the friends', async () => {
    mockRpc.mockResolvedValue({ data: { id: 't9' }, error: null });
    await expect(
      createMyTeam({ name: '  Kato United ', city: 'Limassol', kitColour: 'kitSky', rosterSize: 7, substituteSlots: 0, memberIds: ['a', 'b'] }),
    ).resolves.toEqual({ data: { id: 't9' }, error: null });
    expect(mockRpc).toHaveBeenCalledWith('create_my_team', {
      p_name: 'Kato United',
      p_city: 'Limassol',
      p_kit_colour: 'kitSky',
      p_roster_size: 7,
      p_substitute_slots: 0,
      p_member_ids: ['a', 'b'],
    });
  });

  it('the captain and member tools call their functions', async () => {
    await cancelTeamInvite('i1');
    await removeTeamMember('t1', 'p1');
    await passCaptaincy('t1', 'p2');
    await leaveTeam('t1');
    await deleteTeam('t1');
    expect(mockRpc.mock.calls).toEqual([
      ['cancel_team_invite', { p_invite_id: 'i1' }],
      ['remove_team_member', { p_team_id: 't1', p_profile_id: 'p1' }],
      ['pass_captaincy', { p_team_id: 't1', p_profile_id: 'p2' }],
      ['leave_team', { p_team_id: 't1' }],
      ['delete_team', { p_team_id: 't1' }],
    ]);
  });

  it('unchanged calls keep their arguments', async () => {
    await createTeam('A', 'Paphos', 11, 0);
    await inviteTeamMember('t1', 'p1');
    await getTeamRoster('t1');
    expect(mockRpc.mock.calls).toEqual([
      ['create_team', { p_name: 'A', p_city: 'Paphos', p_roster_size: 11, p_substitute_slots: 0 }],
      ['invite_team_member', { p_team_id: 't1', p_profile_id: 'p1', p_role: 'player' }],
      ['get_team_roster', { p_team_id: 't1' }],
    ]);
  });

  it('fetchPendingTeamInvites returns the rows, or throws one line', async () => {
    const rows = [{ invite_id: 'i1', profile_id: 'p1', name: 'Ben', role: 'player' }];
    mockRpc.mockResolvedValueOnce({ data: rows, error: null });
    await expect(fetchPendingTeamInvites('t1')).resolves.toEqual(rows);
    expect(mockRpc).toHaveBeenCalledWith('team_pending_invites', { p_team_id: 't1' });

    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchPendingTeamInvites('t1')).resolves.toEqual([]);

    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'not_captain' } });
    await expect(fetchPendingTeamInvites('t1')).rejects.toThrow('Only the captain can do that.');
  });

  it('fetchTeamCompetitions returns the rows, or throws one line', async () => {
    const rows = [{ league_id: 'l1', name: 'Nicosia 5s', format: '5-a-side', running: true }];
    mockRpc.mockResolvedValueOnce({ data: rows, error: null });
    await expect(fetchTeamCompetitions('t1')).resolves.toEqual(rows);
    expect(mockRpc).toHaveBeenCalledWith('team_competitions', { p_team_id: 't1' });

    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchTeamCompetitions('t1')).resolves.toEqual([]);

    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchTeamCompetitions('t1')).rejects.toThrow("Couldn't load. Try again.");
  });
});

describe('describeTeamError', () => {
  it.each([
    ['not_friends', 'Only friends can join. Add them as a friend first.'],
    ['blocked', "You can't add this player."],
    ['age_pair_refused', "You can't add this player."],
    ['player_not_found', 'Player not found.'],
    ['name_required', 'Give the team a name.'],
    ['invalid_kit_colour', 'Pick a kit colour.'],
    ['team_full', 'No places left. Pick fewer players.'],
    ['not_captain', 'Only the captain can do that.'],
    ['not_member', 'They’re not in this team.'],
    ['already_captain', 'You’re already captain.'],
    ['use_leave', 'Use Leave team instead.'],
    ['captain_must_pass', 'Make someone else captain first.'],
    ['use_delete', 'You’re the last member. Delete the team instead.'],
    ['not_last_member', 'Remove the other members first.'],
    ['team_in_competition', 'This team is in a league. Try after it ends.'],
    ['team_has_booking', 'This team has a game coming up. Try after it.'],
    ['team_deleted', 'This team was deleted.'],
    ['invite_not_pending', 'This invite was already answered.'],
  ])('%s', (code, words) => {
    const line = describeTeamError({ message: code });
    expect(line).toBe(words);
    expect(line.split(' ').length).toBeLessThanOrEqual(10);
  });

  it('anything else is one line asking to try again', () => {
    expect(describeTeamError({ message: 'connection reset' })).toBe('Something went wrong. Try again.');
    expect(describeTeamError(null)).toBe('Something went wrong. Try again.');
  });
});

describe('kits and premium', () => {
  it('offers the eight kit tokens', () => {
    expect(KIT_COLOURS).toEqual(['kitRed', 'kitBlue', 'kitSky', 'kitGreen', 'kitYellow', 'kitOrange', 'kitBlack', 'kitWhite']);
  });

  it('teamKit reads a known kit, or none', () => {
    expect(teamKit(team)).toBe('kitRed');
    expect(teamKit({ kit_colour: null })).toBeNull();
    expect(teamKit({ kit_colour: 'kitPink' })).toBeNull();
    expect(teamKit({})).toBeNull();
  });

  it('Team Premium gates only 9 and 11 a side', () => {
    expect(isPremiumFormat('9-a-side')).toBe(true);
    expect(isPremiumFormat('5-a-side')).toBe(false);
    expect(hasTeamPremium(team, '9-a-side')).toBe(true);
    expect(hasTeamPremium(team, '11-a-side')).toBe(false);
    expect(hasTeamPremium(team, '5-a-side')).toBe(true);
  });
});
