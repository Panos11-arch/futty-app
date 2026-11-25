-- P1: two paid plans (decided by Panos, 22 November; spec 13 "Premium").
--   profiles.premium_tier is 'basic', 'premium' or 'premium_plus', set only
--   by apply_premium_subscription (service role: verify-purchase and
--   apple-server-notifications, after Apple confirms the subscription).
--   is_premium stays true for both paid tiers, so every Premium rule keeps
--   working. ads_allowed(profile) is false only on Premium Plus. The app
--   reads app_rules.premium_plus_price_label (€7.99) while the store loads.
begin;

create function tests.p1_apply(p_profile uuid, p_product text, p_original text, p_active boolean)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform tests.act_as_service_role();
  v := public.apply_premium_subscription(p_profile, 'ios', p_product, p_original, p_active,
                                         case when p_active then now() + interval '30 days' end);
  perform tests.act_as_postgres();
  return v;
end;
$$;

create function tests.p1_tier(p_profile uuid, out tier text, out is_premium boolean)
language sql
as $$ select premium_tier, is_premium from public.profiles where id = p_profile $$;

-- 1. A new player is Basic; existing Premium players were Premium.
do $$
declare
  v_player uuid := tests.create_user('p1-basic@futty.test');
  t record;
begin
  t := tests.p1_tier(v_player);
  assert (t.tier, t.is_premium) = ('basic'::text, false), format('a new player is Basic, got %s', t);
  assert (select count(*) from public.profiles where is_premium and premium_tier = 'basic') = 0,
    'nobody Premium is left on Basic';
  assert (select count(*) from public.profiles where not is_premium and premium_tier <> 'basic') = 0,
    'nobody Basic has a paid tier';
end $$;

-- 2. Verified purchases, upgrade, downgrade, expiry, refund.
do $$
declare
  v_player uuid := tests.create_user('p1-buyer@futty.test');
  v_other uuid := tests.create_user('p1-other@futty.test');
  t record;
begin
  -- Premium (premium_monthly_v2).
  assert tests.p1_apply(v_player, 'premium_monthly_v2', 'otx-p1', true) = 'premium', 'buys Premium';
  t := tests.p1_tier(v_player);
  assert (t.tier, t.is_premium) = ('premium'::text, true), format('Premium: is_premium true, got %s', t);
  assert (select (product_id, status) from public.premium_subscriptions where original_transaction_id = 'otx-p1')
         = ('premium_monthly_v2'::text, 'active'::text), 'the subscription is on file';

  -- Upgrade: the same subscription (same original transaction) now on Plus.
  assert tests.p1_apply(v_player, 'premium_plus_monthly', 'otx-p1', true) = 'premium_plus', 'upgrades to Plus';
  t := tests.p1_tier(v_player);
  assert (t.tier, t.is_premium) = ('premium_plus'::text, true), format('Plus: is_premium true, got %s', t);
  assert (select count(*) from public.premium_subscriptions where profile_id = v_player) = 1, 'still one subscription';

  -- Downgrade at renewal: back on Premium.
  assert tests.p1_apply(v_player, 'premium_monthly_v2', 'otx-p1', true) = 'premium', 'downgrades to Premium';
  assert (tests.p1_tier(v_player)).tier = 'premium', 'Premium again';

  -- Expiry: back to Basic.
  assert tests.p1_apply(v_player, 'premium_monthly_v2', 'otx-p1', false) = 'basic', 'expires';
  t := tests.p1_tier(v_player);
  assert (t.tier, t.is_premium) = ('basic'::text, false), format('expired: Basic, got %s', t);
  assert (select status from public.premium_subscriptions where original_transaction_id = 'otx-p1') = 'expired',
    'the subscription reads expired';

  -- Plus bought fresh, then refunded or revoked (Apple says inactive): Basic.
  assert tests.p1_apply(v_other, 'premium_plus_monthly', 'otx-p2', true) = 'premium_plus', 'buys Plus';
  assert tests.p1_apply(v_other, 'premium_plus_monthly', 'otx-p2', false) = 'basic', 'refunded';
  t := tests.p1_tier(v_other);
  assert (t.tier, t.is_premium) = ('basic'::text, false), format('refunded: Basic, got %s', t);

  -- Two subscriptions on file (an old expired one, a new active one): the best active counts.
  perform tests.p1_apply(v_other, 'premium_monthly_v2', 'otx-p3', true);
  assert (tests.p1_tier(v_other)).tier = 'premium', 'the active one counts, not the refunded Plus';

  -- An unknown product is refused, and nothing changes.
  perform tests.act_as_service_role();
  assert tests.error_of(format('select public.apply_premium_subscription(%L, ''ios'', ''team_premium_9aside'', ''otx-x'', true, null)',
                               v_player)) = 'unknown_product', 'only the two personal plans';
  assert tests.error_of(format('select public.apply_premium_subscription(%L, ''web'', ''premium_monthly_v2'', ''otx-y'', true, null)',
                               v_player)) is not null, 'an unknown platform is refused';
  -- The same subscription can't move to another player.
  assert tests.error_of(format('select public.apply_premium_subscription(%L, ''ios'', ''premium_monthly_v2'', ''otx-p1'', true, null)',
                               v_other)) = 'subscription_belongs_to_another_player', 'not someone else''s subscription';
  perform tests.act_as_postgres();
  assert (tests.p1_tier(v_player)).tier = 'basic', 'unchanged by the refused calls';
end $$;

-- 3. Never from the app: players can't call it or write the column.
do $$
declare
  v_player uuid := tests.create_user('p1-cheat@futty.test');
begin
  perform tests.act_as(v_player);
  assert tests.error_of(format('select public.apply_premium_subscription(%L, ''ios'', ''premium_plus_monthly'', ''otx-c'', true, null)',
                               v_player)) is not null, 'a player can''t grant themselves Plus';
  perform tests.error_of(format('update public.profiles set premium_tier = ''premium_plus'' where id = %L', v_player));
  perform tests.error_of(format('update public.profiles set is_premium = true where id = %L', v_player));
  perform tests.act_as_postgres();
  assert (tests.p1_tier(v_player)).tier = 'basic' and not (tests.p1_tier(v_player)).is_premium, 'still Basic';
  assert not has_function_privilege('authenticated', 'public.apply_premium_subscription(uuid, text, text, text, boolean, timestamptz)', 'execute'),
    'authenticated can''t execute it';
  assert not has_function_privilege('anon', 'public.apply_premium_subscription(uuid, text, text, text, boolean, timestamptz)', 'execute'),
    'anon can''t execute it';
  assert not has_column_privilege('authenticated', 'public.profiles', 'premium_tier', 'update'), 'no update grant on the column';
  assert not has_column_privilege('authenticated', 'public.profiles', 'premium_tier', 'insert'), 'no insert grant on the column';
end $$;

-- 4. is_premium and premium_tier stay together (support tools and tests set is_premium).
do $$
declare
  v_player uuid := tests.create_user('p1-sync@futty.test');
  t record;
begin
  perform tests.make_premium(v_player);
  t := tests.p1_tier(v_player);
  assert (t.tier, t.is_premium) = ('premium'::text, true), format('is_premium on: Premium, got %s', t);
  update public.profiles set is_premium = false where id = v_player;
  t := tests.p1_tier(v_player);
  assert (t.tier, t.is_premium) = ('basic'::text, false), format('is_premium off: Basic, got %s', t);
  update public.profiles set premium_tier = 'premium_plus' where id = v_player;
  t := tests.p1_tier(v_player);
  assert (t.tier, t.is_premium) = ('premium_plus'::text, true), format('Plus: is_premium on, got %s', t);
  -- Setting is_premium again on a Plus player keeps Plus.
  update public.profiles set is_premium = true where id = v_player;
  assert (tests.p1_tier(v_player)).tier = 'premium_plus', 'Plus stays Plus';
  assert tests.error_of(format('update public.profiles set premium_tier = ''gold'' where id = %L', v_player)) is not null,
    'an unknown tier is refused';
end $$;

-- 5. ads_allowed.
do $$
declare
  v_basic uuid := tests.create_user('p1-ads-basic@futty.test');
  v_premium uuid := tests.create_user('p1-ads-premium@futty.test');
  v_plus uuid := tests.create_user('p1-ads-plus@futty.test');
begin
  update public.profiles set premium_tier = 'premium' where id = v_premium;
  update public.profiles set premium_tier = 'premium_plus' where id = v_plus;

  perform tests.act_as(v_basic);
  assert public.ads_allowed(v_basic), 'Basic: ads';
  perform tests.act_as(v_premium);
  assert public.ads_allowed(v_premium), 'Premium does not remove ads';
  perform tests.act_as(v_plus);
  assert not public.ads_allowed(v_plus), 'Premium Plus: no ads';
  -- Only your own; the service role (G4's jobs) can ask for anyone.
  assert tests.error_of(format('select public.ads_allowed(%L)', v_basic)) = 'not_allowed', 'not someone else''s';
  perform tests.act_as_service_role();
  assert not public.ads_allowed(v_plus) and public.ads_allowed(v_basic), 'the service role asks for anyone';
  perform tests.act_as_anon();
  assert tests.error_of(format('select public.ads_allowed(%L)', v_basic)) is not null, 'signed out';
  perform tests.act_as_postgres();
end $$;

-- 6. The rules: Premium Plus's label, read by the app and the Futty AI.
do $$
begin
  assert (select (premium_price_label, premium_plus_price_label) from public.app_rules) = ('€4.99'::text, '€7.99'::text),
    'Premium €4.99, Premium Plus €7.99';
  assert tests.error_of('update public.app_rules set premium_plus_price_label = ''''') is not null, 'never blank';
end $$;

rollback;
