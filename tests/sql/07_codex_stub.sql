-- Character cards + recaps tables, shaped like the live project
-- (CSV export from sql/09, 16 Nov 2026). Local tests only.
create table public.characters (
  id uuid primary key default gen_random_uuid(), book_id text not null, name text not null,
  aliases text[] not null default '{}'::text[], title text, portrait_url text,
  accent text default '#d4af37'::text, first_chapter integer not null default 1, sort integer not null default 0);
create table public.character_facts (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  unlock_chapter integer not null default 1,
  kind text not null check (kind = any (array['trait', 'about', 'relationship'])),
  text text not null,
  related_character_id uuid references public.characters(id) on delete set null,
  sort integer not null default 0);
create table public.chapter_recaps (
  id uuid primary key default gen_random_uuid(), book_id text not null, chapter_number integer not null,
  title text, recap text not null, approved boolean not null default false,
  unique (book_id, chapter_number));

-- live copies
CREATE OR REPLACE FUNCTION public.get_codex(p_book_id text, p_up_to integer)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(s.c order by (s.c->>'sort')::int, s.c->>'name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', ch.id, 'name', ch.name, 'aliases', to_jsonb(ch.aliases), 'title', ch.title,
      'portrait', ch.portrait_url, 'accent', ch.accent, 'sort', ch.sort,
      'facts', coalesce((
        select jsonb_agg(jsonb_build_object('kind', f.kind, 'text', f.text, 'related', f.related_character_id)
                         order by f.unlock_chapter, f.sort)
        from public.character_facts f
        where f.character_id = ch.id and f.unlock_chapter <= p_up_to), '[]'::jsonb),
      'locked', (select count(*) from public.character_facts f
                 where f.character_id = ch.id and f.unlock_chapter > p_up_to)
    ) as c
    from public.characters ch
    where ch.book_id = p_book_id and ch.first_chapter <= p_up_to
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.get_recaps(p_book_id text, p_before integer, p_limit integer DEFAULT 3)
 RETURNS TABLE(chapter_number integer, title text, recap text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select r.chapter_number, r.title, r.recap
  from public.chapter_recaps r
  where r.book_id = p_book_id and r.approved and r.chapter_number < p_before
  order by r.chapter_number desc
  limit greatest(1, least(p_limit, 6));
$function$;
