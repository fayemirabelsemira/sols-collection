-- =========================================================
-- Sol: every chapter read adds a view
--   Run in Supabase -> SQL Editor. One transaction. Safe to run again.
--
--   Before: one view per reader per BOOK.
--   Now:    one view per reader per CHAPTER (the site counts it after
--           1 second on the chapter). Re-opening the same chapter does
--           not count again, so refreshing can't inflate the number.
--   Logged-in readers are counted by account, guests by device
--   (same as sql/14: a determined person could fake device ids;
--   fine for a view counter, don't use it for rewards).
--   Opening a book's page still counts once per book (increment_views).
-- =========================================================

begin;

create table if not exists public.chapter_views (
  user_id    uuid not null,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, chapter_id));

create table if not exists public.chapter_views_guest (
  device_id  text not null check (char_length(device_id) between 16 and 64),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_id, chapter_id));

alter table public.chapter_views enable row level security;
alter table public.chapter_views_guest enable row level security;
revoke all on public.chapter_views, public.chapter_views_guest from anon, authenticated;

-- adds 1 to the book's views the first time this reader/device opens the chapter;
-- returns the book's view total either way
create or replace function public.increment_chapter_views(p_chapter_id uuid, p_device text default null)
returns bigint language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_book uuid;
  n int;
  v bigint;
begin
  select c.book_id into v_book
    from public.chapters c join public.books b on b.id = c.book_id
   where c.id = p_chapter_id and not coalesce(b.is_hidden, false);
  if v_book is null then
    raise exception 'Chapter not found';
  end if;

  if v_uid is not null then
    insert into public.chapter_views (user_id, chapter_id) values (v_uid, p_chapter_id)
      on conflict do nothing;
  else
    if p_device is null or char_length(p_device) not between 16 and 64 then
      raise exception 'Bad device id';
    end if;
    insert into public.chapter_views_guest (device_id, chapter_id) values (p_device, p_chapter_id)
      on conflict do nothing;
  end if;
  get diagnostics n = row_count;

  if n = 1 then
    update public.books set views = coalesce(views, 0) + 1 where id = v_book returning views into v;
  else
    select views into v from public.books where id = v_book;
  end if;
  return coalesce(v, 0);
end
$$;
revoke all on function public.increment_chapter_views(uuid, text) from public;
grant execute on function public.increment_chapter_views(uuid, text) to anon, authenticated;

do $$ begin
  raise notice 'Chapter views are on: each chapter read adds a view.';
end $$;

commit;
