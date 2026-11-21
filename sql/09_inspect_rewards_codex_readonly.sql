-- =========================================================
-- Sol: READ-ONLY look at the tables behind comments, purchases,
-- character cards and recaps. Changes nothing.
--   Run in Supabase -> SQL Editor, then Export -> CSV and send it.
--   Needed to build: chapter rewards, spoiler-safe comments,
--   and the character cards / recaps for Princess and the Seven Swords.
-- =========================================================
with tbl as (
  select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (c.relname in ('comments', 'comment_likes', 'purchases', 'reading_progress', 'chapters', 'books')
          or c.relname ~* '(codex|character|cast|recap|share|reward|streak|fact)')
)
select '1 COLUMNS' as section, t.relname as item,
       string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                  || case when a.attnotnull then ' not null' else '' end
                  || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' order by a.attnum) as detail
  from tbl t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
 group by t.relname

union all
select '2 CONSTRAINT', t.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
  from tbl t join pg_constraint con on con.conrelid = t.oid
 where con.contype in ('c', 'u', 'f', 'p')

union all
select '3 POLICY', p.tablename || ' : ' || p.policyname,
       p.cmd || ' to ' || array_to_string(p.roles, ',') ||
       coalesce(' USING ' || p.qual, '') || coalesce(' CHECK ' || p.with_check, '')
  from pg_policies p
 where p.schemaname = 'public' and p.tablename in (select relname from tbl)

union all
select '4 TRIGGER', t.relname || ' : ' || tg.tgname, pg_get_triggerdef(tg.oid)
  from tbl t join pg_trigger tg on tg.tgrelid = t.oid
 where not tg.tgisinternal

union all
select '5 FUNCTION', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname in ('get_codex', 'get_recaps', 'get_book_chapter_metadata', 'get_popular_highlights', 'get_top_saved_lines')
        or p.proname ~* '(comment|purchase|codex|recap|share|reward)')
   and p.prokind = 'f'

union all
select '6 ROWS', relname, (xpath('/row/n/text()',
         query_to_xml(format('select count(*) as n from public.%I', relname), false, true, '')))[1]::text
  from tbl
 order by 1, 2;
