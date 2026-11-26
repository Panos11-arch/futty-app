// Home's rotating banner (S3; spec 15 section 0.6): Team of the Week →
// Profile → Leagues → Go Premium, every 5 seconds. Go Premium is left out for
// a player the server says is on Premium.
import type { IconSymbolName } from '@/components/ui/icon-mapping';

export const BANNER_ROTATE_MS = 5000;

export type BannerSlideId = 'team-of-the-week' | 'profile' | 'leagues' | 'premium';

export type BannerSlide = {
  id: BannerSlideId;
  title: string;
  icon: IconSymbolName;
  href: '/match/team-of-the-week' | '/profile' | '/leagues' | '/account/premium';
};

const SLIDES: BannerSlide[] = [
  { id: 'team-of-the-week', title: 'Team of the Week', icon: 'star.fill', href: '/match/team-of-the-week' },
  { id: 'profile', title: 'Your profile', icon: 'person.fill', href: '/profile' },
  { id: 'leagues', title: 'Leagues', icon: 'trophy.fill', href: '/leagues' },
  { id: 'premium', title: 'Go Premium', icon: 'crown.fill', href: '/account/premium' },
];

/** `premium` is the server's answer (isPremiumPlayer): null while loading. */
export function bannerSlides(premium: boolean | null): BannerSlide[] {
  return premium === true ? SLIDES.filter((s) => s.id !== 'premium') : SLIDES;
}

/** The slide after `index`, back to the first after the last. */
export function nextSlide(index: number, count: number): number {
  return count <= 1 ? 0 : (index + 1) % count;
}
