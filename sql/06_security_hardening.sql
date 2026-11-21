-- =========================================================
-- Sol: security hardening
--   Run in Supabase -> SQL Editor AFTER sql/04_discussions.sql.
--   Safe to run again. Each part says what it changes.
--   See SECURITY_FIXES.md for the why.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Avatar colours (finding SOL-01)
--    Profile data (raw_user_meta_data) is written by the user
--    themselves through supabase.auth.updateUser(), so it can hold
--    anything. Only a plain #rrggbb colour is copied onto posts now.
-- ---------------------------------------------------------
create or replace function public.discussion_author(out v_name text, out v_color text)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(left(nullif(btrim(coalesce(raw_user_meta_data ->> 'display_name', '')), ''), 60), 'Reader'),
         case when raw_user_meta_data ->> 'avatar_color' ~ '^#[0-9A-Fa-f]{6}$'
              then raw_user_meta_data ->> 'avatar_color' end
    from auth.users where id = auth.uid();
$$;
revoke all on function public.discussion_author() from public, anon, authenticated;

-- clean colours already stored on posts (only touches invalid values)
update public.discussion_threads set avatar_color = null
 where avatar_color is not null and avatar_color !~ '^#[0-9A-Fa-f]{6}$';
update public.discussion_replies set avatar_color = null
 where avatar_color is not null and avatar_color !~ '^#[0-9A-Fa-f]{6}$';

-- and refuse bad ones at the table level from now on
do $$ begin
  alter table public.discussion_threads
    add constraint discussion_threads_avatar_color_check
    check (avatar_color is null or avatar_color ~ '^#[0-9A-Fa-f]{6}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.discussion_replies
    add constraint discussion_replies_avatar_color_check
    check (avatar_color is null or avatar_color ~ '^#[0-9A-Fa-f]{6}$');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------
-- 2. Chapter text can only be read through get_chapter_for_reader
--    (finding SOL-05, needs the read-only audit to confirm).
--    The site reads chapters directly only for id / chapter_number.
--    If the browser roles can SELECT every column, anyone with the
--    public key could request ?select=content and read paid chapters.
--    This keeps the safe columns readable and removes the rest.
--
--    Guard: it does NOTHING if any function that reads the chapters
--    table runs as the caller (not SECURITY DEFINER), because that
--    function would stop working. It prints a NOTICE either way.
--
--    Undo:  grant select on public.chapters to anon, authenticated;
--    (writes are revoked too; undo with grant insert, update, delete ...)
-- ---------------------------------------------------------
do $$
declare
  v_bad  text;
  v_cols text;
begin
  if to_regclass('public.chapters') is null then
    raise notice 'chapters table not found: skipped';
    return;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and not p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and p.prosrc ~* '\mchapters\M';

  if v_bad is not null then
    raise notice 'Chapter lock SKIPPED. These functions read chapters as the caller and would break: %', v_bad;
    return;
  end if;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'chapters'
     and column_name in ('id', 'book_id', 'chapter_number', 'title', 'is_free',
                         'status', 'published_at', 'created_at', 'updated_at');

  revoke select on public.chapters from anon, authenticated;
  -- writing chapters goes through the author_* functions (owner rights);
  -- the browser roles never need to write the table directly
  revoke insert, update, delete, truncate on public.chapters from anon, authenticated;
  execute format('grant select (%s) on public.chapters to anon, authenticated', v_cols);
  raise notice 'Chapter text locked. Browser roles can read only: %', v_cols;
end $$;
