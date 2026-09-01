-- Restores Supabase's default posture (broad grants, RLS-only gating).
grant all on table shops, parts, inventory, transactions to anon, authenticated;
grant execute on function public.consume_stock(uuid, uuid, int) to public;
grant execute on function public.expire_stale_reservations() to public;
