-- ======================================================================
-- Research Studio — 日次原価集計 RPC (R-5 / C-5)
-- ======================================================================

create or replace function public.usage_cost_since(p_since timestamptz)
returns numeric language sql security definer
set search_path = public as $$
  select coalesce(sum(est_cost_jpy), 0) from public.usage_events where created_at >= p_since;
$$;

revoke execute on function public.usage_cost_since(timestamptz) from public, anon, authenticated;
grant execute on function public.usage_cost_since(timestamptz) to service_role;

