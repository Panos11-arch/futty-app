-- S5 (venue page): a venue's phone and website, behind the page's Call and
-- Website buttons. The columns came with the venue import
-- (20261111164706_pay_venue_pages.sql) and venue_page already returns them;
-- this lets the venue's own staff set them from the dashboard.
--
-- set_venue_contact(p_venue_id, p_phone, p_website) returns
-- {phone, website} as saved. Blank or null clears a field. A phone is
-- 6 to 20 characters of digits, spaces, brackets and dashes, with an
-- optional leading +, and at least 6 digits (invalid_phone). A website is
-- an http or https address up to 200 characters; without a scheme it gets
-- https:// (invalid_website). Staff of that venue only (not_venue_staff).

create or replace function public.set_venue_contact(p_venue_id uuid, p_phone text, p_website text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(btrim(p_phone), '');
  v_website text := nullif(btrim(p_website), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_venue_staff(p_venue_id) then
    raise exception 'not_venue_staff';
  end if;

  if v_phone is not null
     and (v_phone !~ '^\+?[0-9 ()-]{6,20}$' or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6) then
    raise exception 'invalid_phone';
  end if;

  if v_website is not null then
    if v_website !~* '^[a-z][a-z0-9+.-]*:' then
      v_website := 'https://' || v_website;
    end if;
    if char_length(v_website) > 200
       or v_website !~* '^https?://[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]+)?(/[^[:space:]]*)?$' then
      raise exception 'invalid_website';
    end if;
  end if;

  update public.venues set phone = v_phone, website = v_website where id = p_venue_id;
  return jsonb_build_object('phone', v_phone, 'website', v_website);
end;
$$;

revoke all on function public.set_venue_contact(uuid, text, text) from public, anon;
grant execute on function public.set_venue_contact(uuid, text, text) to authenticated, service_role;
