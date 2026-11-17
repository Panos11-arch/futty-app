// A6 share cards (docs/specs/05-product.md section 6, cut down for launch):
// the result card and the man-of-the-match card, each a react-native-svg
// <Svg> at Instagram story proportions. The canvas is 360 x 640, a third of
// 1080 x 1920, so the type tokens apply at their own sizes; the export
// (lib/match/share-export.ts) renders it at 1080 x 1920. Every word comes
// from get_match_page through shareCardData, unchanged. The Futty wordmark
// is in ink, like the sign-in wordmark (spec 15: brand is for buttons and
// selected states only). No "Book on Futty" QR yet: there is no public link
// to put in it.
import type { ReactNode, Ref } from 'react';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { colors, space, type } from '@/constants/futty-theme';
import type { ShareCardData } from '@/lib/match/share-card';

/** The canvas, in card units: a third of the 1080 x 1920 PNG. */
export const CARD = { width: 360, height: 640 } as const;
const MID = CARD.width / 2;
const EDGE = space.xl;
/** The score is drawn at twice the display size. */
const SCORE = { ...type.display, fontSize: type.display.fontSize * 2, lineHeight: type.display.lineHeight * 2 };

type Font = { fontSize: number; lineHeight: number; fontFamily: string };

type LineProps = {
  y: number;
  font: Font;
  fill?: string;
  x?: number;
  anchor?: 'start' | 'middle' | 'end';
  testID?: string;
  children: string;
};

/** One line of text; y is its baseline. */
function Line({ y, font, fill = colors.ink, x = MID, anchor = 'middle', testID, children }: LineProps) {
  return (
    <SvgText
      testID={testID}
      x={x}
      y={y}
      fill={fill}
      fontSize={font.fontSize}
      fontFamily={font.fontFamily}
      textAnchor={anchor}>
      {children}
    </SvgText>
  );
}

export type ShareCardProps = {
  data: ShareCardData;
  /** On-screen width; the height follows the story shape. */
  width: number;
  ref?: Ref<Svg>;
};

/** The white card with the wordmark at the top and the date and venue under it. */
function Canvas({ data, width, ref, testID, children }: ShareCardProps & { testID: string; children: ReactNode }) {
  const top = EDGE + type.display.lineHeight;
  return (
    <Svg
      ref={ref}
      testID={testID}
      width={width}
      height={(width * CARD.height) / CARD.width}
      viewBox={`0 0 ${CARD.width} ${CARD.height}`}>
      <Rect x={0} y={0} width={CARD.width} height={CARD.height} fill={colors.surface} />
      <Line y={top} font={type.display} testID="card-wordmark">
        Futty
      </Line>
      <Line y={top + type.callout.lineHeight + space.sm} font={type.callout} fill={colors.inkMuted} testID="card-when">
        {[data.date, data.venue].filter(Boolean).join(' · ')}
      </Line>
      {children}
    </Svg>
  );
}

/** Where the scorers may go: below side b's name, above the man of the match. */
const SCORERS_TOP = 400;
const SCORERS_BOTTOM = 560;

/** Each side's scorers in a column, in the server's order; lines tighten when there are many. */
function Scorers({ data }: { data: ShareCardData }) {
  const most = Math.max(data.a.scorers.length, data.b.scorers.length);
  if (most === 0) return null;
  const step = Math.min(type.callout.lineHeight, (SCORERS_BOTTOM - SCORERS_TOP) / most);
  const font = { ...type.callout, fontSize: Math.min(type.callout.fontSize, step) };
  const column = (names: string[], x: number, anchor: 'start' | 'end', side: string) =>
    names.map((name, i) => (
      <Line key={`${side}${i}`} y={SCORERS_TOP + step * (i + 1)} x={x} anchor={anchor} font={font} testID={`card-scorer-${side}`}>
        {name}
      </Line>
    ));
  return (
    <>
      <Line y={SCORERS_TOP - space.xs} font={type.caption} fill={colors.inkMuted}>
        Scorers
      </Line>
      {column(data.a.scorers, EDGE, 'start', 'a')}
      {column(data.b.scorers, CARD.width - EDGE, 'end', 'b')}
    </>
  );
}

/** Result card: score, both sides, scorers, man of the match once decided, venue and date. */
export function ResultCard(props: ShareCardProps) {
  const { data } = props;
  const labelA = 200;
  const scoreY = labelA + space.xl + SCORE.lineHeight;
  const labelB = scoreY + space.lg + type.title.lineHeight;
  const motmY = CARD.height - EDGE - type.headline.lineHeight;
  return (
    <Canvas {...props} testID="result-card">
      <Line y={labelA} font={type.title} testID="card-side-a">
        {data.a.label}
      </Line>
      <Line y={scoreY} font={SCORE} testID="card-score">
        {`${data.a.score}–${data.b.score}`}
      </Line>
      <Line y={labelB} font={type.title} testID="card-side-b">
        {data.b.label}
      </Line>
      <Scorers data={data} />
      {data.motm.length > 0 ? (
        <>
          <Line y={motmY} font={type.caption} fill={colors.inkMuted}>
            Man of the match
          </Line>
          <Line y={motmY + type.headline.lineHeight} font={type.headline} testID="card-motm">
            {data.motm.join(', ')}
          </Line>
        </>
      ) : null}
    </Canvas>
  );
}

/** Man-of-the-match card: the winner or every tied winner, the match, venue and date. */
export function MotmCard(props: ShareCardProps) {
  const { data } = props;
  const heading = 220;
  const first = heading + space.xl + type.display.lineHeight;
  const after = first + type.display.lineHeight * (data.motm.length - 1);
  return (
    <Canvas {...props} testID="motm-card">
      <Line y={heading} font={type.headline} fill={colors.inkMuted}>
        Man of the match
      </Line>
      {data.motm.map((name, i) => (
        <Line key={i} y={first + type.display.lineHeight * i} font={type.display} testID="card-motm">
          {name}
        </Line>
      ))}
      <Line y={after + space.xxl + type.headline.lineHeight} font={type.headline} testID="card-match">
        {`${data.a.label} ${data.a.score}–${data.b.score} ${data.b.label}`}
      </Line>
    </Canvas>
  );
}
