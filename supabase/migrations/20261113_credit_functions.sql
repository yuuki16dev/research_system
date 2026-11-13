-- ======================================================================
-- Research Studio — 原子的クレジット確保・返却 RPC (R-3 / C-4)
-- ======================================================================

create or replace function public.consume_credits(
  p_user uuid, p_ym text, p_cost int, p_limit int
) returns boolean language plpgsql security definer
set search_path = public as $$
begin
  insert into public.research_usage (user_id, year_month, used_count)
  values (p_user, p_ym, 0)
  on conflict (user_id, year_month) do nothing;

  update public.research_usage
     set used_count = used_count + p_cost,
         updated_at = timezone('utc'::text, now())
   where user_id = p_user and year_month = p_ym
     and used_count + p_cost <= p_limit;
  return found;
end $$;

create or replace function public.refund_credits(
  p_user uuid, p_ym text, p_cost int
) returns void language plpgsql security definer
set search_path = public as $$
begin
  update public.research_usage
     set used_count = greatest(0, used_count - p_cost),
         updated_at = timezone('utc'::text, now())
   where user_id = p_user and year_month = p_ym;
end $$;

revoke execute on function public.consume_credits(uuid, text, int, int) from public, anon, authenticated;
revoke execute on function public.refund_credits(uuid, text, int) from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, text, int, int) to service_role;
grant execute on function public.refund_credits(uuid, text, int) to service_role;

