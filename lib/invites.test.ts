// Team and booking invites (lib/invites.ts): server calls and one-line errors.
import { acceptInvite, declineInvite, describeInviteError, inviteStatuses, myPayBy, payByLine } from '@/lib/invites';

const mockRpc = jest.fn();
const mockIn = jest.fn();
const mockMaybeSingle = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({
        in: (...args: unknown[]) => mockIn(...args),
        eq: () => ({ maybeSingle: () => mockMaybeSingle() }),
      }),
    }),
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

it('S20A (b): accepting a game invite can say card or cash', async () => {
  await acceptInvite('i1', 'cash');
  await acceptInvite('i2', 'card');
  expect(mockRpc.mock.calls).toEqual([
    ['accept_invite', { p_invite_id: 'i1', p_method: 'cash' }],
    ['accept_invite', { p_invite_id: 'i2', p_method: 'card' }],
  ]);
});

it("S20A (b): reads my share's pay-by time for a booking", async () => {
  mockMaybeSingle.mockResolvedValueOnce({ data: { pay_by: '2026-12-06T17:15:00Z' }, error: null });
  await expect(myPayBy('s1')).resolves.toBe('2026-12-06T17:15:00Z');
  mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
  await expect(myPayBy('s1')).resolves.toBeNull();
  mockMaybeSingle.mockResolvedValueOnce({ data: { pay_by: null }, error: null });
  await expect(myPayBy('s1')).resolves.toBeNull();
  mockMaybeSingle.mockRejectedValueOnce(new Error('offline'));
  await expect(myPayBy('s1')).resolves.toBeNull();
});

it('S20A (b): the pay-by line, in Cyprus time', () => {
  // 17:15 UTC on 6 December is 19:15 in Cyprus.
  expect(payByLine('2026-12-06T17:15:00Z')).toBe('Pay by 19:15 or your spot is released.');
  expect(payByLine(null)).toBeNull();
});

it('S20A (b): words fit one line of at most 10 words', () => {
  for (const code of ['booking_full', 'invite_expired', 'cash_whole_pitch_only', 'player_in_debt']) {
    expect(describeInviteError(err(code)).split(' ').length).toBeLessThanOrEqual(10);
  }
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
    // S20A (b): player invites close when the side is full or at kickoff.
    ['booking_full', 'This game is full.'],
    ['invite_expired', 'This invite expired. The game has started.'],
    ['cash_whole_pitch_only', 'Cash is for a whole pitch only. Pay by card.'],
    // Accepting: a debtor can't join by card either (refuse_debtor_share).
    ['player_in_debt', 'Settle what you owe first.'],
  ])('%s', (code, words) => {
    expect(describeInviteError(err(code))).toBe(words);
  });

  it('passes anything else through', () => {
    expect(describeInviteError(err('boom'))).toBe('boom');
  });
});
