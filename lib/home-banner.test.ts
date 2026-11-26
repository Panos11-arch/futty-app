import { BANNER_ROTATE_MS, bannerSlides, nextSlide } from '@/lib/home-banner';

describe('Home banner slides (spec 15 section 0.6)', () => {
  it('rotates every 5 seconds', () => {
    expect(BANNER_ROTATE_MS).toBe(5000);
  });

  it('runs Team of the Week, Profile, Leagues, Go Premium, in that order', () => {
    expect(bannerSlides(false).map((s) => s.id)).toEqual(['team-of-the-week', 'profile', 'leagues', 'premium']);
  });

  it('each slide opens its screen', () => {
    expect(Object.fromEntries(bannerSlides(false).map((s) => [s.id, s.href]))).toEqual({
      'team-of-the-week': '/match/team-of-the-week',
      profile: '/profile',
      leagues: '/leagues',
      premium: '/account/premium',
    });
  });

  // Labels only: the feature names from spec 15 and image 01, no taglines.
  it('titles are the agreed labels', () => {
    expect(bannerSlides(false).map((s) => s.title)).toEqual(['Team of the Week', 'Your profile', 'Leagues', 'Go Premium']);
  });

  it('a Premium player gets no Go Premium slide; unknown (still loading) keeps it', () => {
    expect(bannerSlides(true).map((s) => s.id)).toEqual(['team-of-the-week', 'profile', 'leagues']);
    expect(bannerSlides(null).map((s) => s.id)).toContain('premium');
  });

  it('nextSlide wraps around, and stays put with one or no slide', () => {
    expect(nextSlide(0, 4)).toBe(1);
    expect(nextSlide(3, 4)).toBe(0);
    expect(nextSlide(0, 1)).toBe(0);
    expect(nextSlide(0, 0)).toBe(0);
  });
});
