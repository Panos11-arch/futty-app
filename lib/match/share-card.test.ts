// A6 share cards (05-product section 6): the card shows get_match_page's
// fields unchanged, and only for a confirmed match with a score.
import { mockMatchPage, mockPagePlayer } from '@/lib/match/mock';
import { canShareMotm, shareCardData } from '@/lib/match/share-card';

describe('shareCardData', () => {
  it.each(['scheduled', 'played', 'disputed', 'no_result', 'void'] as const)('is null for a %s match', (status) => {
    expect(shareCardData(mockMatchPage({ status }))).toBeNull();
  });

  it('is null for a confirmed forfeit, which has no score', () => {
    expect(shareCardData(mockMatchPage({ forfeit: { side: 'b', reason: 'no_show' } }))).toBeNull();
  });

  it('is null when the server sent no score', () => {
    const page = mockMatchPage();
    page.sides = page.sides.map((s) => ({ ...s, score: null }));
    expect(shareCardData(page)).toBeNull();
  });

  it("passes the server's fields through unchanged", () => {
    const page = mockMatchPage({
      sides: [
        { side: 'a', label: 'Limassol Lions', teamId: 't1', score: 3 },
        { side: 'b', label: 'Nicosia Nomads', teamId: 't2', score: 1 },
      ],
      goals: [
        { side: 'b', scorer: mockPagePlayer('p-nikos'), assist: null },
        { side: 'a', scorer: mockPagePlayer('p-booker'), assist: null },
        { side: 'a', scorer: null, assist: null },
        { side: 'a', scorer: mockPagePlayer('p-booker'), assist: null },
      ],
      motm: [
        { ...mockPagePlayer('p-booker'), votes: 3 },
        { ...mockPagePlayer('p-nikos'), votes: 3 },
      ],
    });
    const booker = mockPagePlayer('p-booker').name;
    const nikos = mockPagePlayer('p-nikos').name;
    expect(shareCardData(page)).toEqual({
      matchId: 'm1',
      a: { label: 'Limassol Lions', score: 3, scorers: [booker, 'Own goal or unknown', booker] },
      b: { label: 'Nicosia Nomads', score: 1, scorers: [nikos] },
      motm: [booker, nikos],
      venue: 'Nuevo Campo',
      // 17:00 UTC is 19:00 in Cyprus in November.
      date: 'Sat 14 Nov · 19:00',
    });
  });

  it('has no venue when the server sends none, and Bibs / Non-bibs for a pickup', () => {
    const data = shareCardData(mockMatchPage({ venue: null }))!;
    expect(data.venue).toBeNull();
    expect([data.a.label, data.b.label]).toEqual(['Bibs', 'Non-bibs']);
  });
});

describe('canShareMotm', () => {
  it('only once the man of the match is decided', () => {
    expect(canShareMotm(shareCardData(mockMatchPage())!)).toBe(false);
    const decided = shareCardData(mockMatchPage({ motm: [{ ...mockPagePlayer('p-booker'), votes: 2 }] }))!;
    expect(canShareMotm(decided)).toBe(true);
  });
});
