-- =========================================================
-- Sol: why can't guests post? (changes nothing)
--   Run in Supabase -> SQL Editor. It tries one guest comment and then
--   always undoes it, so nothing is posted. Copy the result row back.
-- =========================================================

create temp table if not exists guest_check (step text, result text);
truncate guest_check;

do $$
declare ch uuid;
begin
  select c.id into ch from public.chapters c join public.books b on b.id = c.book_id
   where not coalesce(b.is_hidden, false) order by c.created_at desc limit 1;
  begin
    perform public.post_guest_comment(ch, 'sol-check-device-0001', 'Checker', 'test only, undone');
    raise exception using errcode = 'SOLOK', message = 'it worked (undone)';
  exception when others then
    insert into guest_check values ('post', sqlstate || ': ' || sqlerrm);
  end;
end $$;

-- what else runs when a comment is saved
insert into guest_check
  select 'trigger', tg.tgname || ' -> ' || p.proname || (case when tg.tgenabled = 'D' then ' (OFF)' else '' end)
    from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
   where tg.tgrelid = 'public.comments'::regclass and not tg.tgisinternal;
insert into guest_check
  select 'link', conname || ': ' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid = 'public.comments'::regclass and contype in ('f', 'c');

select * from guest_check;
