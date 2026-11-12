// The match record in the app (docs/specs/match-record.md).
export { formResult, formSide, playerForm, teamForm } from './form';
export { formatKickoff, formatMatchDate, formatMatchWhen } from './format';
export type * from './types';
export { captainSideOf, otherSide, resultState, submittedScoreLine, toListItem, viewerRole } from './result';
export type { ResultMatch, ResultState, ViewerRole } from './result';
export { describeMatchResultError } from './result-errors';
