-- =========================================================
-- Sol: app features
--   1. Story details  (status, 18+ / content warnings, schedule,
--                      chapter count, word count, last updated)
--   2. My Library     (+ "new chapters" badges)
--   3. Ratings & reviews
--
-- Run ONCE in Supabase -> SQL Editor (safe to run again).
-- The site keeps working before you run it; the new parts just
-- stay hidden until these tables/functions exist.
-- =========================================================


-- ---------------------------------------------------------
-- 1. STORY DETAILS
-- ---------------------------------------------------------
alter table public.books add column if not exists status text not null default 'ongoing';
alter table public.books add column if not exists is_mature boolean not null default false;
alter table public.books add column if not exists content_warnings text[] not null default '{}';
alter table public.books add column if not exists update_schedule text;

do $$ begin
  alter table public.books
    add constraint books_status_check check (status in ('ongoing', 'completed', 'hiatus'));
exception when duplicate_object then null; end $$;

-- When a chapter goes live, remember WHEN (drafts can be created long before).
alter table public.chapters add column if not exists published_at timestamptz;

update public.chapters
   set published_at = coalesce(created_at, now())
 where published_at is null
   and coalesce(status, 'published') = 'published';

create or replace function public.chapters_stamp_published()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.status, 'published') = 'published'
     and (tg_op = 'INSERT' or coalesce(old.status, 'published') <> 'published'
          or new.published_at is null) then
    new.published_at := coalesce(new.published_at, now());
  end if;
  if tg_op = 'UPDATE' and coalesce(new.status, 'published') <> 'published' then
    new.published_at := null;   -- unpublished again: next publish counts as new
  end if;
  return new;
end;
$$;

drop trigger if exists chapters_stamp_published on public.chapters;
create trigger chapters_stamp_published
  before insert or update of status on public.chapters
  for each row execute function public.chapters_stamp_published();

-- Writer Studio saves these (owner only).
create or replace function public.author_set_book_details(
  p_book_id   uuid,
  p_status    text,
  p_is_mature boolean,
  p_warnings  text[],
  p_schedule  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  if not exists (select 1 from public.books where id = p_book_id and owner_id = auth.uid()) then
    raise exception 'Unauthorized';
  end if;

  if p_status not in ('ongoing', 'completed', 'hiatus') then
    raise exception 'Invalid status';
  end if;

  update public.books
     set status           = p_status,
         is_mature        = coalesce(p_is_mature, false),
         content_warnings = coalesce((
           select array_agg(w)
             from (select left(btrim(x), 40) as w
                     from unnest(coalesce(p_warnings, '{}')) as x
                    where btrim(x) <> ''
                    limit 12) s
         ), '{}'),
         update_schedule  = nullif(left(btrim(coalesce(p_schedule, '')), 80), '')
   where id = p_book_id;
end;
$$;

revoke all on function public.author_set_book_details(uuid, text, boolean, text[], text) from public, anon;
grant execute on function public.author_set_book_details(uuid, text, boolean, text[], text) to authenticated;

-- Public numbers only (no chapter text leaves the database).
create or replace function public.get_book_stats()
returns table (book_id uuid, chapter_count int, word_count bigint, last_updated timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.book_id,
         count(*)::int,
         sum(coalesce(array_length(regexp_split_to_array(
               btrim(regexp_replace(coalesce(c.content, ''), '<[^>]*>|&nbsp;', ' ', 'g')),
               '\s+'), 1), 0))::bigint,
         max(coalesce(c.published_at, c.created_at))
    from public.chapters c
   where coalesce(c.status, 'published') = 'published'
   group by c.book_id;
$$;

grant execute on function public.get_book_stats() to anon, authenticated;


-- ---------------------------------------------------------
-- 2. MY LIBRARY
-- ---------------------------------------------------------
create table if not exists public.library (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id      uuid not null references public.books(id) on delete cascade,
  added_at     timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.library enable row level security;

drop policy if exists "library: read own"   on public.library;
drop policy if exists "library: add own"    on public.library;
drop policy if exists "library: update own" on public.library;
drop policy if exists "library: remove own" on public.library;

create policy "library: read own"   on public.library for select to authenticated using (user_id = auth.uid());
create policy "library: add own"    on public.library for insert to authenticated with check (user_id = auth.uid());
create policy "library: update own" on public.library for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "library: remove own" on public.library for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.library to authenticated;

-- How many chapters went live in each library book since the reader last opened it.
create or replace function public.get_library_updates()
returns table (book_id uuid, new_chapters int)
language sql
stable
security definer
set search_path = public
as $$
  select l.book_id, count(c.id)::int
    from public.library l
    join public.chapters c
      on c.book_id = l.book_id
     and coalesce(c.status, 'published') = 'published'
     and c.published_at > l.last_seen_at
   where l.user_id = auth.uid()
   group by l.book_id;
$$;

revoke all on function public.get_library_updates() from public, anon;
grant execute on function public.get_library_updates() to authenticated;


-- ---------------------------------------------------------
-- 3. RATINGS & REVIEWS
-- ---------------------------------------------------------
create table if not exists public.book_reviews (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.books(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Reader',
  rating       smallint not null check (rating between 1 and 5),
  body         text not null default '' check (char_length(body) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (book_id, user_id)
);

create index if not exists book_reviews_book_idx on public.book_reviews (book_id, created_at desc);

alter table public.book_reviews enable row level security;

drop policy if exists "reviews: anyone can read" on public.book_reviews;
drop policy if exists "reviews: delete own or book owner" on public.book_reviews;

create policy "reviews: anyone can read" on public.book_reviews
  for select to anon, authenticated using (true);

-- the writer of the book can remove abusive reviews
create policy "reviews: delete own or book owner" on public.book_reviews
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.books b where b.id = book_id and b.owner_id = auth.uid())
  );

revoke insert, update on public.book_reviews from anon, authenticated;
grant select on public.book_reviews to anon, authenticated;
grant delete on public.book_reviews to authenticated;

-- Writing goes through this function so the name can't be faked.
create or replace function public.upsert_review(p_book_id uuid, p_rating int, p_body text)
returns public.book_reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_row  public.book_reviews;
begin
  if v_uid is null then
    raise exception 'Login required';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be 1 to 5';
  end if;

  select left(nullif(btrim(coalesce(raw_user_meta_data ->> 'display_name', '')), ''), 60)
    into v_name
    from auth.users where id = v_uid;

  insert into public.book_reviews (book_id, user_id, display_name, rating, body)
  values (p_book_id, v_uid, coalesce(v_name, 'Reader'), p_rating, left(btrim(coalesce(p_body, '')), 2000))
  on conflict (book_id, user_id) do update
     set rating       = excluded.rating,
         body         = excluded.body,
         display_name = excluded.display_name,
         updated_at   = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_review(uuid, int, text) from public, anon;
grant execute on function public.upsert_review(uuid, int, text) to authenticated;

create or replace function public.get_rating_summary()
returns table (book_id uuid, avg_rating numeric, review_count int)
language sql
stable
security definer
set search_path = public
as $$
  select r.book_id, round(avg(r.rating)::numeric, 1), count(*)::int
    from public.book_reviews r
   group by r.book_id;
$$;

grant execute on function public.get_rating_summary() to anon, authenticated;
