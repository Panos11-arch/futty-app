-- Run this in the Supabase dashboard: SQL Editor > New query > Run.
-- Safe to re-run.

-- Personal-details fields for the Edit Profile screen (prototype's
-- editProfile form). Plain text, no enum constraints — same convention as
-- teams.city in teams.sql. The existing "Users can update their own profile"
-- policy in schema.sql already covers these (it's not column-scoped), so no
-- RLS changes are needed here.
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists date_of_birth date;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists position text;
alter table public.profiles add column if not exists preferred_foot text;

-- Opt-in flag for showing this player's phone number in the Community
-- directory (list_players in community.sql). Off by default — a phone number
-- set here is otherwise private, same as email.
alter table public.profiles add column if not exists show_phone_publicly boolean not null default false;
