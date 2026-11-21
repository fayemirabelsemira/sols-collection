-- Open-writing checks (after sql/06 + sql/07). Each line prints PASS or FAIL.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
-- a deliberately careless owner-rights helper: proves the table guards hold
-- even if a live Writer Studio function forgot an ownership check
create or replace function public.t_careless(p_sql text) returns text language plpgsql security definer set search_path = public as $$
begin execute p_sql; return 'DONE'; exception when others then return 'BLOCKED: ' || sqlerrm; end $$;
grant execute on function public.t_careless(text) to authenticated;
insert into auth.users (id, email_confirmed_at) values ('00000000-0000-4000-8000-0000000000cc', null);

-- who can write / sell
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when public.author_can_write() then 'PASS new reader can write' else 'FAIL new reader cannot write' end;
select case when not public.author_can_sell() then 'PASS new writer cannot sell' else 'FAIL new writer can sell' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000cc'); set role authenticated;
select case when not public.author_can_write() then 'PASS unconfirmed email cannot write' else 'FAIL unconfirmed email can write' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee'); set role authenticated;
select case when public.author_can_sell() then 'PASS Sol admin can sell' else 'FAIL Sol admin cannot sell' end;

-- a new writer's book and chapters are free
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select (public.author_upsert_book(null, 'B Book', 'Reader B', 'Romance', 'd', 'https://img.example/c.jpg', 150)).id as bbook \gset
reset role;
select case when price = 0 and owner_id = '00000000-0000-4000-8000-0000000000bb' then 'PASS new writer book saved free and owned'
            else 'FAIL new writer book price ' || price end from public.books where id = :'bbook';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select (public.author_upsert_chapter(null, :'bbook', 1, 'One', 'hello', false, 20, 'published')).id as bch \gset
reset role;
select case when is_free and price = 0 then 'PASS new writer chapter forced free'
            else 'FAIL new writer chapter paid' end from public.chapters where id = :'bch';

-- the writer cannot touch Sol's book, even through a careless function
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when public.t_careless($q$update public.chapters set content = 'HACKED' where id = '00000000-0000-4000-8000-0000000c0002'$q$) like 'BLOCKED%'
            then 'PASS cannot rewrite another writer''s chapter' else 'FAIL rewrote another writer''s chapter' end;
select case when public.t_careless($q$delete from public.chapters where id = '00000000-0000-4000-8000-0000000c0002'$q$) like 'BLOCKED%'
            then 'PASS cannot delete another writer''s chapter' else 'FAIL deleted another writer''s chapter' end;
select case when public.t_careless($q$update public.books set price = 1 where id = '00000000-0000-4000-8000-00000000b001'$q$) like 'BLOCKED%'
            then 'PASS cannot change another writer''s book' else 'FAIL changed another writer''s book' end;
select case when public.t_careless($q$update public.books set owner_id = '00000000-0000-4000-8000-0000000000bb' where id = '00000000-0000-4000-8000-00000000b001'$q$) like 'BLOCKED%'
            then 'PASS cannot take over another writer''s book' else 'FAIL took over a book' end;
select case when public.t_careless($q$insert into public.chapters (book_id, chapter_number, content) values ('00000000-0000-4000-8000-00000000b001', 9, 'x')$q$) like 'BLOCKED%'
            then 'PASS cannot add chapters to another writer''s book' else 'FAIL added a chapter to another book' end;
select case when public.t_careless($q$update public.chapters set is_free = false, price = 50 where book_id = '$q$ || :'bbook' || $q$'$q$) = 'DONE'
             and (select bool_and(is_free) from public.chapters where book_id = :'bbook')
            then 'PASS own chapters stay free even when set paid' else 'FAIL own chapter became paid' end;
select case when public.t_careless($q$select public.author_get_chapter('00000000-0000-4000-8000-0000000c0002')$q$) like 'BLOCKED%'
            then 'PASS cannot open Sol''s paid chapter in the studio' else 'FAIL read Sol''s paid chapter' end;
select case when public.t_careless($q$select public.author_upsert_chapter('00000000-0000-4000-8000-0000000c0002', null, null, 'x', 'HACKED', null, null, 'published')$q$) like 'BLOCKED%'
            then 'PASS live studio function refuses another writer''s chapter' else 'FAIL live studio function edited another writer''s chapter' end;
select case when public.t_careless($q$select public.author_list_chapters('00000000-0000-4000-8000-00000000b001')$q$) like 'BLOCKED%'
            then 'PASS cannot list Sol''s chapters and drafts' else 'FAIL listed Sol''s chapters' end;
select case when not exists (select 1 from public.author_list_my_books() where owner_id <> '00000000-0000-4000-8000-0000000000bb')
            then 'PASS studio lists only the writer''s own books' else 'FAIL studio lists other writers'' books' end;
select case when not public.is_site_admin() then 'PASS owning a book does not make a site admin' else 'FAIL every writer is a site admin' end;
select public.increment_views('00000000-0000-4000-8000-00000000b001');
reset role;
select case when coalesce(views, 0) >= 1 then 'PASS readers still count views' else 'FAIL view counter blocked' end
  from public.books where id = '00000000-0000-4000-8000-00000000b001';

-- Sol keeps paid chapters
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee'); set role authenticated;
select public.author_upsert_chapter(null, '00000000-0000-4000-8000-00000000b001', 3, 'Paid', 'p', false, 15, 'published') is not null;
reset role;
select case when not is_free and price = 15 then 'PASS Sol can still sell chapters' else 'FAIL Sol chapter forced free' end
  from public.chapters where book_id = '00000000-0000-4000-8000-00000000b001' and chapter_number = 3;

-- daily limit on new books
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select public.t_careless($q$select public.author_upsert_book(null, 'B2', 'B', 'R', '', '', 0)$q$) is not null;
select public.t_careless($q$select public.author_upsert_book(null, 'B3', 'B', 'R', '', '', 0)$q$) is not null;
select case when public.t_careless($q$select public.author_upsert_book(null, 'B4', 'B', 'R', '', '', 0)$q$) like 'BLOCKED%3 new books%'
            then 'PASS daily book limit' else 'FAIL no daily book limit' end;
select case when public.t_careless($q$select public.author_upsert_book(null, 'Bad', 'B', 'R', '', 'javascript:alert(1)', 0)$q$) like 'BLOCKED%'
            then 'PASS non-https cover refused' else 'FAIL bad cover accepted' end;

-- discussion moderation is admins only now
select case when not public.is_sol_writer() then 'PASS book owner is no longer a moderator' else 'FAIL any writer can moderate' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee'); set role authenticated;
select case when public.is_sol_writer() then 'PASS Sol can moderate' else 'FAIL Sol lost moderation' end;

-- reports, hiding, blocking
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa'); set role authenticated;
select public.report_book(:'bbook', 'spam');
select case when public.t_careless('select public.admin_list_reports()') like 'BLOCKED%Unauthorized%'
            then 'PASS readers cannot see reports' else 'FAIL readers can see reports' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee'); set role authenticated;
select case when (select count(*) from public.admin_list_reports()) = 1 then 'PASS Sol sees the report' else 'FAIL report missing' end;
select public.admin_set_book_hidden(:'bbook', true);
reset role; select pg_temp.as_user(null); set role anon;
select case when not exists (select 1 from public.books where id = :'bbook') then 'PASS hidden book gone for readers' else 'FAIL hidden book visible' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
reset role; select pg_temp.as_user(null); set role anon;
select case when not exists (select 1 from public.get_chapter_for_reader(:'bch')) then 'PASS hidden book''s chapter won''t open by link'
            else 'FAIL hidden book''s chapter opens by link' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when exists (select 1 from public.books where id = :'bbook') then 'PASS writer still sees own hidden book' else 'FAIL writer lost own book' end;
select case when public.t_careless($q$update public.books set is_hidden = false where id = '$q$ || :'bbook' || $q$'$q$) like 'BLOCKED%'
              or (select is_hidden from public.books where id = :'bbook')
            then 'PASS writer cannot unhide' else 'FAIL writer unhid own book' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee'); set role authenticated;
select public.admin_set_writer_blocked('00000000-0000-4000-8000-0000000000bb', true);
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when not public.author_can_write() then 'PASS blocked writer cannot write' else 'FAIL blocked writer can write' end;
reset role;
select case when bool_and(is_hidden) then 'PASS blocked writer''s books hidden' else 'FAIL blocked writer''s books visible' end
  from public.books where owner_id = '00000000-0000-4000-8000-0000000000bb';
