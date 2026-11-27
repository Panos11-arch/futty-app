// Team and booking invites (lib/invites.ts): server calls and one-line errors.
import { acceptInvite, declineInvite, describeInviteError, inviteStatuses } from '@/lib/invites';

const mockRpc = jest.fn();
const mockIn = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({ select: () => ({ in: (...args: unknown[]) => mockIn(...args) }) }),
  },
}));

const err = (message: string) => ({ message }) as Parameters<typeof describeInviteError>[0];

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockIn.mockReset();
});

it('accepts and declines by invite id', async () => {
  await acceptInvite('i1');
  await declineInvite('i2');
  expect(mockRpc.mock.calls).toEqual([
    ['accept_invite', { p_invite_id: 'i1' }],
    ['decline_invite', { p_invite_id: 'i2' }],
  ]);
});

it('reads statuses, cancelled included; none asked, none read', async () => {
  mockIn.mockResolvedValue({ data: [{ id: 'i1', status: 'cancelled' }, { id: 'i2', status: 'accepted' }] });
  const statuses = await inviteStatuses(['i1', 'i2']);
  expect(mockIn).toHaveBeenCalledWith('id', ['i1', 'i2']);
  expect(statuses.get('i1')).toBe('cancelled');
  expect(statuses.get('i2')).toBe('accepted');
  expect((await inviteStatuses([])).size).toBe(0);
  expect(mockIn).toHaveBeenCalledTimes(1);
});

describe('describeInviteError', () => {
  it.each([
    ['blocked', "You can't join this team."],
    ['age_pair_refused', "You can't join this team."],
    ['team_deleted', 'This team was deleted.'],
    ['team_full', 'No places left on the team (pending invites count too).'],
    ['invite_not_pending', 'You already answered this invite.'],
  ])('%s', (code, words) => {
    expect(describeInviteError(err(code))).toBe(words);
  });

  it('passes anything else through', () => {
    expect(describeInviteError(err('boom'))).toBe('boom');
  });
});
