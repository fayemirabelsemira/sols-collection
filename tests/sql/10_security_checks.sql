-- Security checks, run as the browser roles. Each line prints PASS or FAIL.
-- Expects the stub + sql/01, 03, 04 and (for the "after" run) sql/06.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

-- helper: act as a signed-in user
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;

-- SOL-01: Mallory's colour must not end up on a post
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa');
set role authenticated;
select case when (select avatar_color from public.create_thread(null, 'PoC thread', 'hi', false)) is null
            then 'PASS SOL-01 malicious avatar_color dropped by create_thread'
            else 'FAIL SOL-01 malicious avatar_color stored on thread' end;
reset role;
select case when (select count(*) from public.discussion_threads where avatar_color !~ '^#[0-9A-Fa-f]{6}$') = 0
            then 'PASS SOL-01 no invalid colours stored'
            else 'FAIL SOL-01 invalid colours stored' end;
-- legit user keeps their colour
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb');
set role authenticated;
select case when (select avatar_color from public.create_thread(null, 'Normal thread', 'hi', false)) = '#e0274f'
            then 'PASS SOL-01 valid colour still kept'
            else 'FAIL SOL-01 valid colour lost' end;

-- SOL-05: paid chapter text through the REST-style direct read
reset role;
select pg_temp.as_user(null);
set role anon;
reset role;
create or replace function pg_temp.try_read_content() returns text language plpgsql as $$
declare v text;
begin
  select content into v from public.chapters where chapter_number = 2;
  return coalesce(v, '<null>');
exception when insufficient_privilege then return 'DENIED';
end $$;
set role anon;
select case when pg_temp.try_read_content() = 'DENIED'
            then 'PASS SOL-05 anon cannot read paid chapter text directly'
            else 'FAIL SOL-05 anon read paid chapter text directly: ' || pg_temp.try_read_content() end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when pg_temp.try_read_content() = 'DENIED'
            then 'PASS SOL-05 signed-in reader cannot read paid chapter text directly'
            else 'FAIL SOL-05 signed-in reader read paid chapter text directly' end;
reset role; select pg_temp.as_user(null);
reset role; set role anon;
select case when (select chapter_number from public.chapters where id = '00000000-0000-4000-8000-0000000c0002') = 2
            then 'PASS SOL-05 chapter_number still readable (used by the site)'
            else 'FAIL SOL-05 chapter_number not readable' end;
reset role; set role anon;
select case when (select content from public.get_chapter_for_reader('00000000-0000-4000-8000-0000000c0001')) = 'FREE TEXT'
            then 'PASS SOL-05 free chapter still opens through get_chapter_for_reader'
            else 'FAIL SOL-05 reader function broken' end;

-- existing controls (regression): direct writes stay blocked
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa'); set role authenticated;
update public.books set price = 0;
reset role;
select case when (select price from public.books limit 1) = 150
            then 'PASS books cannot be edited by readers' else 'FAIL books price changed' end;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa'); set role authenticated;
insert into public.discussion_threads (user_id, display_name, title) values ('00000000-0000-4000-8000-0000000000bb', 'Reader B', 'spoofed');
reset role;
select case when (select count(*) from public.discussion_threads where title = 'spoofed') = 0
            then 'PASS threads cannot be inserted directly (no name spoofing)' else 'FAIL direct thread insert worked' end;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa'); set role authenticated;
select public.set_thread_pinned((select id from public.discussion_threads limit 1), true);
reset role;
select case when (select count(*) from public.discussion_threads where pinned) = 0
            then 'PASS non-writer cannot pin' else 'FAIL non-writer pinned a thread' end;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa'); set role authenticated;
select public.author_set_book_details('00000000-0000-4000-8000-00000000b001', 'completed', true, '{}', null);
reset role;
select case when (select status from public.books limit 1) = 'ongoing'
            then 'PASS non-owner cannot change book details' else 'FAIL non-owner changed book details' end;
reset role; select pg_temp.as_user(null); set role anon;
select public.cast_vote('00000000-0000-4000-8000-00000000b001');
reset role;
select case when coalesce((select votes from public.books limit 1), 0) = 0
            then 'PASS anonymous vote refused' else 'FAIL anonymous vote counted' end;

-- SOL-05: nobody writes chapters directly
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000ee'); set role authenticated;
insert into public.chapters (book_id, chapter_number, content) values ('00000000-0000-4000-8000-00000000b001', 99, 'injected');
update public.chapters set content = 'defaced';
reset role;
select case when (select count(*) from public.chapters where chapter_number = 99 or content = 'defaced') = 0
            then 'PASS chapters cannot be written directly' else 'FAIL chapters written directly' end;
