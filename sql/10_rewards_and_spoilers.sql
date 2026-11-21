-- =========================================================
-- Sol: chapter rewards + spoiler-safe comments
--   Run in Supabase -> SQL Editor AFTER sql/07 (and sql/08).
--   Safe to run again. One transaction: on any error nothing changes.
--
--   1. REWARDS: readers earn a free paid chapter of a book by
--      commenting on that book and sharing it.
--        - 1 free chapter = 20 comments + 5 shares on that book
--        - a comment counts if it has at least 15 characters;
--          at most 5 comments count per day (Philippine time)
--        - a share counts once per book per day
--        - deleting a comment removes its point
--      Change the numbers any time:
--        update public.reward_settings set comments_needed = 20,
--          shares_needed = 5, min_comment_chars = 15,
--          max_comments_per_day = 5, enabled = true where id = 1;
--      A claimed chapter is stored as a paid purchase with amount 0
--      and purchase_type 'reward', so it opens like a bought chapter.
--
--   2. SPOILER-SAFE: every new comment, discussion post and reply
--      remembers which chapter its writer had reached. The site
--      hides it behind "tap to show" for readers who are behind.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1. Rewards
-- ---------------------------------------------------------
create table if not exists public.reward_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  comments_needed int not null default 20 check (comments_needed between 1 and 1000),
  shares_needed int not null default 5 check (shares_needed between 0 and 1000),
  min_comment_chars int not null default 15 check (min_comment_chars between 1 and 1000),
  max_comments_per_day int not null default 5 check (max_comments_per_day between 1 and 1000)
);
insert into public.reward_settings (id) values (1) on conflict do nothing;
alter table public.reward_settings enable row level security;
revoke all on public.reward_settings from anon, authenticated;

create table if not exists public.reward_shares (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  day date not null default ((now() at time zone 'Asia/Manila')::date),
  created_at timestamptz not null default now(),
  primary key (user_id, book_id, day)
);
alter table public.reward_shares enable row level security;
revoke all on public.reward_shares from anon, authenticated;

create index if not exists comments_user_book_idx on public.comments (user_id, book_id, created_at);

-- counts for one reader and one book
create or replace function public.reward_status(p_book_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  s public.reward_settings;
  uid uuid := auth.uid();
  n_comments int := 0; n_shares int := 0; n_used int := 0; n_earned int := 0;
begin
  select * into s from public.reward_settings where id = 1;
  if uid is null or s is null then
    return jsonb_build_object('signed_in', uid is not null, 'enabled', coalesce(s.enabled, false));
  end if;

  select count(*) into n_comments from (
    select row_number() over (partition by (c.created_at at time zone 'Asia/Manila')::date order by c.created_at) as rn
      from public.comments c
     where c.user_id = uid and c.book_id = p_book_id::text
       and char_length(btrim(c.body)) >= s.min_comment_chars
  ) x where x.rn <= s.max_comments_per_day;

  select count(*) into n_shares from public.reward_shares where user_id = uid and book_id = p_book_id;
  select count(*) into n_used from public.purchases
   where user_id = uid and book_id = p_book_id and purchase_type = 'reward' and payment_status = 'paid';

  n_earned := least(n_comments / s.comments_needed,
                    case when s.shares_needed = 0 then n_comments / s.comments_needed else n_shares / s.shares_needed end);

  return jsonb_build_object(
    'signed_in', true,
    'enabled', s.enabled,
    'comments', n_comments,
    'shares', n_shares,
    'comments_needed', s.comments_needed,
    'shares_needed', s.shares_needed,
    'min_comment_chars', s.min_comment_chars,
    'max_comments_per_day', s.max_comments_per_day,
    'earned', n_earned,
    'used', n_used,
    'available', greatest(n_earned - n_used, 0),
    -- progress toward the next free chapter
    'next_comments', least(s.comments_needed, n_comments - n_earned * s.comments_needed),
    'next_shares', least(s.shares_needed, n_shares - n_earned * s.shares_needed),
    'shared_today', exists (select 1 from public.reward_shares
                             where user_id = uid and book_id = p_book_id
                               and day = (now() at time zone 'Asia/Manila')::date)
  );
end
$$;
revoke all on function public.reward_status(uuid) from public, anon;
grant execute on function public.reward_status(uuid) to authenticated;

-- called by the site after a share went through (once per book per day counts)
create or replace function public.record_share(p_book_id uuid)
returns jsonb language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null then raise exception 'Log in to earn rewards'; end if;
  if not exists (select 1 from public.books where id = p_book_id and not coalesce(is_hidden, false)) then
    raise exception 'Book not found';
  end if;
  insert into public.reward_shares (user_id, book_id) values (auth.uid(), p_book_id)
    on conflict do nothing;
  return public.reward_status(p_book_id);
end
$$;
revoke all on function public.record_share(uuid) from public, anon;
grant execute on function public.record_share(uuid) to authenticated;

-- spend one earned reward on one paid chapter
create or replace function public.claim_reward_chapter(p_chapter_id uuid)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  ch record;
  st jsonb;
begin
  if uid is null then raise exception 'Log in to use a reward'; end if;
  -- one claim at a time per reader (no double spending)
  perform pg_advisory_xact_lock(hashtext('sol-reward:' || uid::text));

  select c.id, c.book_id, c.is_free, c.status into ch from public.chapters c where c.id = p_chapter_id;
  if ch.id is null or ch.status <> 'published' then raise exception 'Chapter not found'; end if;
  if ch.is_free then raise exception 'This chapter is already free'; end if;
  if not coalesce((select enabled from public.reward_settings where id = 1), false) then
    raise exception 'Rewards are switched off right now';
  end if;
  if exists (select 1 from public.purchases p
              where p.user_id = uid and p.payment_status = 'paid'
                and (p.chapter_id = ch.id or (p.purchase_type = 'book' and p.book_id = ch.book_id))) then
    raise exception 'You already unlocked this chapter';
  end if;

  st := public.reward_status(ch.book_id);
  if coalesce((st ->> 'available')::int, 0) < 1 then
    raise exception 'No free chapter earned yet';
  end if;

  insert into public.purchases (user_id, chapter_id, book_id, amount, payment_status, payment_reference, purchase_type)
  values (uid, ch.id, ch.book_id, 0, 'paid', 'reward', 'reward')
  on conflict (user_id, chapter_id) do update
     set payment_status = 'paid', amount = 0, payment_reference = 'reward', purchase_type = 'reward',
         book_id = excluded.book_id, purchased_at = now()
   where public.purchases.payment_status is distinct from 'paid';

  return public.reward_status(ch.book_id);
end
$$;
revoke all on function public.claim_reward_chapter(uuid) from public, anon;
grant execute on function public.claim_reward_chapter(uuid) to authenticated;


-- ---------------------------------------------------------
-- 2. Spoiler-safe: remember how far the writer had read
-- ---------------------------------------------------------
alter table public.comments           add column if not exists reader_chapter int;
alter table public.discussion_threads add column if not exists reader_chapter int;
alter table public.discussion_replies add column if not exists reader_chapter int;

-- furthest chapter this reader has opened in a book (reading progress)
create or replace function public.sol_reader_chapter(p_user uuid, p_book uuid)
returns int language sql stable security definer set search_path = public as
$$ select max(rp.chapter_number) from public.reading_progress rp where rp.user_id = p_user and rp.book_id = p_book $$;
revoke all on function public.sol_reader_chapter(uuid, uuid) from public, anon, authenticated;

create or replace function public.sol_stamp_reader_chapter()
returns trigger language plpgsql security definer set search_path = public as
$$
declare b uuid; here int;
begin
  if tg_table_name = 'comments' then
    begin b := new.book_id::uuid; exception when others then return new; end;
    -- never lower than the chapter the comment is posted on
    select c.chapter_number into here from public.chapters c where c.id::text = new.chapter_id;
    new.reader_chapter := greatest(public.sol_reader_chapter(new.user_id, b), here);
  elsif tg_table_name = 'discussion_threads' then
    if new.book_id is not null then new.reader_chapter := public.sol_reader_chapter(new.user_id, new.book_id); end if;
  elsif tg_table_name = 'discussion_replies' then
    select t.book_id into b from public.discussion_threads t where t.id = new.thread_id;
    if b is not null then new.reader_chapter := public.sol_reader_chapter(new.user_id, b); end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_comments_spoiler_stamp on public.comments;
create trigger trg_comments_spoiler_stamp before insert on public.comments
  for each row execute function public.sol_stamp_reader_chapter();
drop trigger if exists trg_threads_spoiler_stamp on public.discussion_threads;
create trigger trg_threads_spoiler_stamp before insert on public.discussion_threads
  for each row execute function public.sol_stamp_reader_chapter();
drop trigger if exists trg_replies_spoiler_stamp on public.discussion_replies;
create trigger trg_replies_spoiler_stamp before insert on public.discussion_replies
  for each row execute function public.sol_stamp_reader_chapter();

do $$ begin
  raise notice 'Rewards and spoiler-safe comments are on.';
end $$;

commit;
