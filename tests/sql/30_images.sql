-- Image upload rules (sql/08). Each line prints PASS or FAIL.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
create or replace function public.t_try(p_sql text) returns text language plpgsql as $$
declare n int;
begin execute p_sql; get diagnostics n = row_count; return 'ROWS ' || n;
exception when others then return 'BLOCKED'; end $$;
grant execute on function public.t_try(text) to anon, authenticated;
insert into auth.users (id, email_confirmed_at) values ('00000000-0000-4000-8000-0000000000cc', null) on conflict do nothing;
insert into storage.objects (bucket_id, name) values ('sol-images', '00000000-0000-4000-8000-0000000000ee/cover/sol.webp');

select case when (select public and file_size_limit = 5242880 from storage.buckets where id = 'sol-images')
            then 'PASS bucket is public-read with a 5 MB limit' else 'FAIL bucket settings' end;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when public.t_try($q$insert into storage.objects (bucket_id, name) values ('sol-images', '00000000-0000-4000-8000-0000000000bb/cover/a.webp')$q$) = 'ROWS 1'
            then 'PASS writer uploads into own folder' else 'FAIL writer cannot upload' end;
select case when public.t_try($q$insert into storage.objects (bucket_id, name) values ('sol-images', '00000000-0000-4000-8000-0000000000ee/cover/x.webp')$q$) = 'BLOCKED'
            then 'PASS cannot upload into another writer''s folder' else 'FAIL uploaded into another folder' end;
select case when public.t_try($q$insert into storage.objects (bucket_id, name) values ('sol-images', 'loose.webp')$q$) = 'BLOCKED'
            then 'PASS cannot upload outside a folder' else 'FAIL uploaded outside a folder' end;
select case when public.t_try($q$delete from storage.objects where name like '00000000-0000-4000-8000-0000000000ee/%'$q$) in ('ROWS 0', 'BLOCKED')
            then 'PASS cannot delete another writer''s image' else 'FAIL deleted another writer''s image' end;
select case when public.t_try($q$update storage.objects set name = '00000000-0000-4000-8000-0000000000bb/x.webp' where name like '00000000-0000-4000-8000-0000000000ee/%'$q$) in ('ROWS 0', 'BLOCKED')
            then 'PASS cannot take another writer''s image' else 'FAIL moved another writer''s image' end;
select case when (select count(*) from storage.objects) = 1
            then 'PASS writer lists only own files' else 'FAIL writer sees other files' end;
select case when public.t_try($q$delete from storage.objects where name = '00000000-0000-4000-8000-0000000000bb/cover/a.webp'$q$) = 'ROWS 1'
            then 'PASS writer deletes own image' else 'FAIL writer cannot delete own image' end;
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000cc'); set role authenticated;
select case when public.t_try($q$insert into storage.objects (bucket_id, name) values ('sol-images', '00000000-0000-4000-8000-0000000000cc/a.webp')$q$) = 'BLOCKED'
            then 'PASS unconfirmed email cannot upload' else 'FAIL unconfirmed email uploaded' end;
reset role; select pg_temp.as_user(null); set role anon;
select case when public.t_try($q$insert into storage.objects (bucket_id, name) values ('sol-images', 'x/a.webp')$q$) = 'BLOCKED'
            then 'PASS visitors cannot upload' else 'FAIL visitor uploaded' end;
reset role;
insert into public.sol_blocked_writers (user_id) values ('00000000-0000-4000-8000-0000000000bb');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select case when public.t_try($q$insert into storage.objects (bucket_id, name) values ('sol-images', '00000000-0000-4000-8000-0000000000bb/b.webp')$q$) = 'BLOCKED'
            then 'PASS blocked writer cannot upload' else 'FAIL blocked writer uploaded' end;
