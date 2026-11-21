-- Rewards + spoiler-safe stamps (sql/10). Each line prints PASS or FAIL.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
create or replace function public.t_try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'DONE'; exception when others then return 'BLOCKED: ' || sqlerrm; end $$;
grant execute on function public.t_try(text) to anon, authenticated;
-- Sol's book has chapters 1 (free) and 2 (paid); add paid 3 and 4
insert into public.chapters (id, book_id, chapter_number, title, content, is_free) values
  ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-00000000b001', 3, 'Three', 'P3', false),
  ('00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-00000000b001', 4, 'Four', 'P4', false);
update public.reward_settings set comments_needed = 4, shares_needed = 2, min_comment_chars = 15, max_comments_per_day = 3;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb');
-- reader B: 5 good comments today (only 3 count), 2 short ones, 3 good ones yesterday
insert into public.comments (book_id, chapter_id, user_id, body, created_at)
select '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000000bb',
       'This chapter was really good #' || g, now() - (g || ' minutes')::interval from generate_series(1, 5) g;
insert into public.comments (book_id, chapter_id, user_id, body, created_at)
select '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000000bb', 'nice', now() from generate_series(1, 2);
insert into public.comments (book_id, chapter_id, user_id, body, created_at)
select '00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000000bb',
       'Yesterday I loved this part ' || g, now() - interval '1 day' - (g || ' minutes')::interval from generate_series(1, 3) g;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when (public.reward_status('00000000-0000-4000-8000-00000000b001') ->> 'comments')::int = 6
            then 'PASS only real comments count, 3 per day' else 'FAIL comment count ' || (public.reward_status('00000000-0000-4000-8000-00000000b001') ->> 'comments') end;
select case when public.t_try($q$select public.claim_reward_chapter('00000000-0000-4000-8000-0000000c0002')$q$) like 'BLOCKED%No free chapter%'
            then 'PASS comments alone do not unlock (shares missing)' else 'FAIL unlocked without shares' end;
select public.record_share('00000000-0000-4000-8000-00000000b001') is not null;
select public.record_share('00000000-0000-4000-8000-00000000b001') is not null;
select case when (public.reward_status('00000000-0000-4000-8000-00000000b001') ->> 'shares')::int = 1
            then 'PASS only one share a day counts' else 'FAIL shares counted twice' end;
reset role;
insert into public.reward_shares (user_id, book_id, day) values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000b001', current_date - 3);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when (public.reward_status('00000000-0000-4000-8000-00000000b001') ->> 'available')::int = 1
            then 'PASS 4 comments + 2 shares earn 1 free chapter' else 'FAIL earned ' || (public.reward_status('00000000-0000-4000-8000-00000000b001') ->> 'available') end;
select case when public.t_try($q$select public.claim_reward_chapter('00000000-0000-4000-8000-0000000c0001')$q$) like 'BLOCKED%already free%'
            then 'PASS free chapter cannot be claimed' else 'FAIL claimed a free chapter' end;
select case when public.t_try($q$select public.claim_reward_chapter('00000000-0000-4000-8000-0000000c0002')$q$) = 'DONE'
            then 'PASS reward unlocks a paid chapter' else 'FAIL claim failed' end;
select case when (select content from public.get_chapter_for_reader('00000000-0000-4000-8000-0000000c0002')) = 'PAID SECRET TEXT'
            then 'PASS claimed chapter opens for the reader' else 'FAIL claimed chapter still locked' end;
select case when public.t_try($q$select public.claim_reward_chapter('00000000-0000-4000-8000-0000000c0003')$q$) like 'BLOCKED%No free chapter%'
            then 'PASS a reward can only be used once' else 'FAIL reward used twice' end;
select case when public.t_try($q$select public.claim_reward_chapter('00000000-0000-4000-8000-0000000c0002')$q$) like 'BLOCKED%already unlocked%'
            then 'PASS same chapter cannot be claimed twice' else 'FAIL double claim' end;
select case when (select content from public.get_chapter_for_reader('00000000-0000-4000-8000-0000000c0003')) is null
            then 'PASS other paid chapters stay locked' else 'FAIL other chapter opened' end;
select case when public.t_try($q$insert into public.purchases (user_id, chapter_id, amount, payment_status) values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000c0004', 0, 'paid')$q$) like 'BLOCKED%'
            then 'PASS readers cannot write purchases directly' else 'FAIL reader inserted a purchase' end;
select case when public.t_try($q$insert into public.reward_shares (user_id, book_id) values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000b001')$q$) like 'BLOCKED%'
            then 'PASS readers cannot add shares directly' else 'FAIL reader inserted shares' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa'); set role authenticated;
select case when (public.reward_status('00000000-0000-4000-8000-00000000b001') ->> 'available')::int = 0
            then 'PASS rewards are per reader' else 'FAIL other reader sees rewards' end;
reset role; select pg_temp.as_user(null); set role anon;
select case when public.t_try($q$select public.claim_reward_chapter('00000000-0000-4000-8000-0000000c0003')$q$) like 'BLOCKED%'
            then 'PASS visitors cannot claim' else 'FAIL visitor claimed' end;

-- spoiler-safe stamps
reset role;
insert into public.reading_progress (user_id, book_id, chapter_number) values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000b001', 4);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa'); set role authenticated;
insert into public.comments (book_id, chapter_id, body) values ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000c0001', 'Wait until chapter four!!');
select case when (select reader_chapter from public.comments where body like 'Wait until%') = 4
            then 'PASS comment remembers the writer reached chapter 4' else 'FAIL comment stamp' end;
select (public.create_thread('00000000-0000-4000-8000-00000000b001', 'Theory', 'Big twist', false)).id is not null;
reset role;
select case when (select reader_chapter from public.discussion_threads where title = 'Theory') = 4
            then 'PASS discussion post remembers the writer''s chapter' else 'FAIL thread stamp' end;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
insert into public.comments (book_id, chapter_id, body) values ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000c0002', 'No progress saved yet here');
reset role;
select case when (select reader_chapter from public.comments where body like 'No progress%') = 2
            then 'PASS without progress, the comment''s own chapter is used' else 'FAIL fallback stamp' end;
