-- Fix database security policies (findings S1, S3 — change: fix-db-security-policies).
--
-- Trust model: the edge functions hold the service-role key; the anon
-- (publishable) key must have NO access to any brain data or privileged
-- function. This migration makes that model explicit at the privilege level
-- instead of relying on environment-era default grants, which differ between
-- Supabase releases (older projects grant DML on public tables to
-- anon/authenticated/service_role by default; newer images grant none of it,
-- not even to service_role).

-- ─── S1: people RLS policy applied to PUBLIC ───────────────────────────────
-- "Allow all for service role" (20260324000001_people.sql) was created without
-- a `to service_role` clause, so it applied to ALL roles and anon-key holders
-- had full CRUD on personal data wherever anon held table grants. Recreate it
-- in the canonical shape used by 20260322000004_enable_rls.sql.

drop policy "Allow all for service role" on public.people;

create policy "Service role full access on people"
  on public.people
  for all
  to service_role
  using (true)
  with check (true);

-- ─── Explicit table privileges: service_role only ──────────────────────────
-- Grant DML to service_role (required on newer images, harmless where it
-- already exists) and revoke it from anon/authenticated (defense in depth on
-- older environments where RLS was the only barrier).

grant select, insert, update, delete on all tables in schema public to service_role;
revoke select, insert, update, delete on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

-- ─── S3 (generalized): function EXECUTE is service_role only ────────────────
-- increment_usefulness is SECURITY DEFINER (bypasses RLS by design for the
-- service path), yet PostgreSQL grants EXECUTE to PUBLIC by default, letting
-- anon-key holders inflate usefulness scores. Lock down every public-schema
-- function the same way so no future RPC ships callable by anon.

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
