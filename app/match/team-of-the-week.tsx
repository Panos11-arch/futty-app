// Team of the Week lives in the Rankings tab (S15). This route stays so the
// Home card, the team_of_the_week notification and old links keep working:
// it opens Rankings → Team of the Week, on the team it names (teamId).
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function TeamOfTheWeekRedirect() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const id = Array.isArray(teamId) ? teamId[0] : teamId;
  return <Redirect href={id ? { pathname: '/rankings', params: { view: 'totw', teamId: id } } : { pathname: '/rankings', params: { view: 'totw' } }} />;
}
