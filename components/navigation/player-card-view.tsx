// S19: the player card itself, like a university digital ID in Futty's style
// (the S19 card mockup; image 20 for the sheet around it). Three parts:
//   1. night top: the bundled Futty logo centred, the avatar as a rounded
//      square on the left, @username, the name in Cairo bold and the A5
//      level in a green pill;
//   2. a dark band: Position · Strong foot, Favourite player, Teams, Member
//      since (each hidden when empty);
//   3. a white bottom: the QR for futty.app/p/<username> and "Tap to view
//      full screen", only when the server says show_qr (never for a minor).
// Nothing private is on it. It's a View the Share button captures as a PNG.
import { forwardRef } from 'react';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Avatar, FuttyLogo, initials, Text } from '@/components/ui';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { hairline, radius, space } from '@/constants/futty-theme';
import { avatarLook } from '@/lib/avatar';
import { cardLevelLabel, cardLink, memberSinceLabel, teamsLabel, type PlayerCard } from '@/lib/player-card';
import { makeStyles, useTheme } from '@/lib/theme';

/** The avatar's rounded square. */
export const CARD_AVATAR = space.xxl * 2 + space.md;
/** The QR on the card; full screen draws it bigger. */
export const CARD_QR = space.xxl * 5;

export type PlayerCardViewProps = {
  card: PlayerCard;
  /** The avatar and name open the player's profile. */
  onOpenProfile: () => void;
  /** The QR opens it full screen. */
  onOpenQr: () => void;
};

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.detail, wide && styles.detailWide]} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text variant="caption" tone="onNightMuted">
        {label}
      </Text>
      <Text variant="callout" tone="onNight" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export const PlayerCardView = forwardRef<View, PlayerCardViewProps>(function PlayerCardView(
  { card, onOpenProfile, onOpenQr },
  ref,
) {
  const styles = useStyles();
  const { colors } = useTheme();
  const name = card.full_name?.trim() || card.username || 'Player';
  const look = avatarLook(card);
  const level = cardLevelLabel(card.level);
  const teams = teamsLabel(card.teams, card.team_count);
  const since = memberSinceLabel(card.member_since);
  const hasDetails = !!(card.position || card.preferred_foot || card.favourite_player || teams || since);

  return (
    <View ref={ref} collapsable={false} testID="my-card" style={styles.card}>
      <View style={styles.top}>
        <View style={styles.logo}>
          <FuttyLogo size={space.xxl} />
        </View>
        <Pressable
          testID="my-card-open-profile"
          accessibilityRole="button"
          accessibilityLabel={`${name}, open profile`}
          onPress={onOpenProfile}
          style={styles.who}>
          {look ? (
            <View testID="my-card-avatar" style={[styles.avatar, styles.avatarLook]}>
              <Avatar name={name} kit={look} size={CARD_AVATAR} />
            </View>
          ) : (
            <View testID="my-card-avatar" style={[styles.avatar, styles.avatarInitials]}>
              <Text variant="title" tone="greenInk" allowFontScaling={false}>
                {initials(name)}
              </Text>
            </View>
          )}
          <View style={styles.names}>
            {card.username ? (
              <Text testID="my-card-username" variant="callout" tone="onNightMuted" numberOfLines={1}>
                {`@${card.username}`}
              </Text>
            ) : null}
            <Text testID="my-card-name" variant="title" tone="onNight" numberOfLines={2}>
              {name}
            </Text>
            {level ? (
              <View testID="my-card-level" style={styles.levelPill}>
                <Text variant="caption" style={{ color: colors.green }}>
                  {level}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      </View>

      {hasDetails ? (
        <View testID="my-card-details" style={styles.band}>
          {card.position ? <Detail label="Position" value={card.position} /> : null}
          {card.preferred_foot ? <Detail label="Strong foot" value={card.preferred_foot} /> : null}
          {card.favourite_player ? <Detail label="Favourite player" value={card.favourite_player} /> : null}
          {teams ? <Detail label="Teams" value={teams} /> : null}
          {since ? <Detail label="Member since" value={since} wide /> : null}
        </View>
      ) : null}

      {card.show_qr && card.username ? (
        <Pressable
          testID="my-card-qr"
          accessibilityRole="button"
          accessibilityLabel="Your card's QR code. View full screen"
          onPress={onOpenQr}
          style={styles.bottom}>
          <QRCode value={cardLink(card.username)} size={CARD_QR} color={colors.night} backgroundColor={colors.onNight} />
          <Text variant="caption" style={{ color: colors.night }}>
            Tap to view full screen
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles(({ colors }) => ({
  card: {
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.night,
  },
  top: { backgroundColor: colors.night, padding: space.lg, gap: space.md },
  logo: { alignItems: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  avatar: {
    width: CARD_AVATAR,
    height: CARD_AVATAR,
    borderRadius: radius.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The avatar's own circle is canvas too, so the square reads as one shape.
  avatarLook: { backgroundColor: colors.canvas },
  avatarInitials: { backgroundColor: colors.green },
  names: { flex: 1, gap: space.xs / 2, alignItems: 'flex-start' },
  levelPill: {
    marginTop: space.xs,
    backgroundColor: colors.greenSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs / 2,
  },
  band: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.night,
    borderTopWidth: hairline,
    borderTopColor: colors.onNightMuted,
  },
  detail: { width: '50%', paddingRight: space.sm, gap: space.xs / 2 },
  detailWide: { width: '100%' },
  bottom: {
    alignItems: 'center',
    gap: space.sm,
    padding: space.lg,
    backgroundColor: colors.onNight,
  },
}));
