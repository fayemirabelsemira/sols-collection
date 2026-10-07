-- =========================================================
-- Sol's Collection: server-side votes and views
-- Run in Supabase -> SQL Editor. Run this BEFORE deploying the new JS,
-- otherwise votes/views will fail until it exists.
--
-- ASSUMES books.id is a UUID. If it is bigint/int, change every
-- "uuid" below that refers to a book id to the same type.
-- =========================================================

-- 1. Real counters start at 0
alter table public.books alter column views set default 0;
alter table public.books alter column votes set default 0;

-- 2. One row per (reader, book): the unique key IS the dedupe
create table if not exists public.book_votes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists public.book_views (
  user_id    uuid not null references auth.users(id) on delete cascade,
  book_id    uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.book_votes enable row level security;
alter table public.book_views enable row level security;

-- Readers may only SEE their own vote. Nobody can insert directly;
-- only the functions below can write.
drop policy if exists "read own votes" on public.book_votes;
create policy "read own votes" on public.book_votes
  for select to authenticated using (user_id = auth.uid());

-- 3. Cast a vote (once per user per book)
create or replace function public.cast_vote(p_book_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted int;
  v_votes bigint;
begin
  if v_uid is null then
    raise exception 'Login required';
  end if;

  insert into public.book_votes (user_id, book_id)
  values (v_uid, p_book_id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.books set votes = coalesce(votes, 0) + 1
    where id = p_book_id
    returning votes into v_votes;
  else
    select votes into v_votes from public.books where id = p_book_id;
  end if;

  return jsonb_build_object('votes', coalesce(v_votes, 0), 'already_voted', v_inserted = 0);
end;
$$;

-- 4. Count a view (once per logged-in user per book)
create or replace function public.increment_views(p_book_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted int;
  v_views bigint;
begin
  if v_uid is null then
    raise exception 'Login required';
  end if;

  insert into public.book_views (user_id, book_id)
  values (v_uid, p_book_id)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.books set views = coalesce(views, 0) + 1
    where id = p_book_id
    returning views into v_views;
  else
    select views into v_views from public.books where id = p_book_id;
  end if;

  return coalesce(v_views, 0);
end;
$$;

revoke all on function public.cast_vote(uuid)       from public, anon;
revoke all on function public.increment_views(uuid) from public, anon;
grant execute on function public.cast_vote(uuid)       to authenticated;
grant execute on function public.increment_views(uuid) to authenticated;

-- 5. LOCK DOWN books: browsers can no longer edit it (price included).
--    Your Supabase dashboard / service role keeps working.
--    NOTE: if you ever edit books from an admin page on the site itself,
--    that page will stop saving. Tell me and we'll give it its own RPC.
revoke insert, update, delete on public.books from anon, authenticated;

-- 6. Wipe the fake numbers (2,000,001 views / 100,000 votes).
--    This sets both counters to the REAL totals from the new tables
--    (zero for now). Uncomment when you are ready.
-- update public.books b set
--   views = (select count(*) from public.book_views v where v.book_id = b.id),
--   votes = (select count(*) from public.book_votes v where v.book_id = b.id);
