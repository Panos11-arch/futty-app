// Skill levels, ratings, competitive or casual and balance teams in the app
// (docs/specs/match-record.md decision 1f, sections 4.8 and 5.5; 05-product
// section 4). The server keeps every number and decides every write
// (set_starting_level, set_match_competitive, balance_match_teams; the
// S13B match ratings come from stats, lib/match/rating.ts); these rules only decide what the app shows and which
// controls appear.
import type { Loadable } from '@/lib/match/use-match-result';
import type { RosterPlayer } from '@/lib/match/page';
import type { ResultMatch } from '@/lib/match/result';
import type { Side } from '@/lib/match/types';
import type { AvatarKit } from '@/lib/avatar';

/** `public.player_levels` as the app shows it. */
export type PlayerLevel = {
  level: number;
  provisional: boolean;
  reliabilityPct: number;
  competitiveMatches: number;
  source: 'questionnaire' | 'default';
};

/** balance_match_teams' answer: profile ids per side and each side's average level. */
export type BalancedTeams = {
  sideA: { players: string[]; average: number | null };
  sideB: { players: string[]; average: number | null };
};

/**
 * One decimal, rounded half up like Postgres round(): through whole
 * hundredths first, so 3.05 (stored as 3.05, held as 3.04999… in a double)
 * shows as 3.1.
 */
export function formatLevel(level: number | string): string {
  const hundredths = Math.round(Number(level) * 100);
  return (Math.round(hundredths / 10) / 10).toFixed(1);
}

/**
 * The five questions can still be answered: no level yet, or the default
 * level before any competitive match. Anything else set_starting_level
 * refuses (level_already_set).
 */
export function startingLevelOffered(level: PlayerLevel | null): boolean {
  return level === null || (level.source === 'default' && level.competitiveMatches === 0);
}

/**
 * Whether Home opens the questions now (once per device, after sign-up).
 * Never while the P13 profile setup is pending (no username yet, or still
 * being checked) or a password recovery is under way, and only while Home is
 * the focused screen; otherwise it waits for the next time Home is focused.
 */
export function shouldOfferStartingLevel(input: {
  focused: boolean;
  /** useNeedsProfileSetup: true or 'loading' while the profile isn't complete. */
  profileSetup: boolean | 'loading';
  recovering: boolean;
  /** Offered on this device before; 'loading' until the flag is read. */
  alreadyOffered: boolean | 'loading';
  level: Loadable<{ level: PlayerLevel | null }>;
}): boolean {
  return (
    input.focused &&
    input.profileSetup === false &&
    !input.recovering &&
    input.alreadyOffered === false &&
    input.level.status === 'ready' &&
    startingLevelOffered(input.level.level)
  );
}

export type StartingAnswers = {
  years: string;
  highest: string;
  frequency: string;
  position: string;
  /** '1'–'10'. */
  selfRating: string;
};

export type StartingQuestion = {
  key: keyof StartingAnswers;
  question: string;
  options: { value: string; label: string }[];
};

/** Decision 1f.2's five questions, one per step, with the server's values. */
export const STARTING_QUESTIONS: StartingQuestion[] = [
  {
    key: 'years',
    question: 'How long have you played football?',
    options: [
      { value: 'under_1', label: 'Less than a year' },
      { value: '1_3', label: '1 to 3 years' },
      { value: '3_10', label: '3 to 10 years' },
      { value: 'over_10', label: 'More than 10 years' },
    ],
  },
  {
    key: 'highest',
    question: 'What is the highest level you have played at?',
    options: [
      { value: 'kickabout', label: 'Kickabouts with friends' },
      { value: 'amateur', label: 'School or amateur league' },
      { value: 'semi_pro', label: 'Semi-pro' },
      { value: 'professional', label: 'Professional' },
    ],
  },
  {
    key: 'frequency',
    question: 'How often do you play now?',
    options: [
      { value: 'rarely', label: 'Rarely' },
      { value: 'monthly', label: 'About once a month' },
      { value: 'weekly', label: 'Every week' },
      { value: 'several_weekly', label: 'Several times a week' },
    ],
  },
  {
    key: 'position',
    question: 'Where do you usually play?',
    options: [
      { value: 'gk', label: 'Goalkeeper' },
      { value: 'def', label: 'Defence' },
      { value: 'mid', label: 'Midfield' },
      { value: 'fwd', label: 'Attack' },
    ],
  },
  {
    key: 'selfRating',
    question: 'How would you rate yourself, from 1 to 10?',
    options: Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
  },
];


/**
 * Competitive or casual (decision 1f.1): is_competitive from the server; a
 * captain of either side may switch it while scheduled and before kickoff
 * (set_match_competitive checks again).
 */
export function competitiveView(
  m: ResultMatch,
  captainSide: Side | null,
  now: number
): { isCompetitive: boolean; editable: boolean } {
  const isCompetitive = m.match.is_competitive ?? m.match.competitive ?? m.match.kind === 'named';
  const editable = captainSide !== null && m.match.status === 'scheduled' && now < Date.parse(m.match.kickoff_at);
  return { isCompetitive, editable };
}

/**
 * Mirrors balance_match_teams' checks: a pickup, the caller is its booker
 * (side a's captain), and the sides are open (match_sides_open: scheduled or
 * played, no score entered).
 */
export function canBalanceTeams(m: ResultMatch, viewerId: string | null): boolean {
  return (
    viewerId !== null &&
    m.match.kind === 'pickup' &&
    m.sides.a.captain_profile_id === viewerId &&
    (m.match.status === 'scheduled' || m.match.status === 'played') &&
    m.submission === null
  );
}
