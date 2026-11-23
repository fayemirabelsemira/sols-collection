-- =========================================================
-- Sol: spell the pen name the same way on every book
--   Run in Supabase -> SQL Editor. One transaction. Safe to run again.
--
--   Some books said "Ladyysol" and others "ladyysol". This sets them all
--   to 'ladyysol' (your Wattpad name). Only books whose author is some
--   spelling of ladyysol are changed; other writers' books are not touched.
--   Want a different spelling? Change 'ladyysol' on the update line below.
-- =========================================================

begin;

update public.books
   set author = 'ladyysol'
 where lower(btrim(author)) = 'ladyysol'
   and author is distinct from 'ladyysol';

-- what the books say now
select title, author from public.books order by title;

commit;
