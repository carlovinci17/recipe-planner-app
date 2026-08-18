-- Neon schema prelude (Module 9) — makes the Supabase public-schema dump apply cleanly.
create extension if not exists citext;
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ADR-0002 bridge on Neon: policies call auth.uid(); there's no Supabase JWT here,
-- so resolve it from the same `app.user_id` GUC that withUserContext sets.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
