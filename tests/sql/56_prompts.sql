-- Checks for sql/16 (chapter prompts), run after it has been applied twice
\set b '(select id::text from public.books where title ilike ''%seven swords%'')'
select case when (select count(*) from public.chapter_prompts where book_id = :b) = 54
  and not exists (select 1 from public.chapter_prompts where book_id = :b and chapter_number = 41)
  then 'PASS prompts: 54 chapters, none for missing ch41' else 'FAIL prompt count' end;
select case when public.get_chapter_prompt((select id from public.chapters where book_id::text = :b and chapter_number = 55)) ~* 'susunod na libro'
  then 'PASS prompts: chapter id finds its own prompt' else 'FAIL prompt lookup' end;
select case when public.get_chapter_prompt(gen_random_uuid()) is null
  then 'PASS prompts: unknown chapter gets nothing' else 'FAIL prompt unknown chapter' end;
select case when has_table_privilege('anon', 'public.chapter_prompts', 'select') = false
  then 'PASS prompts: table not readable directly' else 'FAIL prompts table open' end;
-- each prompt may only name people the cards have introduced by that chapter
select case when not exists (
    select 1 from public.chapter_prompts p join public.characters c on c.book_id = p.book_id
     where p.book_id = :b and c.first_chapter > p.chapter_number
       and p.prompt ~ ('(^|[^[:alpha:]])' || split_part(c.name, ' ', 1) || '([^[:alpha:]]|$)'))
  then 'PASS prompts: no character named before their card unlocks' else 'FAIL prompts name a character too early' end;
