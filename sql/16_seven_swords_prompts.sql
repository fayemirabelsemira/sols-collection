-- =========================================================
-- Sol: chapter prompts for "Princess and the Seven Swords"
--   Run in Supabase -> SQL Editor. One transaction. Safe to run again.
--
--   A prompt is one question shown above the comment box at the end of a
--   chapter, to get readers talking. Edit any line below before running.
--   Each prompt only mentions what its own chapter has revealed.
--   No Chapter 41 in the book; 55 is the Epilogue.
-- =========================================================

begin;

create table if not exists public.chapter_prompts (
  book_id text not null,
  chapter_number int not null,
  prompt text not null check (length(prompt) between 1 and 200),
  primary key (book_id, chapter_number));

-- readers never touch the table directly; they go through get_chapter_prompt
alter table public.chapter_prompts enable row level security;
revoke all on public.chapter_prompts from anon, authenticated;

-- shortcut: anyone holding a later chapter's id could read its prompt early;
-- fine while prompts stay spoiler-light, add a reading-progress check if they don't
create or replace function public.get_chapter_prompt(p_chapter_id uuid)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select p.prompt
  from public.chapters c
  join public.chapter_prompts p on p.book_id = c.book_id::text and p.chapter_number = c.chapter_number
  where c.id = p_chapter_id;
$function$;
revoke all on function public.get_chapter_prompt(uuid) from public;
grant execute on function public.get_chapter_prompt(uuid) to anon, authenticated;

do $$
declare
  v_book text;
  n_books int;
begin
  select count(*), min(b.id::text) into n_books, v_book
    from public.books b where b.title ilike '%seven swords%';
  if n_books <> 1 then
    raise exception 'STOPPED, nothing changed: % books match "Seven Swords". Put the right book id in v_book by hand.', n_books;
  end if;

  delete from public.chapter_prompts where book_id = v_book;

  insert into public.chapter_prompts (book_id, chapter_number, prompt) values
    (v_book, 1, 'May DALAWANG lalaki sa kama ni Navy 💀 Sino sa tingin niyo ang endgame?'),
    (v_book, 2, 'Kung ikaw si Navy, paano mo aayusin ang reputasyon ng "crazy" Third Princess?'),
    (v_book, 3, 'Curtis entrance 😳 Kayo ba, hooked na rin? Team Curtis na ba agad?'),
    (v_book, 4, 'Zayair o Adelion, sino ang mas nagpakilig sa inyo sa chapter na ''to? 😂'),
    (v_book, 5, 'Akira at yung cupcake 😤 Sino ang pinaka-red flag sa Dark Castle so far?'),
    (v_book, 6, 'KOA VERSAILLES is here 🔥 Team Koa na ba kayo?'),
    (v_book, 7, 'Matatanggal lang ang gorget sa "genuine love" 👀 Ano''ng hula niyo?'),
    (v_book, 8, 'Moonshard Peak with Curtis, date ba ''yon o hindi? 😏'),
    (v_book, 9, '"Crybaby" 😭 Cringe o kilig? Be honest!'),
    (v_book, 10, 'Sino yung grey-haired, green-eyed knight?? Hulaan niyo!'),
    (v_book, 11, '"He''s mine." Ilang beses niyo inulit ''yung line na ''yan? 😂'),
    (v_book, 12, 'Yung panaginip na mukha ni Navy ang nasa katawan ni Hestia… ano''ng ibig sabihin nito?'),
    (v_book, 13, 'Regalo "from Xenon" 🎁 Trust or red flag?'),
    (v_book, 14, 'Win or be fed to the Gloom Crawler 😭 Ano''ng masasabi niyo sa Dark Lord?'),
    (v_book, 15, '"You''re not her." Paano niyo naramdaman yung moment na ''yon kay Koa?'),
    (v_book, 16, 'Navy at Adelion vs Nine-Tailed Fox, best team-up ba? 🦊'),
    (v_book, 17, 'Momma at Dada 😭 Team Adelion ba kayo after this?'),
    (v_book, 18, '334 beast cores 😎 Kanino kayo pinaka-proud sa hunt na ''to?'),
    (v_book, 19, '"My man." 😳 Team Curtis, sound off! 🙋'),
    (v_book, 20, 'Alam pala ng Dark Lord ang totoo! Kakampi ba siya o kalaban?'),
    (v_book, 21, 'Balcony talk with Curtis 💙 Paborito niyong chapter so far?'),
    (v_book, 22, 'Adelion at ang "unborn child"… ano''ng nararamdaman niyo para sa kanya?'),
    (v_book, 23, '"I don''t remember." Kung ikaw si Navy, ano''ng sasabihin mo kay Adelion?'),
    (v_book, 24, 'Yung masked Executioner 😳 Kinakatakutan o inaabangan?'),
    (v_book, 25, 'Ice na hindi natutunaw 👀 Sino ang suspect niyo?'),
    (v_book, 26, 'Bakit kaya nakatitig yung grey-haired knight kay Nico? Theories!'),
    (v_book, 27, 'Zayair pala ang nagplano ng lahat 🤯 Nagbago ba tingin niyo sa kanya?'),
    (v_book, 28, 'Sino yung white-haired, gold-eyed stranger? Another male lead ba? 👀'),
    (v_book, 29, 'Binigay ni Curtis ang gem kay Lucas. Tama ba siya?'),
    (v_book, 30, 'Inaresto si Curtis 😭 Ano''ng gagawin ni Navy?'),
    (v_book, 31, '36 lashes para kay Curtis, 64 kay Adelion 😭 Sino ang mas nagpaiyak sa inyo?'),
    (v_book, 32, 'Silvencia blood, kayang buhayin ang patay pero may kapalit. Gagamitin niyo ba?'),
    (v_book, 33, 'Rhaegan the Hound is here 🐺 First impressions?'),
    (v_book, 34, 'Sino kaya yung kapatid sa likod ni Hestia sa alaala niya? Theories!'),
    (v_book, 35, 'Cassian unmasked 😳 Ano''ng tingin niyo sa kanya ngayon?'),
    (v_book, 36, 'Nakita ni Cassian si Hestia kasama si Akira sa lawa 👀 Ano''ng nangyari doon?'),
    (v_book, 37, 'Ang laki ng sinakripisyo ni Hestia para kay Adelion 😭 Paano niyo siya nakikita ngayon?'),
    (v_book, 38, 'Adelion, fourth sword na! 🗡️ Ilan na lang ang kulang?'),
    (v_book, 39, '"Your future husband." 😳 Team Yoseff, nandiyan ba kayo?'),
    (v_book, 40, 'Verdict kay Fiona bukas ng madaling araw. Ano''ng dapat mangyari sa kanya?'),
    (v_book, 42, 'Hinila si Curtis sa portal 😭 Ano''ng reaction niyo sa chapter na ''to?'),
    (v_book, 43, 'Swords assemble! 🗡️ Sino ang pinaka-gusto niyong kasama sa rescue?'),
    (v_book, 44, 'Ayaw pa maging sword ni Rhaegan 😂 Mapapapayag kaya siya?'),
    (v_book, 45, 'Alam ni Xenon na hindi siya ang kapatid niya 😳 Ano''ng susunod?'),
    (v_book, 46, 'KUMPLETO NA ANG SEVEN SWORDS 🗡️ Sino ang paborito niyo sa pito?'),
    (v_book, 47, 'Curtis at Navy, finally 😭💙 Pinakakilig na chapter ba ''to para sa inyo?'),
    (v_book, 48, 'Pinakain ni Navy kay Akira ang sariling cake 😂 Deserve?'),
    (v_book, 49, 'Isang babaeng may hawak na dalawang sanggol… ano''ng hula niyo?? 👀'),
    (v_book, 50, 'KAMBAL SILA 😭 Napansin niyo ba ang clues bago ''to?'),
    (v_book, 51, 'Kakayanin ba ni Navy? 😭 I-comment ang dasal niyo para sa kanya.'),
    (v_book, 52, 'Si Nick 😭 Ilang tissue ang naubos niyo sa chapter na ''to?'),
    (v_book, 53, 'Ano''ng nakasulat sa sulat ni Selene sa tingin niyo?'),
    (v_book, 54, 'Siya lang ang pipili 👑 Team Curtis, Koa, Adelion, Zayair, Yoseff, Cassian o Rhaegan?'),
    (v_book, 55, 'Tapos na 😭 Ano''ng gusto niyong makita sa susunod na libro?');

  raise notice 'Seven Swords: % chapter prompts written.',
    (select count(*) from public.chapter_prompts where book_id = v_book);
end
$$;

commit;
