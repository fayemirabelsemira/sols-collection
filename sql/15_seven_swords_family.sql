-- =========================================================
-- Sol: family tree for "Princess and the Seven Swords"
--   Run in Supabase -> SQL Editor AFTER sql/11. One transaction.
--   Safe to run again: it rewrites only this book's tree.
--
--   Readers open it from the Characters sheet ("Family tree").
--   Like the cards, every person and tie unlocks at the chapter that
--   reveals it: get_family only returns rows up to the reader's chapter.
--   kind 'member' = a person placed in a house (gen 0 = parents, 1 = children)
--   kind 'parent' = solid arrow, parent (name) -> child (related), inside house
--   kind 'tie'    = dashed labelled line between two people, often across
--                   houses; house = where the first person sits when they
--                   appear in two houses (Navy)
-- =========================================================

begin;

create table if not exists public.family_tree (
  id uuid primary key default gen_random_uuid(),
  book_id text not null,
  kind text not null check (kind in ('member', 'tie', 'parent')),
  house text,
  gen int not null default 0,
  name text not null,
  related text,
  note text,
  unlock_chapter int not null default 1,
  sort int not null default 0);
-- tables made by the first version of this file only allowed member/tie
alter table public.family_tree drop constraint if exists family_tree_kind_check;
alter table public.family_tree add constraint family_tree_kind_check check (kind in ('member', 'tie', 'parent'));
create index if not exists family_tree_book on public.family_tree (book_id, unlock_chapter);

-- readers never touch the table directly; they go through get_family
alter table public.family_tree enable row level security;
revoke all on public.family_tree from anon, authenticated;

create or replace function public.get_family(p_book_id text, p_up_to integer)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', f.kind, 'house', f.house, 'gen', f.gen, 'name', f.name,
           'related', f.related, 'note', f.note)
         order by f.sort, f.gen, f.unlock_chapter), '[]'::jsonb)
  from public.family_tree f
  where f.book_id = p_book_id and f.unlock_chapter <= p_up_to;
$function$;
revoke all on function public.get_family(text, integer) from public;
grant execute on function public.get_family(text, integer) to anon, authenticated;

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

  delete from public.family_tree where book_id = v_book;

  insert into public.family_tree (book_id, kind, house, gen, name, related, note, unlock_chapter, sort) values
    (v_book, 'member', 'House Alastair · The Dark Castle', 0, 'The Dark Lord', null, 'Ruler of the Dark Castle', 4, 1),
    (v_book, 'member', 'House Alastair · The Dark Castle', 0, 'Selene', null, 'Former Queen', 53, 2),
    (v_book, 'member', 'House Alastair · The Dark Castle', 1, 'Xenon', null, 'Crown Prince', 2, 3),
    (v_book, 'member', 'House Alastair · The Dark Castle', 1, 'Fiona', null, 'First Princess', 2, 4),
    (v_book, 'member', 'House Alastair · The Dark Castle', 1, 'Akira', null, 'Second Princess', 2, 5),
    (v_book, 'member', 'House Alastair · The Dark Castle', 1, 'Hestia', null, 'Third Princess', 2, 6),
    (v_book, 'member', 'House Alastair · The Dark Castle', 1, 'Navy Laurier', null, 'Hestia''s twin, hidden at birth', 50, 7),
    (v_book, 'member', 'The Lauriers · Mortal World', 0, 'Navy''s parents', null, 'Mortal world', 1, 8),
    (v_book, 'member', 'The Lauriers · Mortal World', 1, 'Navy Laurier', null, 'Woke up as Hestia', 1, 9),
    (v_book, 'member', 'The Lauriers · Mortal World', 1, 'Nick', null, 'Little brother', 1, 10),
    (v_book, 'member', 'House Versailles', 1, 'Koa Versailles', null, 'Hestia''s knight', 5, 11),
    (v_book, 'member', 'House Gauthier', 0, 'Adelion Gauthier', null, 'Last of his house', 6, 12),
    (v_book, 'member', 'House Gauthier', 1, 'Nico', null, 'Nine-Tailed Fox', 20, 13),
    (v_book, 'member', 'The Lost Empire', 0, 'Curtis''s parents', null, 'Held at the Kennel', 44, 14),
    (v_book, 'member', 'The Lost Empire', 1, 'Curtis', null, 'First Prince', 3, 15),
    (v_book, 'member', 'The Lost Empire', 1, 'Hyacinth', null, 'Younger sister', 21, 16),
    (v_book, 'member', 'House Aurelion · Skye Empire', 0, 'King of Aurelion', null, 'Skye Empire', 39, 17),
    (v_book, 'member', 'House Aurelion · Skye Empire', 0, 'Medea Aithera', null, 'Dusk · Yoseff''s mother', 47, 18),
    (v_book, 'member', 'House Aurelion · Skye Empire', 1, 'Yoseff', null, 'First Prince of Aurelion', 39, 19),
    (v_book, 'parent', 'House Alastair · The Dark Castle', 0, 'The Dark Lord', 'Xenon', null, 4, 20),
    (v_book, 'parent', 'House Alastair · The Dark Castle', 0, 'The Dark Lord', 'Fiona', null, 4, 21),
    (v_book, 'parent', 'House Alastair · The Dark Castle', 0, 'The Dark Lord', 'Hestia', null, 4, 22),
    (v_book, 'parent', 'House Alastair · The Dark Castle', 0, 'The Dark Lord', 'Navy Laurier', null, 50, 23),
    (v_book, 'parent', 'House Alastair · The Dark Castle', 0, 'Selene', 'Hestia', null, 53, 24),
    (v_book, 'parent', 'House Alastair · The Dark Castle', 0, 'Selene', 'Navy Laurier', null, 53, 25),
    (v_book, 'parent', 'The Lauriers · Mortal World', 0, 'Navy''s parents', 'Navy Laurier', null, 1, 26),
    (v_book, 'parent', 'The Lauriers · Mortal World', 0, 'Navy''s parents', 'Nick', null, 1, 27),
    (v_book, 'parent', 'The Lost Empire', 0, 'Curtis''s parents', 'Curtis', null, 44, 28),
    (v_book, 'parent', 'The Lost Empire', 0, 'Curtis''s parents', 'Hyacinth', null, 44, 29),
    (v_book, 'parent', 'House Aurelion · Skye Empire', 0, 'King of Aurelion', 'Yoseff', null, 39, 30),
    (v_book, 'parent', 'House Aurelion · Skye Empire', 0, 'Medea Aithera', 'Yoseff', null, 47, 31),
    (v_book, 'parent', 'House Gauthier', 0, 'Adelion Gauthier', 'Nico', 'Dada', 20, 32),
    (v_book, 'tie', 'The Lauriers · Mortal World', 0, 'Navy Laurier', 'Hestia', 'Soul in her body', 2, 33),
    (v_book, 'tie', null, 0, 'Koa Versailles', 'Akira', 'Cousins', 14, 34),
    (v_book, 'tie', null, 0, 'Nico', 'Navy Laurier', 'Momma', 20, 35),
    (v_book, 'tie', null, 0, 'Kaiden Lucas', 'Curtis', 'Best friends', 29, 36),
    (v_book, 'tie', null, 0, 'Rhaegan Targaven', 'Xenon', 'Xenon''s Hound', 33, 37),
    (v_book, 'tie', null, 0, 'Hestia', 'Adelion Gauthier', 'Lost their child', 38, 38),
    (v_book, 'tie', null, 0, 'Fiona', 'The Dark Lord', 'Not his blood', 42, 39),
    (v_book, 'tie', null, 0, 'Medea Aithera', 'Curtis', 'Aunt', 47, 40),
    (v_book, 'tie', null, 0, 'Curtis', 'Yoseff', 'Cousins', 47, 41),
    (v_book, 'tie', 'House Alastair · The Dark Castle', 0, 'Navy Laurier', 'Hestia', 'Twins', 50, 42);

  raise notice 'Seven Swords family tree: % rows written.',
    (select count(*) from public.family_tree where book_id = v_book);
end
$$;

commit;
