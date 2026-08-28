-- Backs the Community screen's Contacts tab (item 9): given the phone
-- numbers read from the device's contact list, tells the client which ones
-- already have a Futty account, without ever exposing the full profiles
-- table or anyone's un-opted-in phone number back to the client. Run in the
-- Supabase dashboard: SQL Editor > New query > Run. Safe to re-run.
--
-- Matching is by the LAST 9 DIGITS of each number (digits only, country code
-- and formatting stripped) rather than an exact string match — a contact
-- saved as "99 12 34 56" and a profile saved as "+357 99123456" are the same
-- number but never equal as strings. 9 digits comfortably covers a Cyprus
-- mobile number without the country code; long enough elsewhere too that a
-- false match is very unlikely.
create or replace function public.match_contacts_by_phone(p_phone_numbers text[])
returns table (phone_number text, profile_id uuid, username text)
language sql
security definer
set search_path = ''
stable
as $$
  with contacts as (
    select
      raw,
      right(regexp_replace(raw, '\D', '', 'g'), 9) as digits
    from unnest(p_phone_numbers) as raw
  )
  select distinct on (contacts.raw)
    contacts.raw as phone_number,
    p.id as profile_id,
    p.username
  from contacts
  join public.profiles p
    on right(regexp_replace(p.phone, '\D', '', 'g'), 9) = contacts.digits
  where p.phone is not null
    and length(contacts.digits) = 9
    and p.id <> auth.uid()
  order by contacts.raw, p.username;
$$;

grant execute on function public.match_contacts_by_phone(text[]) to authenticated;
