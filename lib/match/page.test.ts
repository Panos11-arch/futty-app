import { mockMatchPage, mockPagePlayer, mockResultMatch, mockRoster, PAGE_CLOSED, PAGE_OPEN, RESULT_AFTER_END, RESULT_BEFORE_KICKOFF } from '@/lib/match/mock';
import {
  clearPosition,
  formationPositions,
  goalsReady,
  lineupDraft,
  lineupEditable,
  motmView,
  pitchLayout,
  placePlayer,
  playerName,
  positionLabel,
  savedLineup,
  scorersOpen,
  sidePlayers,
  writerSides,
} from '@/lib/match/page';

const none = new Set<string>();

describe('writerSides (mirrors match_side_writer)', () => {
  it('pickup: the booker writes both sides', () => {
    expect(writerSides(mockResultMatch(), 'booker', none)).toEqual(['a', 'b']);
  });

  it('pickup: a Non-bibs player writes nothing', () => {
    expect(writerSides(mockResultMatch(), 'me', none)).toEqual([]);
  });

  it('named: each captain writes only their own side', () => {
    const m = mockResultMatch({ kind: 'named' });
    expect(writerSides(m, 'booker', none)).toEqual(['a']);
    expect(writerSides(m, 'away-captain', none)).toEqual(['b']);
    expect(writerSides(m, 'me', none)).toEqual([]);
  });

  it("named: a captain of a side's team writes it", () => {
    expect(writerSides(mockResultMatch({ kind: 'named' }), 'me', new Set(['team-away']))).toEqual(['b']);
  });

  it('signed out: nothing', () => {
    expect(writerSides(mockResultMatch(), null, none)).toEqual([]);
  });
});

describe('scorers', () => {
  it('open while confirmed and before scorersOpenUntil; exactly at it is closed', () => {
    expect(scorersOpen(mockMatchPage(), PAGE_OPEN)).toBe(true);
    expect(scorersOpen(mockMatchPage(), PAGE_CLOSED)).toBe(false);
  });

  it('never for a forfeit or an unconfirmed match', () => {
    expect(scorersOpen(mockMatchPage({ forfeit: { side: 'b', reason: 'no_show' } }), PAGE_OPEN)).toBe(false);
    expect(scorersOpen(mockMatchPage({ status: 'disputed' }), PAGE_OPEN)).toBe(false);
  });

  it('Save needs exactly as many goals as the score, each with a scorer choice', () => {
    expect(goalsReady([{ scorer: 'p1' }, { scorer: null }], 3)).toBe(false);
    expect(goalsReady([{ scorer: 'p1' }, { scorer: null }, { scorer: 'p2' }], 3)).toBe(true);
    expect(goalsReady([{ scorer: 'p1' }, { scorer: undefined }, { scorer: 'p2' }], 3)).toBe(false);
    expect(goalsReady([{ scorer: 'p1' }], 0)).toBe(false);
    expect(goalsReady([], 0)).toBe(true);
    expect(goalsReady([], null)).toBe(false);
  });

  it('a null scorer reads "Own goal"; a guest by their name', () => {
    expect(playerName(null)).toBe('Own goal');
    expect(playerName({ name: null, guestName: 'Kostas' })).toBe('Kostas');
  });

  it("sidePlayers: that side's players who haven't left, guests included", () => {
    expect(sidePlayers(mockRoster(), 'a').map((p) => p.id)).toEqual(['p-booker', 'p-me', 'p-guest']);
    expect(sidePlayers(mockRoster(), 'b').map((p) => p.id)).toEqual(['p-nikos', 'p-maria']);
  });
});

describe('man of the match', () => {
  it('open, checked in: checked-in players who are not me and not guests', () => {
    const view = motmView(mockMatchPage(), mockRoster(), 'me', PAGE_OPEN);
    expect(view.kind).toBe('vote');
    if (view.kind !== 'vote') return;
    expect(view.nominees.map((p) => p.id)).toEqual(['p-booker', 'p-nikos', 'p-noside']);
  });

  it('after voting: "You voted for" that player', () => {
    expect(motmView(mockMatchPage({ myVote: 'p-nikos' }), mockRoster(), 'me', PAGE_OPEN)).toEqual({
      kind: 'voted',
      name: 'Nikos Away',
      closesAt: '2026-11-15T19:00:00.000Z',
    });
  });

  it('not checked in, or a stranger: open but no vote', () => {
    expect(motmView(mockMatchPage(), mockRoster(), 'maria', PAGE_OPEN).kind).toBe('open');
    expect(motmView(mockMatchPage(), null, 'stranger', PAGE_OPEN).kind).toBe('open');
  });

  it('the result stays hidden until voting closes, then ties are shared', () => {
    const tie = [
      { ...mockPagePlayer('p-booker'), votes: 2 },
      { ...mockPagePlayer('p-nikos'), votes: 2 },
    ];
    expect(motmView(mockMatchPage(), mockRoster(), 'me', PAGE_OPEN).kind).not.toBe('closed');
    expect(motmView(mockMatchPage({ motm: tie }), mockRoster(), 'me', PAGE_CLOSED)).toEqual({ kind: 'closed', winners: tie });
  });

  it('no vote for a forfeit or a disputed match', () => {
    expect(motmView(mockMatchPage({ forfeit: { side: 'a', reason: 'pulled_out' } }), mockRoster(), 'me', PAGE_OPEN).kind).toBe('none');
    expect(motmView(mockMatchPage({ status: 'disputed' }), mockRoster(), 'me', PAGE_OPEN).kind).toBe('none');
  });
});

describe('lineups', () => {
  it('editable only while scheduled and before kickoff', () => {
    expect(lineupEditable(mockMatchPage({ status: 'scheduled' }), RESULT_BEFORE_KICKOFF)).toBe(true);
    expect(lineupEditable(mockMatchPage({ status: 'scheduled' }), Date.parse('2026-11-14T17:00:00.000Z'))).toBe(false);
    expect(lineupEditable(mockMatchPage({ status: 'played' }), RESULT_AFTER_END)).toBe(false);
  });

  it.each([
    ['1-2-1', ['gk', 'd1', 'm1', 'm2', 'f1']],
    ['2-2', ['gk', 'd1', 'd2', 'f1', 'f2']],
    ['2-2-1', ['gk', 'd1', 'd2', 'm1', 'm2', 'f1']],
    ['3-1-1', ['gk', 'd1', 'd2', 'd3', 'm1', 'f1']],
    ['4-2-3-1', ['gk', 'd1', 'd2', 'd3', 'd4', 'm1', 'm2', 'm3', 'm4', 'm5', 'f1']],
  ])('%s has the server keys', (formation, keys) => {
    expect(formationPositions(formation)).toEqual(keys);
  });

  it('every position has a spoken label and a place on the pitch', () => {
    expect(positionLabel('gk')).toBe('Goalkeeper');
    expect(positionLabel('d2')).toBe('Defender 2');
    expect(positionLabel('m1')).toBe('Midfielder 1');
    expect(positionLabel('f3')).toBe('Forward 3');
    const spots = pitchLayout('2-2-1');
    expect(spots.map((s) => s.key)).toEqual(formationPositions('2-2-1'));
    for (const s of spots) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(1);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(1);
    }
    // The keeper is nearest our goal; forwards furthest.
    expect(spots[0].y).toBeGreaterThan(spots[spots.length - 1].y);
  });

  it('tap-to-place fills a position and moves a player who was elsewhere', () => {
    let draft = lineupDraft('2-2');
    draft = placePlayer(draft, 'gk', 'p-me');
    expect(draft.gk).toBe('p-me');
    draft = placePlayer(draft, 'f1', 'p-me');
    expect(draft).toEqual({ gk: null, d1: null, d2: null, f1: 'p-me', f2: null });
    expect(clearPosition(draft, 'f1').f1).toBeNull();
  });

  it('a saved lineup becomes a draft with every position', () => {
    const page = mockMatchPage({
      lineups: [{ side: 'a', formation: '2-2', positions: [{ ...mockPagePlayer('p-me'), key: 'd1' }] }],
    });
    expect(savedLineup(page, 'a')).toEqual({ formation: '2-2', draft: { gk: null, d1: 'p-me', d2: null, f1: null, f2: null } });
    expect(savedLineup(page, 'b')).toBeNull();
  });
});
