// S18: the ids of the bundled illustrated avatars. Only the id is stored
// (profiles.avatar_illustration), and the server accepts exactly this list
// (pay_avatar_illustration). The drawings live apart, in
// assets/avatars/illustrations.ts, so the set can be redrawn without
// changing an id.
export const AVATAR_ILLUSTRATION_IDS = [
  'avatar-01', 'avatar-02', 'avatar-03', 'avatar-04', 'avatar-05', 'avatar-06', 'avatar-07', 'avatar-08',
  'avatar-09', 'avatar-10', 'avatar-11', 'avatar-12', 'avatar-13', 'avatar-14', 'avatar-15', 'avatar-16',
  'avatar-17', 'avatar-18', 'avatar-19', 'avatar-20', 'avatar-21', 'avatar-22', 'avatar-23', 'avatar-24',
  'avatar-25', 'avatar-26', 'avatar-27', 'avatar-28', 'avatar-29', 'avatar-30', 'avatar-31', 'avatar-32',
  'avatar-33', 'avatar-34', 'avatar-35', 'avatar-36', 'avatar-37', 'avatar-38', 'avatar-39', 'avatar-40',
  'avatar-41', 'avatar-42', 'avatar-43', 'avatar-44', 'avatar-45', 'avatar-46', 'avatar-47', 'avatar-48',
] as const;

export type AvatarIllustrationId = (typeof AVATAR_ILLUSTRATION_IDS)[number];

const IDS: ReadonlySet<string> = new Set(AVATAR_ILLUSTRATION_IDS);

export function isAvatarIllustrationId(value: unknown): value is AvatarIllustrationId {
  return typeof value === 'string' && IDS.has(value);
}

/** "avatar-07" -> "Avatar 7", for screen readers in the picker. */
export function avatarIllustrationLabel(id: AvatarIllustrationId): string {
  return `Avatar ${Number(id.slice('avatar-'.length))}`;
}
