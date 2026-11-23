-- Checks for sql/20 (guest comments), run after it has been applied twice
select set_config('request.jwt.claim.sub', '', false);
-- like live: every comment's user_id must be a real account
create table if not exists auth.users (id uuid primary key);
insert into auth.users select distinct user_id from public.comments where user_id is not null on conflict do nothing;
alter table public.comments drop constraint if exists comments_user_id_fkey;
alter table public.comments add constraint comments_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
\set ch '(select id from public.chapters where book_id = (select id from public.books where title ilike ''%seven swords%'') and chapter_number = 3)'
select public.post_guest_comment(:ch, 'guest-device-0001', '  Nina ', 'Ang ganda!');
select case when exists (select 1 from public.comments c where c.is_guest and c.author_name = 'Nina · Guest'
    and c.body = 'Ang ganda!' and c.user_id is null and c.guest_id = md5('sol-guest:guest-device-0001')::uuid and c.reader_chapter = 3)
  then 'PASS guest comments: posted as "Nina · Guest", no account, own guest id, spoiler-stamped' else 'FAIL guest comment row' end;
select case when (select count(*) from public.comments where guest_id = md5('sol-guest:guest-device-0001')::uuid) = 1
  then 'PASS guest comments: one row' else 'FAIL guest comment count' end;

create function pg_temp.refused(sql text, want text) returns text language plpgsql as $$
begin
  execute sql;
  return 'FAIL ' || want;
exception when others then
  return case when sqlerrm ~* want then 'PASS guest comments refused: ' || want else 'FAIL ' || want || ' (got: ' || sqlerrm || ')' end;
end $$;
select pg_temp.refused(format('select public.post_guest_comment(%L, ''guest-device-0001'', ''Nina'', ''again'')', :ch), 'too fast');
select pg_temp.refused(format('select public.post_guest_comment(%L, ''guest-device-0002'', ''Bo'', ''see https://x.y'')', :ch), 'Links');
select pg_temp.refused(format('select public.post_guest_comment(%L, ''guest-device-0003'', ''Bo'', ''go to spam.com now'')', :ch), 'Links');
select pg_temp.refused(format('select public.post_guest_comment(%L, ''guest-device-0004'', ''The Author'', ''hi'')', :ch), 'different name');
select pg_temp.refused(format('select public.post_guest_comment(%L, ''guest-device-0005'', ''Bo · Author'', ''hi'')', :ch), 'different name');
select pg_temp.refused(format('select public.post_guest_comment(%L, ''short'', ''Bo'', ''hi'')', :ch), 'Bad device');
select pg_temp.refused(format('select public.post_guest_comment(%L, ''guest-device-0006'', ''Bo'', ''hi'', null, ''https://evil'')', :ch), 'Bad GIF');
select pg_temp.refused('select public.post_guest_comment(gen_random_uuid(), ''guest-device-0007'', ''Bo'', ''hi'')', 'Chapter not found');

-- a GIF-only guest comment, as a reply
select public.post_guest_comment(:ch, 'guest-device-0008', 'Mika', '',
  (select id from public.comments where author_name = 'Nina · Guest'), '3o7TKSjRrfIPjeiVyM');
select case when exists (select 1 from public.comments where author_name = 'Mika · Guest' and body = '[GIF]'
    and gif_id = '3o7TKSjRrfIPjeiVyM' and parent_id is not null)
  then 'PASS guest comments: GIF-only reply works' else 'FAIL guest GIF reply' end;

-- site-wide flood limit: 20 guest comments in a minute stops the 21st
begin; set local session_replication_role = replica;  -- skip the login trigger for these filler rows
insert into public.comments (book_id, chapter_id, user_id, author_name, body, is_guest)
  select c.book_id, c.chapter_id, gen_random_uuid(), 'x · Guest', 'x', true
    from public.comments c, generate_series(1, 18) where c.author_name = 'Nina · Guest';
commit;
select pg_temp.refused(format('select public.post_guest_comment(%L, ''guest-device-0009'', ''Bo'', ''hi'')', :ch), 'Lots of guests');

select set_config('request.jwt.claim.sub', (select id::text from auth.users limit 1), false);
-- a logged-in reader can't mark their own comment as a guest one
insert into public.comments (book_id, chapter_id, author_name, body, is_guest, guest_id)
  select book_id, chapter_id, 'Real', 'pretending', true, gen_random_uuid() from public.comments where author_name = 'Nina · Guest';
select case when exists (select 1 from public.comments where body = 'pretending' and not is_guest and guest_id is null and user_id is not null)
  then 'PASS guest comments: logged-in readers can''t fake the guest flag' else 'FAIL guest flag can be faked' end;
delete from public.comments where body = 'pretending';
select pg_temp.refused(format('select public.post_guest_comment(%L, ''guest-device-0010'', ''Bo'', ''hi'')', :ch), 'logged in');
select set_config('request.jwt.claim.sub', '', false);
select case when has_function_privilege('anon', 'public.post_guest_comment(uuid,text,text,text,uuid,text)', 'execute')
  then 'PASS guest comments: guests can call it' else 'FAIL guests cannot call' end;
delete from public.comments where is_guest;
