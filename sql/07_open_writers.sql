-- =========================================================
-- Sol: open writing to every reader (free books only)
--   Run in Supabase -> SQL Editor AFTER sql/06.
--   Safe to run again. The whole file is one transaction:
--   if any step fails, nothing is changed.
--
--   What it does
--   1. Sol admins = app_admins + whoever owns a book today (you).
--      Only admins can sell chapters; other writers' books are free.
--   2. is_book_author / is_site_admin rewritten to the strict
--      meaning (owner of THIS book / admin).
--   3. Safety check: stops if a Writer Studio function doesn't
--      check who owns the book.
--   4. Any signed-in reader with a confirmed email can write.
--   5. Table guards on books and chapters: only the owner (or an
--      admin) can change or delete them, prices are forced to 0
--      for non-admins, and there are daily limits.
--   6. Hide books, block writers, reader reports (admin only).
--      Chapters of hidden books can't be opened by link either.
--   7. Discussion moderators = admins only (not every book owner).
--
--   Undo writing for everyone (keeps everything else):
--     create or replace function public.author_can_write() returns boolean
--       language sql stable security definer set search_path = public
--       as $$ select public.sol_is_admin() $$;
-- =========================================================


begin;

-- ---------------------------------------------------------
-- 1. Admins (can sell, moderate, hide books)
--    = your existing app_admins list, plus everyone who owns a
--    book before writing opens (that is you).
-- ---------------------------------------------------------
create table if not exists public.app_admins (user_id uuid primary key);
create table if not exists public.sol_admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table public.sol_admins enable row level security;
revoke all on public.sol_admins from anon, authenticated;
insert into public.sol_admins (user_id)
  select distinct owner_id from public.books where owner_id is not null
  on conflict do nothing;

create or replace function public.sol_is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select auth.uid() is not null
      and (exists (select 1 from public.sol_admins where user_id = auth.uid())
        or exists (select 1 from public.app_admins where user_id = auth.uid())) $$;
revoke all on function public.sol_is_admin() from public;
grant execute on function public.sol_is_admin() to anon, authenticated;


-- ---------------------------------------------------------
-- 2. Strict ownership helpers
--    Your Writer Studio functions check is_book_author(book) and
--    list books with is_site_admin(). Their code isn't known, and
--    if either meant "owns any book", every new writer would get
--    into every book. They are rewritten to the strict meaning,
--    keeping their names and inputs so nothing else changes.
-- ---------------------------------------------------------
do $$
declare f record; arg text;
begin
  select p.oid, p.proargnames, pg_get_function_result(p.oid) as res into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_book_author'
     and pg_get_function_identity_arguments(p.oid) ~ '^(\w+ )?uuid$';
  if f.oid is not null and f.res <> 'boolean' then
    raise exception 'STOPPED, nothing changed. is_book_author returns %, expected boolean', f.res;
  end if;
  arg := coalesce(nullif(f.proargnames[1], ''), 'p_book_id');
  execute format($f$
    create or replace function public.is_book_author(%I uuid)
    returns boolean language sql stable security definer set search_path = public as
    $b$ select public.sol_is_admin()
           or exists (select 1 from public.books b where b.id = $1 and b.owner_id = auth.uid()) $b$
  $f$, arg);

  select p.oid, pg_get_function_result(p.oid) as res into f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_site_admin'
     and pg_get_function_identity_arguments(p.oid) = '';
  if f.oid is not null and f.res <> 'boolean' then
    raise exception 'STOPPED, nothing changed. is_site_admin returns %, expected boolean', f.res;
  end if;
  create or replace function public.is_site_admin()
  returns boolean language sql stable security definer set search_path = public as
  $b$ select public.sol_is_admin() $b$;
end $$;
revoke all on function public.is_book_author(uuid) from public, anon;
grant execute on function public.is_book_author(uuid) to authenticated;
grant execute on function public.is_site_admin() to anon, authenticated;


-- ---------------------------------------------------------
-- 3. Safety check: every Writer Studio function must check the
--    owner, directly or through is_book_author().
-- ---------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('author_list_my_books','author_list_chapters','author_get_chapter',
                       'author_upsert_book','author_upsert_chapter','author_delete_chapter',
                       'author_set_chapter_status','author_set_book_details')
     and not (p.prosrc ~* 'is_book_author\('
              or (p.prosrc ~* 'auth\.uid\(\)' and p.prosrc ~* 'owner_id'));
  if bad is not null then
    raise exception 'STOPPED, nothing changed. These Writer Studio functions do not check the book owner: %', bad;
  end if;
end $$;

create table if not exists public.sol_blocked_writers (
  user_id uuid primary key,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.sol_blocked_writers enable row level security;
revoke all on public.sol_blocked_writers from anon, authenticated;


-- ---------------------------------------------------------
-- 4. Who can write / sell
-- ---------------------------------------------------------
create or replace function public.author_can_write()
returns boolean language sql stable security definer set search_path = public, auth as
$$
  select public.sol_is_admin()
      or (auth.uid() is not null
          and exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
          and not exists (select 1 from public.sol_blocked_writers b where b.user_id = auth.uid()));
$$;
revoke all on function public.author_can_write() from public, anon;
grant execute on function public.author_can_write() to authenticated;

create or replace function public.author_can_sell()
returns boolean language sql stable security definer set search_path = public as
$$ select public.sol_is_admin() $$;
revoke all on function public.author_can_sell() from public, anon;
grant execute on function public.author_can_sell() to authenticated;


-- ---------------------------------------------------------
-- 5. Table guards
--    They run on every write, whichever function makes it.
--    Requests without a user (SQL Editor, payment webhook with
--    the service key) and admins are not limited.
-- ---------------------------------------------------------
alter table public.books add column if not exists is_hidden boolean not null default false;

create or replace function public.sol_books_guard()
returns trigger language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  o jsonb; n jsonb; k text;
  locked text[] := array['owner_id','title','author','genre','description','cover_url','price',
                         'status','is_mature','content_warnings','update_schedule','is_hidden'];
begin
  if uid is null or public.sol_is_admin() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if not public.author_can_write() then raise exception 'Writing is not available for this account'; end if;
    if (select count(*) from public.books where owner_id = uid and created_at > now() - interval '1 day') >= 3 then
      raise exception 'You can create up to 3 new books a day';
    end if;
    new.owner_id := uid;
    new.price := 0;
    new.is_hidden := false;
    if new.cover_url is not null and new.cover_url <> '' and new.cover_url !~* '^https://' then
      raise exception 'Cover image must be an https:// link';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.owner_id is distinct from uid then raise exception 'Not your book'; end if;
    return old;
  end if;

  -- UPDATE
  if old.owner_id is distinct from uid then
    -- readers may only touch counters (views, votes ...), never the story itself
    o := to_jsonb(old); n := to_jsonb(new);
    foreach k in array locked loop
      if (o -> k) is distinct from (n -> k) then raise exception 'Not your book'; end if;
    end loop;
    return new;
  end if;
  if not public.author_can_write() then raise exception 'Writing is not available for this account'; end if;
  new.owner_id := old.owner_id;
  new.is_hidden := old.is_hidden;
  new.price := 0;
  if new.cover_url is not null and new.cover_url <> '' and new.cover_url !~* '^https://' then
    raise exception 'Cover image must be an https:// link';
  end if;
  return new;
end
$$;
drop trigger if exists sol_books_guard on public.books;
create trigger sol_books_guard before insert or update or delete on public.books
  for each row execute function public.sol_books_guard();

create or replace function public.sol_chapters_guard()
returns trigger language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  owner_new uuid; owner_old uuid;
  o jsonb; n jsonb; k text;
  locked text[] := array['book_id','chapter_number','title','content','is_free','price','status'];
begin
  if uid is null or public.sol_is_admin() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then select owner_id into owner_old from public.books where id = old.book_id; end if;
  if tg_op <> 'DELETE' then select owner_id into owner_new from public.books where id = new.book_id; end if;

  if tg_op = 'DELETE' then
    if owner_old is distinct from uid then raise exception 'Not your chapter'; end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (owner_old is distinct from uid or owner_new is distinct from uid) then
    o := to_jsonb(old); n := to_jsonb(new);
    foreach k in array locked loop
      if (o -> k) is distinct from (n -> k) then raise exception 'Not your chapter'; end if;
    end loop;
    return new;
  end if;

  if owner_new is distinct from uid then raise exception 'Not your book'; end if;
  if not public.author_can_write() then raise exception 'Writing is not available for this account'; end if;
  if length(coalesce(new.content, '')) > 300000 then raise exception 'Chapter is too long'; end if;

  if tg_op = 'INSERT' and (select count(*) from public.chapters c join public.books b on b.id = c.book_id
                            where b.owner_id = uid and c.created_at > now() - interval '1 day') >= 30 then
    raise exception 'You can add up to 30 chapters a day';
  end if;

  -- free books only for writers who are not Sol admins
  n := jsonb_build_object('is_free', true);
  if to_jsonb(new) ? 'price' then n := n || jsonb_build_object('price', 0); end if;
  new := jsonb_populate_record(new, n);
  return new;
end
$$;
drop trigger if exists sol_chapters_guard on public.chapters;
create trigger sol_chapters_guard before insert or update or delete on public.chapters
  for each row execute function public.sol_chapters_guard();


-- ---------------------------------------------------------
-- 6. Moderation
-- ---------------------------------------------------------
-- hidden books disappear for everyone except their writer and admins
drop policy if exists "sol hidden books" on public.books;
create policy "sol hidden books" on public.books as restrictive for select
  using (not is_hidden or owner_id = auth.uid() or public.sol_is_admin());

-- your live reader function, plus: chapters of a hidden book don't open
-- (except for its writer and admins)
create or replace function public.get_chapter_for_reader(p_chapter_id uuid)
returns table (id uuid, book_id uuid, chapter_number integer, title text, content text,
               price numeric, is_free boolean, created_at timestamptz)
language sql stable security definer set search_path = public as
$$
  select c.id, c.book_id, c.chapter_number, c.title, c.content, c.price, c.is_free, c.created_at
    from public.chapters c
    join public.books b on b.id = c.book_id
   where c.id = p_chapter_id
     and c.status = 'published'
     and (not b.is_hidden or b.owner_id = (select auth.uid()) or public.sol_is_admin())
     and (
       c.is_free = true
       or exists (
         select 1 from public.purchases p
          where p.user_id = (select auth.uid())
            and p.payment_status = 'paid'
            and (p.chapter_id = c.id or (p.purchase_type = 'book' and p.book_id = c.book_id))
       )
     );
$$;

create table if not exists public.book_reports (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  reporter_id uuid not null,
  reason text not null check (length(reason) between 1 and 500),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists book_reports_one_open
  on public.book_reports (book_id, reporter_id) where not resolved;
alter table public.book_reports enable row level security;
revoke all on public.book_reports from anon, authenticated;

create or replace function public.report_book(p_book_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as
$$
declare r text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if auth.uid() is null then raise exception 'Log in to report a book'; end if;
  if r = '' then raise exception 'Tell us what is wrong'; end if;
  if not exists (select 1 from public.books where id = p_book_id) then raise exception 'Book not found'; end if;
  if (select count(*) from public.book_reports where reporter_id = auth.uid()
       and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many reports today';
  end if;
  insert into public.book_reports (book_id, reporter_id, reason)
    values (p_book_id, auth.uid(), r)
    on conflict (book_id, reporter_id) where not resolved do update set reason = excluded.reason;
end
$$;
revoke all on function public.report_book(uuid, text) from public, anon;
grant execute on function public.report_book(uuid, text) to authenticated;

create or replace function public.admin_list_reports()
returns table (id uuid, book_id uuid, book_title text, book_author text, owner_id uuid,
               is_hidden boolean, owner_blocked boolean, reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$
begin
  if not public.sol_is_admin() then raise exception 'Unauthorized'; end if;
  return query
    select r.id, b.id, b.title, b.author, b.owner_id, b.is_hidden,
           exists (select 1 from public.sol_blocked_writers w where w.user_id = b.owner_id),
           r.reason, r.created_at
      from public.book_reports r join public.books b on b.id = r.book_id
     where not r.resolved
     order by r.created_at desc
     limit 200;
end
$$;
revoke all on function public.admin_list_reports() from public, anon;
grant execute on function public.admin_list_reports() to authenticated;

create or replace function public.admin_resolve_report(p_report_id uuid)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.sol_is_admin() then raise exception 'Unauthorized'; end if;
  update public.book_reports set resolved = true where id = p_report_id;
end
$$;
revoke all on function public.admin_resolve_report(uuid) from public, anon;
grant execute on function public.admin_resolve_report(uuid) to authenticated;

create or replace function public.admin_set_book_hidden(p_book_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.sol_is_admin() then raise exception 'Unauthorized'; end if;
  update public.books set is_hidden = coalesce(p_hidden, false) where id = p_book_id;
end
$$;
revoke all on function public.admin_set_book_hidden(uuid, boolean) from public, anon;
grant execute on function public.admin_set_book_hidden(uuid, boolean) to authenticated;

-- blocking a writer also hides all their books; unblocking leaves them hidden
create or replace function public.admin_set_writer_blocked(p_user_id uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.sol_is_admin() then raise exception 'Unauthorized'; end if;
  if exists (select 1 from public.sol_admins where user_id = p_user_id) then
    raise exception 'Admins cannot be blocked';
  end if;
  if p_blocked then
    insert into public.sol_blocked_writers (user_id) values (p_user_id) on conflict do nothing;
    update public.books set is_hidden = true where owner_id = p_user_id;
  else
    delete from public.sol_blocked_writers where user_id = p_user_id;
  end if;
end
$$;
revoke all on function public.admin_set_writer_blocked(uuid, boolean) from public, anon;
grant execute on function public.admin_set_writer_blocked(uuid, boolean) to authenticated;


-- ---------------------------------------------------------
-- 7. Discussion moderators = admins only
--    (before, anyone who owned a book could pin and delete posts)
-- ---------------------------------------------------------
create or replace function public.is_sol_writer()
returns boolean language sql stable security definer set search_path = public as
$$ select public.sol_is_admin() $$;
grant execute on function public.is_sol_writer() to anon, authenticated;

do $$ begin
  raise notice 'Writing is open. Sol admins: %',
    (select string_agg(user_id::text, ', ') from public.sol_admins);
end $$;

commit;
