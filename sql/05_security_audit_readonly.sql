-- =========================================================
-- Sol: SECURITY AUDIT (READ-ONLY)
--   Changes nothing. Run in Supabase -> SQL Editor, then copy the
--   result table (or "Export -> CSV") back to Claude so the parts of
--   the backend that are not in this repo can be reviewed:
--   chapter/purchase/comment policies, author_* functions,
--   get_chapter_for_reader, triggers and grants.
--
--   One result table: section | item | detail
-- =========================================================

with
-- 1. public tables and whether Row Level Security is on
rls as (
  select '1 RLS' as section,
         c.relname::text as item,
         case when c.relrowsecurity then 'RLS on' else '!! RLS OFF' end
           || case when c.relforcerowsecurity then ', forced' else '' end as detail
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
),
-- 2. every policy, with its rule
pol as (
  select '2 POLICY',
         tablename || ' : ' || policyname,
         cmd || ' to ' || array_to_string(roles, ',') ||
         coalesce(' USING (' || qual || ')', '') ||
         coalesce(' CHECK (' || with_check || ')', '')
    from pg_policies where schemaname = 'public'
),
-- 3. what the browser roles may do on each table
tgrants as (
  select '3 TABLE GRANT',
         table_name || ' : ' || grantee,
         string_agg(privilege_type, ', ' order by privilege_type)
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
   group by table_name, grantee
),
-- 4. column-level grants (chapters especially)
cgrants as (
  select '4 COLUMN GRANT',
         table_name || '.' || column_name || ' : ' || grantee,
         string_agg(privilege_type, ', ' order by privilege_type)
    from information_schema.role_column_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in ('chapters', 'purchases', 'comments', 'books', 'reading_progress', 'comment_likes')
   group by table_name, column_name, grantee
),
-- 5. functions: definer or not, search_path pinned or not, who can call them
fns as (
  select '5 FUNCTION',
         p.oid::regprocedure::text,
         case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end ||
         case when p.prosecdef and not coalesce(array_to_string(p.proconfig, ',') like '%search_path%', false)
              then ' !! no search_path' else '' end ||
         ' | anon=' || has_function_privilege('anon', p.oid, 'execute') ||
         ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
),
-- 6. full source of the functions that guard paid content, writing and moderation
src as (
  select '6 SOURCE',
         p.oid::regprocedure::text,
         pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and (p.proname like 'author\_%' or p.proname in (
           'get_chapter_for_reader', 'get_book_chapter_metadata', 'is_comment_admin',
           'get_popular_highlights', 'get_top_saved_lines', 'get_codex', 'get_recaps')
          or p.prorettype = 'trigger'::regtype)
),
-- 7. triggers on public tables
trg as (
  select '7 TRIGGER',
         event_object_table || ' : ' || trigger_name,
         action_timing || ' ' || string_agg(event_manipulation, '/') || ' -> ' || action_statement
    from information_schema.triggers
   where trigger_schema = 'public'
   group by event_object_table, trigger_name, action_timing, action_statement
),
-- 8. storage buckets (public buckets can be listed / read by anyone)
bkt as (
  select '8 BUCKET', name::text,
         case when public then 'public' else 'private' end ||
         coalesce(' | max ' || file_size_limit || ' bytes', ' | no size limit') ||
         coalesce(' | types ' || array_to_string(allowed_mime_types, ','), ' | any file type')
    from storage.buckets
),
-- 9. columns of the sensitive tables (to know what a direct REST read returns)
cols as (
  select '9 COLUMNS', table_name::text,
         string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('chapters', 'purchases', 'comments', 'books', 'reading_progress', 'comment_likes')
   group by table_name
)
select * from rls
union all select * from pol
union all select * from tgrants
union all select * from cgrants
union all select * from fns
union all select * from src
union all select * from trg
union all select * from bkt
union all select * from cols
order by 1, 2;
