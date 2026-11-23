-- Checks for sql/19 (a view per chapter), run after it has been applied twice
\set b '(select id from public.books where title ilike ''%seven swords%'')'
\set c1 '(select id from public.chapters where book_id = (select id from public.books where title ilike ''%seven swords%'') and chapter_number = 1)'
\set c2 '(select id from public.chapters where book_id = (select id from public.books where title ilike ''%seven swords%'') and chapter_number = 2)'
update public.books set views = 0 where id = :b;
-- a guest reads ch1 twice and ch2 once: 2 views
select public.increment_chapter_views(:c1, 'device-aaaaaaaaaaaa');
select public.increment_chapter_views(:c1, 'device-aaaaaaaaaaaa');
select public.increment_chapter_views(:c2, 'device-aaaaaaaaaaaa');
select case when (select views from public.books where id = :b) = 2
  then 'PASS chapter views: guest gets one view per chapter, re-open does not count' else 'FAIL guest chapter views' end;
-- a logged-in reader reads ch1 twice: +1
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, false);
select public.increment_chapter_views(:c1);
select case when public.increment_chapter_views(:c1) = 3
  then 'PASS chapter views: logged-in reader counted once per chapter' else 'FAIL reader chapter views' end;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  perform public.increment_chapter_views(gen_random_uuid(), 'device-aaaaaaaaaaaa');
  raise notice 'FAIL unknown chapter counted';
exception when others then raise notice 'PASS chapter views: unknown chapter refused';
end $$;
do $$ begin
  perform public.increment_chapter_views((select id from public.chapters limit 1), 'short');
  raise notice 'FAIL bad device counted';
exception when others then raise notice 'PASS chapter views: bad device id refused';
end $$;
select case when not has_table_privilege('anon', 'public.chapter_views_guest', 'select')
  and not has_table_privilege('authenticated', 'public.chapter_views', 'insert')
  then 'PASS chapter views: tables not open to browsers' else 'FAIL chapter view tables open' end;
