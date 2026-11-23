-- =========================================================
-- Sol: the author's own comments on "Princess and the Seven Swords"
--   Run in Supabase -> SQL Editor. One transaction.
--   Safe to run again: a comment the author already posted on a chapter
--   is skipped, not doubled.
--
--   Posted from the book owner's account (the author), shown as
--   "<pen name> · Author", so readers can see it's the author.
--   Lines that only make sense from a stranger ("FROM X", "from your feed
--   sa watty", "Author-nim aminin", "paupdate") are left out.
--   Each comment is stamped as read up to its own chapter, so it never
--   counts as a spoiler for readers.
-- =========================================================

begin;

do $$
declare
  v_book uuid;
  v_owner uuid;
  v_name text;
  n_books int;
  n_new int := 0;
  r record;
  t text;
begin
  select count(*), min(b.id::text)::uuid into n_books, v_book
    from public.books b where b.title ilike '%seven swords%';
  if n_books <> 1 then
    raise exception 'STOPPED, nothing changed: % books match "Seven Swords". Put the right book id in v_book by hand.', n_books;
  end if;
  select b.owner_id, coalesce(nullif(btrim(b.author), ''), 'Author') into v_owner, v_name
    from public.books b where b.id = v_book;
  if v_owner is null then
    raise exception 'STOPPED, nothing changed: the book has no owner account to post from.';
  end if;
  v_name := v_name || ' · Author';

  -- post as the owner: the insert triggers take the poster from auth.uid()
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- the "commenting too fast" check would stop the 2nd of 37 posts made in the same instant.
  -- Switch only that trigger off here; it is switched back on below, and if anything fails
  -- the whole transaction (the switch-off included) is rolled back.
  for t in select tg.tgname from pg_trigger tg
            where tg.tgrelid = 'public.comments'::regclass and not tg.tgisinternal
              and tg.tgfoid = 'public.comments_before_insert'::regproc loop
    execute format('alter table public.comments disable trigger %I', t);
  end loop;

  for r in
    select x.n, x.body, ch.id as chapter_id
      from (values
        (1, 'sige ghurl ikaw na matalino'),
        (1, 'may DALAWANG lalaki?? HAHAHAHA ano ''to, girl💀 WHAHAHAHAHA BETT!!'),
        (2, 'NavyYYY'),
        (3, 'okayy im hooked'),
        (3, 'Xenon. Kadiri ka, kuya.'),
        (4, 'hueyy zayair 😂 Pero bakit ako kinikilig??'),
        (4, 'halo halo emosyon here'),
        (4, 'Recommend ko ''to.'),
        (5, 'Akira ang inosente ng mukha, ang lason ng ugali 😤'),
        (5, 'ZAYAIR with fiona?! Yuck 😭'),
        (5, 'Sino si Koa?? Abangers.'),
        (6, 'KOA VERSAILLES my boii!! Fire boy.'),
        (7, 'Super recommend, ang tight ng plot.'),
        (8, 'ang ganda ng tandem ni curtis at hestia likee its screaming Legendary Loverss'),
        (9, 'TINULAK NIYA SI NAVY SA BANGIN?!?! CURTIS?!?! Tapos sinalo din pala 😭 ang gulo mo.'),
        (9, 'Crybaby ang criinge pero 😭😭 Kinilig ako sa nickname SHUTA pasuntok SHEA!!'),
        (10, 'Sino yung grey-haired, green-eyed knight?? Bagong lalaki unlocked.'),
        (10, 'Abangers sa next chapter.'),
        (12, 'hi po recommend! Bawat chapter may twist...'),
        (14, 'Daddy issues to the max.'),
        (16, 'Sinakal ni Koa si Navyyy naiintindihan ko pero ang sakit.'),
        (17, '😭😭😭 Nagkaroon sila ng anak in one chapter HAHAHAHA.'),
        (19, '"My man." HESTIA SAID WHAT SHE SAID. teeam curtis. Anne Curtis. nyahahahahaha!'),
        (25, 'Pati isda nalason ni Akira, grabe ka 😤'),
        (28, 'Sino yung white-haired, gold-eyed stranger na nagpapagaling ng puno? Another ml ba'),
        (30, 'Inaresto si Curtis 😭 hindi ako handa.'),
        (33, 'Kinakabahan na ako sa ending.'),
        (47, 'Pinsan pala ni Curtis si Yoseff 😂 family reunion ng mga pogi.'),
        (47, 'Pinakakinikilig ako sa buong libro dito. Super recommend!!'),
        (49, 'TWINS?!?!'),
        (49, 'Hindi ako makatulog dahil dito.'),
        (50, 'KAMBAL SILA. WHAHAHAHAH PUYAWAA😭.'),
        (53, 'Nagluksa si Adelion para sa Hestia 🥺'),
        (54, 'Queen era 👑'),
        (54, 'Super recommend ang buong libro. Isa sa pinakamagandang nabasa ko.'),
        (55, '"I love you." Curtis at Navy 😭💙'),
        (55, 'Tapos na pero hindi pa ako handa. 10/10, super recommend sa lahat 🗡️👑')
      ) as x(n, body)
      join public.chapters ch on ch.book_id = v_book and ch.chapter_number = x.n
  loop
    continue when exists (select 1 from public.comments c
                           where c.chapter_id = r.chapter_id::text and c.user_id = v_owner and c.body = r.body);
    -- the switched-off trigger would set user_id and trim the text; do it here
    insert into public.comments (book_id, chapter_id, user_id, parent_id, author_name, body)
    values (v_book::text, r.chapter_id::text, v_owner, null, v_name, btrim(r.body));
    n_new := n_new + 1;
  end loop;

  for t in select tg.tgname from pg_trigger tg
            where tg.tgrelid = 'public.comments'::regclass and not tg.tgisinternal
              and tg.tgfoid = 'public.comments_before_insert'::regproc loop
    execute format('alter table public.comments enable trigger %I', t);
  end loop;

  -- the insert trigger stamps how far the poster has read; the author has read
  -- everything, so set it to the comment's own chapter to keep it spoiler-safe
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'comments' and column_name = 'reader_chapter') then
    update public.comments c set reader_chapter = ch.chapter_number
      from public.chapters ch
     where c.user_id = v_owner and c.book_id = v_book::text and ch.id::text = c.chapter_id
       and c.author_name = v_name;
  end if;

  raise notice 'Seven Swords: % author comments posted as "%".', n_new, v_name;
end
$$;

commit;
