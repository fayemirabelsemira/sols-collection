-- Checks for sql/11 (run after it has been applied with replace_cards := true)
\set b '(select id::text from public.books where title ilike ''%seven swords%'')'
select case when (select count(*) from public.characters where book_id = :b) = 20
  then 'PASS sql/11 writes 20 cards' else 'FAIL card count' end;
select case when (select count(*) from public.characters where book_id = :b and name = 'Old card') = 0
  then 'PASS old cards replaced' else 'FAIL old cards still there' end;
select case when (select count(*) from public.character_facts f join public.characters c on c.id = f.character_id where c.book_id = :b) = 144
  then 'PASS 144 facts' else 'FAIL fact count' end;
select case when (select count(*) from public.chapter_recaps where book_id = :b and approved) = 54
  and not exists (select 1 from public.chapter_recaps where book_id = :b and chapter_number = 41)
  then 'PASS 54 approved recaps, none for missing ch41' else 'FAIL recaps' end;
select case when (select title from public.chapter_recaps where book_id = :b and chapter_number = 55) = 'Epilogue'
  then 'PASS recap 55 takes the chapter title (Epilogue)' else 'FAIL recap title' end;
-- spoiler safety through get_codex
select case when (select string_agg(x->>'name', ',' order by x->>'name') from jsonb_array_elements(public.get_codex(:b, 1)) x) = 'Navy Laurier,Nick'
  then 'PASS ch1 shows only Navy and Nick' else 'FAIL ch1 cards' end;
select case when public.get_codex(:b, 49)::text !~* 'twin' and public.get_codex(:b, 50)::text ~* 'twin'
  then 'PASS twin reveal hidden until ch50' else 'FAIL twin spoiler' end;
select case when public.get_codex(:b, 34)::text !~ 'Cassian' and public.get_codex(:b, 35)::text ~ 'Cassian'
  then 'PASS Executioner name hidden until ch35' else 'FAIL Cassian spoiler' end;
select case when public.get_codex(:b, 38)::text !~* 'Aurelion' and public.get_codex(:b, 39)::text ~* 'Aurelion'
  then 'PASS Yoseff prince reveal hidden until ch39' else 'FAIL Yoseff spoiler' end;
select case when not exists (
    select 1 from public.character_facts f join public.characters c on c.id = f.character_id
     where c.book_id = :b and f.unlock_chapter < c.first_chapter)
  then 'PASS no fact unlocks before its card' else 'FAIL fact before card' end;
select case when (select count(*) from public.character_facts f join public.characters c on c.id = f.character_id
                   where c.book_id = :b and f.kind = 'relationship' and f.related_character_id is null) = 0
  then 'PASS every relationship links a character' else 'FAIL unlinked relationship' end;
-- recaps never show the chapter you're on or later
select case when (select max(chapter_number) from public.get_recaps(:b, 10, 6)) = 9
  and (select count(*) from public.get_recaps(:b, 1, 6)) = 0
  then 'PASS recaps stop before the current chapter' else 'FAIL recap spoiler' end;
select case when not exists (select 1 from public.characters where book_id = :b
    and (aliases && array['Ace','Ash','Blondie'] or title ilike '%strategist%'))
  then 'PASS card names, aliases and titles carry no later reveals' else 'FAIL spoiler in card header' end;
