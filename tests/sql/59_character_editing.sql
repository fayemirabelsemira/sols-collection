-- Checks for sql/22 (editing character cards in the Writer's Studio), after sql/07 + codex tables
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); end $$;
create or replace function pg_temp.refused(sql text, want text) returns text language plpgsql as $$
begin execute sql; return 'FAIL ' || want;
exception when others then
  return case when sqlerrm ~* want then 'PASS characters refused: ' || want else 'FAIL ' || want || ' (got: ' || sqlerrm || ')' end;
end $$;

select case when (select portrait_url from public.characters where name = 'Draft photo') = 'https://img.example/draft.jpg'
    and not exists (select 1 from information_schema.columns where table_name = 'characters' and column_name = 'portrait')
  then 'PASS characters: photo saved by the earlier draft moved to portrait_url' else 'FAIL draft photo not moved' end;

-- writer B makes a book, then a card with a photo
select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select (public.author_upsert_book(null, 'Card Book', 'Reader B', 'Romance', 'd', null, 0)).id as cbook \gset
select public.author_save_character(:'cbook', null, '  Navy ', 'Third Princess', array[' Hestia ', ''], '#aa3355', 1,
  'https://img.example/navy.jpg') as navy \gset
select case when (select count(*) from jsonb_array_elements(public.author_list_characters(:'cbook')) c
                   where c->>'name' = 'Navy' and c->>'portrait' = 'https://img.example/navy.jpg'
                     and c->'aliases' = '["Hestia"]'::jsonb) = 1
  then 'PASS characters: writer adds a card with a photo' else 'FAIL add card' end;
reset role;
select case when (select c->>'portrait' from jsonb_array_elements(public.get_codex(:'cbook', 1)) c where c->>'name' = 'Navy')
                 = 'https://img.example/navy.jpg'
  then 'PASS characters: readers'' cards show the new photo' else 'FAIL readers do not see the photo' end;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select public.author_save_character(:'cbook', :'navy', 'Navy', '', '{}', '#aa3355', 2, '');
select case when (select c->>'portrait' is null and c->>'title' is null and (c->>'first_chapter')::int = 2
                    from jsonb_array_elements(public.author_list_characters(:'cbook')) c where c->>'name' = 'Navy')
  then 'PASS characters: edit saves, photo can be removed' else 'FAIL edit card' end;
select pg_temp.refused(format('select public.author_save_character(%L, null, ''X'', null, null, ''#aa3355'', 1, ''http://plain.example/x.jpg'')', :'cbook'), 'https');
select pg_temp.refused(format('select public.author_save_character(%L, null, ''  '', null, null, ''#aa3355'', 1, null)', :'cbook'), 'name');
select pg_temp.refused(format('select public.author_save_character(%L, null, ''X'', null, null, ''red'', 1, null)', :'cbook'), 'Colour');
select pg_temp.refused(format('select public.author_save_character(%L, gen_random_uuid(), ''X'', null, null, ''#aa3355'', 1, null)', :'cbook'), 'not found');

-- someone else can't see, edit or delete writer B's cards
reset role; select pg_temp.as_user('00000000-0000-4000-8000-0000000000aa'); set role authenticated;
select pg_temp.refused(format('select public.author_list_characters(%L)', :'cbook'), 'Not your book');
select pg_temp.refused(format('select public.author_save_character(%L, %L, ''Hacked'', null, null, ''#aa3355'', 1, null)', :'cbook', :'navy'), 'Not your book');
select pg_temp.refused(format('select public.author_delete_character(%L, %L)', :'cbook', :'navy'), 'Not your book');
-- and a card from another book can't be edited through your own book
select (public.author_upsert_book(null, 'A Book', 'Mallory', 'Romance', 'd', null, 0)).id as dbook \gset
select pg_temp.refused(format('select public.author_save_character(%L, %L, ''Hacked'', null, null, ''#aa3355'', 1, null)', :'dbook', :'navy'), 'not found');
reset role; select pg_temp.as_user(null); set role anon;
select pg_temp.refused(format('select public.author_list_characters(%L)', :'cbook'), 'permission denied');
reset role;
select case when (select name from public.characters where id = :'navy') = 'Navy'
  then 'PASS characters: nobody else changed the card' else 'FAIL card changed by someone else' end;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000bb'); set role authenticated;
select public.author_delete_character(:'cbook', :'navy');
reset role;
select case when not exists (select 1 from public.characters where id = :'navy')
  then 'PASS characters: writer deletes a card' else 'FAIL delete card' end;
