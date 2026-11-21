-- Minimal stand-in for Supabase, for LOCAL tests only (tests/run-sql-tests.sh).
-- Same roles, same default grants, auth.uid() from a session setting.
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;
-- Supabase gives the browser roles everything on new public objects by default
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}', email_confirmed_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table public.books (
  id uuid primary key default gen_random_uuid(), owner_id uuid, title text not null,
  author text, genre text, description text, cover_url text,
  views bigint, votes bigint, price numeric default 150, total_chapters int default 0, created_at timestamptz default now());
create table public.chapters (
  id uuid primary key default gen_random_uuid(), book_id uuid references public.books(id) on delete cascade,
  chapter_number int not null, title text, content text, is_free boolean default false, price numeric default 0,
  status text default 'published', created_at timestamptz default now(), updated_at timestamptz default now());
create table public.purchases (id uuid primary key default gen_random_uuid(), user_id uuid, book_id uuid, chapter_id uuid,
  purchase_type text, payment_status text);
alter table public.books enable row level security;
alter table public.chapters enable row level security;
create policy "books readable" on public.books for select using (true);
-- deliberately the weak policy we are checking for: everyone may read every chapter row
create policy "chapters readable" on public.chapters for select using (true);

-- reader function: copied from the live project (CSV export, 15 Nov 2026)
CREATE OR REPLACE FUNCTION public.get_chapter_for_reader(p_chapter_id uuid)
 RETURNS TABLE(id uuid, book_id uuid, chapter_number integer, title text, content text, price numeric, is_free boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    c.id,
    c.book_id,
    c.chapter_number,
    c.title,
    c.content,
    c.price,
    c.is_free,
    c.created_at
  from public.chapters c
  where c.id = p_chapter_id
    and c.status = 'published'
    and (
      c.is_free = true
      or exists (
        select 1
        from public.purchases p
        where p.user_id = (select auth.uid())
          and p.payment_status = 'paid'
          and (
            p.chapter_id = c.id
            or (p.purchase_type = 'book' and p.book_id = c.book_id)
          )
      )
    );
$function$;

insert into auth.users values
  ('00000000-0000-4000-8000-0000000000aa', '{"display_name":"Mallory","avatar_color":"red;position:fixed;inset:0;z-index:99999;background:url(https://example.invalid/t.png)"}'),
  ('00000000-0000-4000-8000-0000000000bb', '{"display_name":"Reader B","avatar_color":"#e0274f"}'),
  ('00000000-0000-4000-8000-0000000000ee', '{"display_name":"Writer"}');
insert into public.books (id, owner_id, title) values
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000ee', 'Test Book');
insert into public.chapters (id, book_id, chapter_number, title, content, is_free) values
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000b001', 1, 'Free one', 'FREE TEXT', true),
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-00000000b001', 2, 'Paid one', 'PAID SECRET TEXT', false);
