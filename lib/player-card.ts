// S19: the player card (docs/specs/15-design.md section 0.6, image 20, the
// S19 card mockup). Everything on it comes from my_player_card() on the
// server (20261125160318_pay_profile_card.sql): the signed-in player's own
// card, nothing private, with show_qr false for a minor (age rule A5) or a
// player without a username. The app only formats what it's given.
import type { Href } from 'expo-router';

import { formatLevel } from '@/lib/match/levels';
import { supabase } from '@/lib/supabase';

/** The positions profiles_position_check accepts (Striker became Forward). */
export const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'] as const;
/** The strong foot values profiles_preferred_foot_check accepts. */
export const FEET = ['Left', 'Right', 'Both'] as const;
/** profiles_favourite_player_check: 1 to 40 characters. */
export const FAVOURITE_PLAYER_MAX = 40;

export type CardTeam = { id: string; name: string };

export type PlayerCard = {
  username: string | null;
  full_name: string | null;
  avatar_style: string | null;
  avatar_kit_colour: string | null;
  avatar_number: number | null;
  avatar_illustration: string | null;
  /** A5 skill level, 1.00-7.00, or null before the first one. */
  level: number | null;
  position: string | null;
  preferred_foot: string | null;
  favourite_player: string | null;
  /** The Cyprus date the account was made, YYYY-MM-DD. */
  member_since: string | null;
  /** At most two, league teams first. */
  teams: CardTeam[];
  /** Every team, for "+N". */
  team_count: number;
  /** Decided by the server: false for a minor or without a username. */
  show_qr: boolean;
};

export type CardLoad = { status: 'ready'; card: PlayerCard } | { status: 'error' };

export async function fetchMyPlayerCard(): Promise<CardLoad> {
  try {
    const { data, error } = await supabase.rpc('my_player_card').maybeSingle();
    if (error || !data) return { status: 'error' };
    const card = data as PlayerCard;
    return {
      status: 'ready',
      card: {
        ...card,
        level: card.level === null || card.level === undefined ? null : Number(card.level),
        teams: card.teams ?? [],
        team_count: card.team_count ?? 0,
      },
    };
  } catch {
    return { status: 'error' };
  }
}

/** "Limassol Lions · Sunday Casuals +1"; null with no teams. */
export function teamsLabel(teams: CardTeam[], count: number): string | null {
  if (teams.length === 0) return null;
  const names = teams.map((t) => t.name).join(' · ');
  const more = count - teams.length;
  return more > 0 ? `${names} +${more}` : names;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "November 2026" from the server's Cyprus date; null if unreadable. */
export function memberSinceLabel(date: string | null): string | null {
  const found = /^(\d{4})-(\d{2})-\d{2}$/.exec(date ?? '');
  if (!found) return null;
  const month = MONTHS[Number(found[2]) - 1];
  return month ? `${month} ${found[1]}` : null;
}

/** "Level 4.3"; null before the first level. */
export function cardLevelLabel(level: number | null): string | null {
  return level === null ? null : `Level ${formatLevel(level)}`;
}

/** The link the QR holds: futty.app/p/<username> (S16 opens it in the app). */
export function cardLink(username: string): string {
  return `https://futty.app/p/${encodeURIComponent(username)}`;
}

/** What Edit profile saves: trimmed, at most 40 characters, null when empty. */
export function normaliseFavouritePlayer(text: string): string | null {
  const value = text.trim().slice(0, FAVOURITE_PLAYER_MAX).trim();
  return value === '' ? null : value;
}

/**
 * Where the card's Scan button goes. Null until S20 builds scanning a
 * player card, so the card shows only Share and Edit (decided 25 November).
 * S20: return its scanner's route here and the button appears.
 */
export function scanRoute(): Href | null {
  return null;
}
