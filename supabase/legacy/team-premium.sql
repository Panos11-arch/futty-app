-- Team Premium: gates 9-a-side and 11-a-side league registration, per team.
-- Run in the Supabase dashboard: SQL Editor > New query > Run. Safe to
-- re-run.
--
-- Two fixed boolean columns rather than a separate table: the prototype only
-- ever gates these two formats (PREMIUM_FORMATS), so there is no third value
-- to plan for.
--
-- Real billing now exists — see supabase/legacy/team-premium-payments.sql, which
-- revokes client execute on set_team_premium below and hands writes to
-- these columns exclusively to the verify-team-purchase and
-- apple-server-notifications Edge Functions. Run that file too; it depends
-- on this one having run first.

alter table public.teams add column if not exists premium_9aside boolean not null default false;
alter table public.teams add column if not exists premium_11aside boolean not null default false;

-- No new RLS policy needed for reads — teams already has a broad authenticated
-- select policy. Writing is captain-only, enforced by this function rather
-- than a table policy (teams has no update policy at all otherwise).
create or replace function public.set_team_premium(p_team_id uuid, p_format text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and profile_id = auth.uid() and role = 'captain'
  ) then
    raise exception 'not_captain';
  end if;

  if p_format = '9-a-side' then
    update public.teams set premium_9aside = p_enabled where id = p_team_id;
  elsif p_format = '11-a-side' then
    update public.teams set premium_11aside = p_enabled where id = p_team_id;
  else
    raise exception 'not_a_premium_format';
  end if;
end;
$$;

grant execute on function public.set_team_premium(uuid, text, boolean) to authenticated;
