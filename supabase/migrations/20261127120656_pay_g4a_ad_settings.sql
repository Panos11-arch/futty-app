-- G4a: banner ads. One read for the app, for the signed-in player only:
--
--   ads_allowed  P1's ads_allowed(): false on Premium Plus, so the app shows
--                no banner at all; true on Basic and Premium.
--   under_age    A3's is_minor(): under 18 on today's Cyprus date. A player
--                with no date of birth yet counts as under age too, so
--                AdMob's under-age setting is never left off by mistake (the
--                app asks for the date of birth before anything else, A1).
--
-- The app never sends an age, a tier or a profile id: everything comes from
-- auth.uid(). No existing function is changed.

create or replace function public.my_ad_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_dob date;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  select p.date_of_birth into v_dob from public.profiles p where p.id = v_me;
  return jsonb_build_object(
    'ads_allowed', public.ads_allowed(v_me),
    'under_age', v_dob is null or public.is_minor_dob(v_dob)
  );
end;
$$;

revoke all on function public.my_ad_settings() from public, anon;
grant execute on function public.my_ad_settings() to authenticated, service_role;
