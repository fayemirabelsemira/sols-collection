-- =========================================================
-- Sol: Discussion board
--   Threads (about a story, or "General"), replies, likes.
--   Anyone can read; logged-in readers can post.
--   The writer (anyone who owns a book) can pin or remove posts.
--
-- Run ONCE in Supabase -> SQL Editor (safe to run again).
-- Stands on its own; the site hides Discussion until it exists.
-- =========================================================

create table if not exists public.discussion_threads (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid references public.books(id) on delete cascade,   -- null = General
  user_id          uuid not null references auth.users(id) on delete cascade,
  display_name     text not null default 'Reader',
  avatar_color     text,
  title            text not null check (char_length(title) between 3 and 140),
  body             text not null default '' check (char_length(body) <= 4000),
  is_spoiler       boolean not null default false,
  pinned           boolean not null default false,
  reply_count      int not null default 0,
  like_count       int not null default 0,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create index if not exists discussion_threads_activity_idx on public.discussion_threads (pinned desc, last_activity_at desc);
create index if not exists discussion_threads_book_idx on public.discussion_threads (book_id, last_activity_at desc);

create table if not exists public.discussion_replies (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references public.discussion_threads(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Reader',
  avatar_color text,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);

create index if not exists discussion_replies_thread_idx on public.discussion_replies (thread_id, created_at);

create table if not exists public.discussion_likes (
  thread_id  uuid not null references public.discussion_threads(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table public.discussion_threads enable row level security;
alter table public.discussion_replies enable row level security;
alter table public.discussion_likes   enable row level security;

-- the writer = owns at least one book
create or replace function public.is_sol_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.books where owner_id = auth.uid());
$$;
grant execute on function public.is_sol_writer() to anon, authenticated;

drop policy if exists "threads: anyone can read" on public.discussion_threads;
drop policy if exists "threads: delete own or writer" on public.discussion_threads;
drop policy if exists "replies: anyone can read" on public.discussion_replies;
drop policy if exists "replies: delete own or writer" on public.discussion_replies;
drop policy if exists "likes: read own" on public.discussion_likes;

create policy "threads: anyone can read" on public.discussion_threads
  for select to anon, authenticated using (true);
create policy "threads: delete own or writer" on public.discussion_threads
  for delete to authenticated using (user_id = auth.uid() or public.is_sol_writer());

create policy "replies: anyone can read" on public.discussion_replies
  for select to anon, authenticated using (true);
create policy "replies: delete own or writer" on public.discussion_replies
  for delete to authenticated using (user_id = auth.uid() or public.is_sol_writer());

create policy "likes: read own" on public.discussion_likes
  for select to authenticated using (user_id = auth.uid());

-- all writes go through the functions below
revoke insert, update on public.discussion_threads from anon, authenticated;
revoke insert, update on public.discussion_replies from anon, authenticated;
revoke insert, update, delete on public.discussion_likes from anon, authenticated;
grant select on public.discussion_threads, public.discussion_replies to anon, authenticated;
grant delete on public.discussion_threads, public.discussion_replies to authenticated;
grant select on public.discussion_likes to authenticated;

-- keep reply_count / last_activity_at right, even when replies are deleted
create or replace function public.discussion_replies_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.discussion_threads
       set reply_count = reply_count + 1, last_activity_at = now()
     where id = new.thread_id;
  elsif tg_op = 'DELETE' then
    update public.discussion_threads
       set reply_count = greatest(reply_count - 1, 0)
     where id = old.thread_id;
  end if;
  return null;
end;
$$;

drop trigger if exists discussion_replies_count on public.discussion_replies;
create trigger discussion_replies_count
  after insert or delete on public.discussion_replies
  for each row execute function public.discussion_replies_count();

-- name + avatar colour come from the account, so nobody can post as someone else
create or replace function public.discussion_author(out v_name text, out v_color text)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(left(nullif(btrim(coalesce(raw_user_meta_data ->> 'display_name', '')), ''), 60), 'Reader'),
         nullif(raw_user_meta_data ->> 'avatar_color', '')
    from auth.users where id = auth.uid();
$$;
revoke all on function public.discussion_author() from public, anon, authenticated;

create or replace function public.create_thread(p_book_id uuid, p_title text, p_body text, p_spoiler boolean)
returns public.discussion_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a     record;
  v_row public.discussion_threads;
begin
  if v_uid is null then raise exception 'Login required'; end if;
  if (select count(*) from public.discussion_threads
       where user_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You''re posting a lot. Try again in a little while.';
  end if;
  select * into a from public.discussion_author();
  insert into public.discussion_threads (book_id, user_id, display_name, avatar_color, title, body, is_spoiler)
  values (p_book_id, v_uid, a.v_name, a.v_color,
          left(btrim(coalesce(p_title, '')), 140), left(btrim(coalesce(p_body, '')), 4000), coalesce(p_spoiler, false))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.add_reply(p_thread_id uuid, p_body text)
returns public.discussion_replies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a     record;
  v_row public.discussion_replies;
begin
  if v_uid is null then raise exception 'Login required'; end if;
  if (select count(*) from public.discussion_replies
       where user_id = v_uid and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'Slow down a little, then try again.';
  end if;
  select * into a from public.discussion_author();
  insert into public.discussion_replies (thread_id, user_id, display_name, avatar_color, body)
  values (p_thread_id, v_uid, a.v_name, a.v_color, left(btrim(coalesce(p_body, '')), 2000))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.toggle_thread_like(p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_liked boolean;
  v_count int;
begin
  if v_uid is null then raise exception 'Login required'; end if;
  delete from public.discussion_likes where thread_id = p_thread_id and user_id = v_uid;
  if found then
    v_liked := false;
    update public.discussion_threads set like_count = greatest(like_count - 1, 0)
     where id = p_thread_id returning like_count into v_count;
  else
    insert into public.discussion_likes (thread_id, user_id) values (p_thread_id, v_uid);
    v_liked := true;
    update public.discussion_threads set like_count = like_count + 1
     where id = p_thread_id returning like_count into v_count;
  end if;
  return jsonb_build_object('liked', v_liked, 'like_count', coalesce(v_count, 0));
end;
$$;

create or replace function public.set_thread_pinned(p_thread_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_sol_writer() then raise exception 'Unauthorized'; end if;
  update public.discussion_threads set pinned = coalesce(p_pinned, false) where id = p_thread_id;
end;
$$;

revoke all on function public.create_thread(uuid, text, text, boolean) from public, anon;
revoke all on function public.add_reply(uuid, text) from public, anon;
revoke all on function public.toggle_thread_like(uuid) from public, anon;
revoke all on function public.set_thread_pinned(uuid, boolean) from public, anon;
grant execute on function public.create_thread(uuid, text, text, boolean) to authenticated;
grant execute on function public.add_reply(uuid, text) to authenticated;
grant execute on function public.toggle_thread_like(uuid) to authenticated;
grant execute on function public.set_thread_pinned(uuid, boolean) to authenticated;
