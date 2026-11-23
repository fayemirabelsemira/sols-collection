-- =========================================================
-- Sol: guests (not logged in) can comment on chapters
--   Run in Supabase -> SQL Editor. One transaction. Safe to run again.
--   Run sql/18 (comment GIFs) first.
--
--   A guest types a name and posts through post_guest_comment().
--   Their comment shows as "<name> · Guest".
--   Each comment must belong to a real account (comments.user_id ->
--   auth.users), and guests have none, so a guest comment leaves user_id
--   empty and keeps a hidden guest id (made from the device id the site
--   already keeps for guest views, sql/14) in comments.guest_id instead.
--   Extra limits, because guests have no account:
--     - no links in guest comments
--     - one guest comment per device every 30 seconds, 30 per day
--     - at most 20 guest comments per minute across the whole site
--     - names can't contain "author", "admin", "moderator" or "·"
--   A determined person can make new device ids, so these limits slow
--   spam down, they don't make it impossible. To remove every guest
--   comment from one device later, find its guest_id and:
--     delete from public.comments where guest_id = '<id>';
-- =========================================================

begin;

alter table public.comments add column if not exists is_guest boolean not null default false;
alter table public.comments add column if not exists guest_id uuid;
-- guests have no account; an empty user_id is allowed by the auth.users link
alter table public.comments alter column user_id drop not null;
create index if not exists comments_guest_recent_idx on public.comments (created_at) where is_guest;
create index if not exists comments_guest_id_idx on public.comments (guest_id, created_at) where guest_id is not null;

-- Runs after the other "before insert" triggers (they go in name order).
-- Only post_guest_comment() sets sol.guest_id, so only it can make a guest comment;
-- anyone else who sends is_guest or guest_id gets them cleared.
create or replace function public.comments_guest_finish() returns trigger language plpgsql as
$$
declare g text := nullif(current_setting('sol.guest_id', true), '');
begin
  if g is null then
    new.is_guest := false;
    new.guest_id := null;
  else
    new.is_guest := true;
    new.guest_id := g::uuid;
    new.user_id := null;
  end if;
  return new;
end
$$;
drop trigger if exists trg_comments_zz_guest on public.comments;
create trigger trg_comments_zz_guest before insert on public.comments
  for each row execute function public.comments_guest_finish();

create or replace function public.post_guest_comment(
  p_chapter_id uuid, p_device text, p_name text, p_body text,
  p_parent_id uuid default null, p_gif_id text default null)
returns public.comments language plpgsql security definer set search_path = public as
$$
declare
  v_book uuid;
  v_guest uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.comments;
begin
  if auth.uid() is not null then
    raise exception 'You are logged in, so post as yourself.';
  end if;
  if p_device is null or char_length(p_device) not between 16 and 64 then
    raise exception 'Bad device id';
  end if;
  if char_length(v_name) not between 2 and 24 then
    raise exception 'Pick a name between 2 and 24 characters.';
  end if;
  if v_name ~* '(author|admin|moderator)' or v_name ~ '[·<>]' then
    raise exception 'Please pick a different name.';
  end if;
  if v_body ~* '(https?:|www\.|\m[a-z0-9-]+\.(com|net|org|ph|io|co|me|ly|xyz|site|link|app|gg)\M)' then
    raise exception 'Links are not allowed in guest comments. Log in to share links.';
  end if;
  if p_gif_id is not null and p_gif_id !~ '^[A-Za-z0-9]{1,64}$' then
    raise exception 'Bad GIF';
  end if;

  select c.book_id into v_book
    from public.chapters c join public.books b on b.id = c.book_id
   where c.id = p_chapter_id and not coalesce(b.is_hidden, false);
  if v_book is null then
    raise exception 'Chapter not found';
  end if;
  if p_parent_id is not null and not exists (
      select 1 from public.comments p where p.id = p_parent_id and p.chapter_id = p_chapter_id::text) then
    raise exception 'That comment is gone.';
  end if;

  v_guest := md5('sol-guest:' || p_device)::uuid;

  if (select count(*) from public.comments where is_guest and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Lots of guests are commenting right now. Try again in a minute, or log in.';
  end if;
  if exists (select 1 from public.comments where guest_id = v_guest and created_at > now() - interval '30 seconds') then
    raise exception 'You are commenting too fast. Wait a few seconds.';
  end if;
  if (select count(*) from public.comments where guest_id = v_guest and created_at > now() - interval '1 day') >= 30 then
    raise exception 'That''s the guest limit for today. Log in to keep commenting.';
  end if;

  -- the login check in the comment triggers reads auth.uid(), so lend it the guest id
  -- for this one insert; trg_comments_zz_guest then moves it to guest_id and empties user_id
  perform set_config('request.jwt.claim.sub', v_guest::text, true);
  perform set_config('sol.guest_id', v_guest::text, true);
  insert into public.comments (book_id, chapter_id, parent_id, author_name, body, gif_id)
  values (v_book::text, p_chapter_id::text, p_parent_id, v_name || ' · Guest',
          case when v_body = '' and p_gif_id is not null then '[GIF]' else v_body end, p_gif_id)
  returning * into v_row;
  perform set_config('sol.guest_id', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- a trigger may have replaced the name or flag; put them back
  if v_row.author_name is distinct from v_name || ' · Guest' or not v_row.is_guest then
    update public.comments set author_name = v_name || ' · Guest', is_guest = true
     where id = v_row.id returning * into v_row;
  end if;
  return v_row;
end
$$;
revoke all on function public.post_guest_comment(uuid, text, text, text, uuid, text) from public;
grant execute on function public.post_guest_comment(uuid, text, text, text, uuid, text) to anon;

do $$ begin
  raise notice 'Guest comments are on.';
end $$;

commit;
