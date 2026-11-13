import {
  choiceWords,
  chooseNoOpponent,
  gipedoModeSentence,
  gipedoStatusLine,
  pullOutOfGipedo,
  pullOutWords,
  rosterWordsForGipedo,
  settlementLine,
} from './booking-gipedo';
import type { GipedoDetail } from './booking-search';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

function gipedo(overrides: Partial<GipedoDetail> = {}): GipedoDetail {
  return {
    team: { id: 't1', name: 'Lions' },
    opponent: { state: 'none', team: null },
    my_side: 'a',
    pull_out: { kind: 'free', cents: 0 },
    choice_due: false,
    choice: null,
    play_normal_cents: 6550,
    settlement: null,
    ...overrides,
  };
}

beforeEach(() => mockRpc.mockReset());

describe('gipedoModeSentence', () => {
  it('says the card is held for the server’s amount and who pays, in spec 15’s words', () => {
    const sentence = gipedoModeSentence(6550);
    expect(sentence).toContain('€65.50');
    expect(sentence).toContain('losing team pays');
    expect(sentence).toContain('50/50');
    expect(sentence).not.toMatch(/authori[sz]e|capture|void/i);
  });
});

describe('gipedoStatusLine', () => {
  it('waiting for an opponent', () => {
    expect(gipedoStatusLine(gipedo())).toBe('Waiting for an opponent. Teams can take it on until 24 hours before kickoff.');
  });

  it('an opponent offered but hasn’t placed their hold', () => {
    const g = gipedo({ opponent: { state: 'offered', team: { id: 't2', name: 'Tigers' } } });
    expect(gipedoStatusLine(g)).toBe('Tigers offered to play. Waiting for their card to be held.');
  });

  it('both holds are in', () => {
    const g = gipedo({ opponent: { state: 'held', team: { id: 't2', name: 'Tigers' } } });
    expect(gipedoStatusLine(g)).toBe('Lions v Tigers. Both cards are held; the losing team pays the pitch.');
  });
});

describe('pullOutWords', () => {
  it('free with no opponent', () => {
    expect(pullOutWords(gipedo(), 100)).toEqual(['The booking is cancelled and your hold is released. Nothing is taken.']);
  });

  it('at least 6 hours before kickoff: €1 per player, the rest released', () => {
    const words = pullOutWords(gipedo({ pull_out: { kind: 'fee', cents: 1000 } }), 100);
    expect(words[0]).toBe('€10.00 is taken from your hold (€1.00 per player) and the rest is released.');
    expect(words[1]).toBe("The booking is cancelled and the other team's hold is released.");
  });

  it('the opponent pulling out leaves the booking with the other team', () => {
    const words = pullOutWords(gipedo({ my_side: 'b', pull_out: { kind: 'fee', cents: 1000 } }), 100);
    expect(words[1]).toBe('The other team keeps the booking and can look for a new opponent.');
  });

  it('less than 6 hours before kickoff: your team counts as the loser', () => {
    expect(pullOutWords(gipedo({ pull_out: { kind: 'forfeit', cents: 6550 } }), 100)).toEqual([
      'Kickoff is less than 6 hours away, so your team counts as the losing team and €65.50 is taken from your hold after the match.',
    ]);
  });

  it('nothing when the caller can’t pull out', () => {
    expect(pullOutWords(gipedo({ pull_out: null }), 100)).toEqual([]);
  });
});

describe('choiceWords', () => {
  it('the server’s play-as-normal amount', () => {
    expect(choiceWords(gipedo({ choice_due: true }))).toEqual({
      message: 'Nobody has taken on this game. Play it as a normal booking or cancel it free. If you don’t choose by 6 hours before kickoff, it is cancelled free.',
      playLabel: 'Play as normal: €65.50',
      cancelLabel: 'Cancel free',
    });
  });

  it('nothing when no choice is due', () => {
    expect(choiceWords(gipedo())).toBeNull();
  });
});

describe('settlementLine', () => {
  it.each([
    [{ reason: 'won', capture_cents: 0, status: 'done' }, 'Your team won. Your hold is released.'],
    [{ reason: 'lost', capture_cents: 6550, status: 'done' }, '€65.50 was taken from your hold.'],
    [{ reason: 'split', capture_cents: 3275, status: 'due' }, 'Split 50/50: €32.75 is being taken from your hold.'],
    [{ reason: 'lost', capture_cents: 6550, status: 'debt' }, 'Your hold had expired, so you owe €65.50.'],
  ] as const)('%o', (settlement, words) => {
    expect(settlementLine(gipedo({ settlement: { ...settlement } }))).toBe(words);
  });

  it('nothing before it settles', () => {
    expect(settlementLine(gipedo())).toBeNull();
  });
});

describe('rosterWordsForGipedo', () => {
  it('a held card and a covered spot say what they are', () => {
    expect(rosterWordsForGipedo('held')).toBe('Card held for Gipedo Pano');
    expect(rosterWordsForGipedo('covered')).toBe("Covered by the captains' holds");
    expect(rosterWordsForGipedo('in_app')).toBeNull();
  });
});

describe('server calls', () => {
  it('pulling out sends only the booking', async () => {
    mockRpc.mockResolvedValue({ data: { result: 'pulled_out' }, error: null });
    expect(await pullOutOfGipedo('b1')).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('gipedo_pull_out', { p_booking_id: 'b1' });
  });

  it('a refusal comes back in words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'cannot_pull_out' } });
    expect(await pullOutOfGipedo('b1')).toBe("You can't pull out of this game.");
  });

  it('the no-opponent choice sends the booking and the choice', async () => {
    mockRpc.mockResolvedValue({ data: { result: 'cancelled' }, error: null });
    expect(await chooseNoOpponent('b1', 'cancel')).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('gipedo_no_opponent_choice', { p_booking_id: 'b1', p_choice: 'cancel' });
  });
});
