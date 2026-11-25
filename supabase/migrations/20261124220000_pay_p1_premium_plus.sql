-- P1: two paid plans (decided by Panos, 22 November; spec 13 "Premium").
--   Basic (free), Premium (premium_monthly_v2, €4.99 a month) and Premium
--   Plus (premium_plus_monthly, €7.99 a month, in the same App Store
--   subscription group, ranked above Premium): everything in Premium, no ads
--   and unlimited lives in Futty Games.
--
-- 1. profiles.premium_tier: 'basic', 'premium' or 'premium_plus'. Players
--    can't write it (profiles has column-level grants and this column gets
--    none). is_premium stays true for both paid tiers, so every existing
--    Premium rule keeps working; a trigger keeps the two together whichever
--    one is set.
-- 2. apply_premium_subscription: the only way a purchase changes the tier.
--    Service role only: verify-purchase and apple-server-notifications call
--    it after Apple's own API confirms the subscription's current product
--    and state. The tier is the best active personal subscription on file.
-- 3. ads_allowed(profile): false only on Premium Plus (Premium does not
--    remove ads). G4 uses it. A player asks for themselves; the service role
--    for anyone.
-- 4. app_rules.premium_plus_price_label (€7.99): what the app shows while the
--    store's live price loads, and what the Futty AI says.

-- ---- 1. The tier -------------------------------------------------------------

alter table public.profiles
  add column premium_tier text not null default 'basic'
    check (premium_tier in ('basic', 'premium', 'premium_plus'));

update public.profiles set premium_tier = 'premium' where is_premium;

-- is_premium and premium_tier always agree. Setting the tier sets
-- is_premium; setting is_premium on its own (support tools, tests) gives
-- Premium, or Basic when switched off, and leaves Plus as Plus.
create or replace function public.profiles_sync_premium_tier()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.premium_tier is distinct from old.premium_tier then
    new.is_premium := new.premium_tier <> 'basic';
  elsif coalesce(new.is_premium, false) then
    if new.premium_tier = 'basic' then
      new.premium_tier := 'premium';
    end if;
  else
    new.premium_tier := 'basic';
    new.is_premium := false;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_premium_tier
  before insert or update of is_premium, premium_tier on public.profiles
  for each row execute function public.profiles_sync_premium_tier();

revoke all on function public.profiles_sync_premium_tier() from public, anon, authenticated;

-- ---- 2. Purchases --------------------------------------------------------------

-- Records what Apple says about one subscription (its current product and
-- whether it's active) and sets the player's tier from every personal
-- subscription on file: Premium Plus if one is active, else Premium, else
-- Basic. An upgrade or downgrade keeps the same original transaction with a
-- new product. Returns the tier.
create or replace function public.apply_premium_subscription(
  p_profile_id uuid,
  p_platform text,
  p_product_id text,
  p_original_transaction_id text,
  p_active boolean,
  p_expires_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_tier text;
begin
  if p_product_id is null or p_product_id not in ('premium_monthly_v2', 'premium_plus_monthly') then
    raise exception 'unknown_product';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'unknown_platform';
  end if;
  if p_profile_id is null or p_original_transaction_id is null or p_active is null then
    raise exception 'invalid_subscription';
  end if;

  select profile_id into v_owner from public.premium_subscriptions
  where platform = p_platform and original_transaction_id = p_original_transaction_id
  for update;
  if v_owner is not null and v_owner <> p_profile_id then
    raise exception 'subscription_belongs_to_another_player';
  end if;

  insert into public.premium_subscriptions (profile_id, platform, product_id, original_transaction_id, status, expires_at)
  values (p_profile_id, p_platform, p_product_id, p_original_transaction_id,
          case when p_active then 'active' else 'expired' end, p_expires_at)
  on conflict (platform, original_transaction_id) do update set
    product_id = excluded.product_id,
    status = excluded.status,
    expires_at = excluded.expires_at,
    updated_at = now();

  select case
           when bool_or(s.product_id = 'premium_plus_monthly') then 'premium_plus'
           when bool_or(s.product_id = 'premium_monthly_v2') then 'premium'
           else 'basic'
         end
  into v_tier
  from public.premium_subscriptions s
  where s.profile_id = p_profile_id and s.status = 'active';
  v_tier := coalesce(v_tier, 'basic');

  update public.profiles set premium_tier = v_tier where id = p_profile_id;
  return v_tier;
end;
$$;

revoke all on function public.apply_premium_subscription(uuid, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_premium_subscription(uuid, text, text, text, boolean, timestamptz) to service_role;

-- ---- 3. Ads --------------------------------------------------------------------

create or replace function public.ads_allowed(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    if auth.uid() is null then
      raise exception 'not_authenticated';
    end if;
    if p_profile_id is distinct from auth.uid() then
      raise exception 'not_allowed';
    end if;
  end if;
  return coalesce((select p.premium_tier <> 'premium_plus' from public.profiles p where p.id = p_profile_id), true);
end;
$$;

revoke all on function public.ads_allowed(uuid) from public, anon;
grant execute on function public.ads_allowed(uuid) to authenticated, service_role;

-- ---- 4. The rules --------------------------------------------------------------

alter table public.app_rules
  add column premium_plus_price_label text not null default '€7.99'
    check (length(premium_plus_price_label) between 1 and 20);
