-- =========================================================
-- Sol: edit character cards (and their photo) in the Writer's Studio
--   Run in Supabase -> SQL Editor AFTER sql/07 and sql/11. One transaction.
--   Safe to run again.
--
--   A writer can list, add, edit and delete the cards of their OWN books
--   (the Sol admin can do it for every book). Facts and the family tree
--   are not edited here (deleting a card also deletes its facts).
--   Photos are uploaded by the site to the sol-images bucket (sql/08);
--   only the https link is stored, in characters.portrait_url, which is
--   the column the readers' cards already show.
-- =========================================================

begin;

-- an earlier draft of this file saved photos in a new "portrait" column that
-- readers never see; move any photo saved there and drop that column
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'characters' and column_name = 'portrait') then
    update public.characters set portrait_url = portrait
     where portrait is not null and portrait <> '' and coalesce(portrait_url, '') = '';
    alter table public.characters drop column portrait;
  end if;
end $$;

-- the book must belong to the caller (or the caller is the Sol admin)
create or replace function public.author_owns_book_text(p_book_id text)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.author_can_write() and exists (
    select 1 from public.books b
     where b.id::text = p_book_id and (b.owner_id = auth.uid() or public.sol_is_admin()));
$function$;
revoke all on function public.author_owns_book_text(text) from public, anon, authenticated;

create or replace function public.author_list_characters(p_book_id text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.author_owns_book_text(p_book_id) then raise exception 'Not your book'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'title', c.title, 'aliases', c.aliases,
           'accent', c.accent, 'first_chapter', c.first_chapter, 'portrait', c.portrait_url)
           order by c.sort, c.first_chapter, c.name)
         from public.characters c where c.book_id = p_book_id), '[]'::jsonb);
end
$function$;

drop function if exists public.author_save_character(text, uuid, text, text, text[], text, integer, text);
create function public.author_save_character(
  p_book_id text, p_id uuid, p_name text, p_title text, p_aliases text[],
  p_accent text, p_first_chapter integer, p_portrait text)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_title text := nullif(left(btrim(coalesce(p_title, '')), 200), '');
  v_aliases text[] := coalesce((select array_agg(left(btrim(a), 120)) from unnest(p_aliases) a where btrim(a) <> ''), '{}'::text[]);
  v_portrait text := nullif(btrim(coalesce(p_portrait, '')), '');
begin
  if not public.author_owns_book_text(p_book_id) then raise exception 'Not your book'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'Give the character a name (up to 120 letters).'; end if;
  if coalesce(p_accent, '') !~* '^#[0-9a-f]{6}$' then raise exception 'Colour must look like #d4af37'; end if;
  if v_portrait is not null and (v_portrait !~* '^https://' or length(v_portrait) > 1000) then
    raise exception 'Photo must be an https:// link';
  end if;
  if p_first_chapter is null or p_first_chapter < 1 or p_first_chapter > 10000 then
    raise exception 'First chapter must be 1 or more';
  end if;
  if p_id is null then
    insert into public.characters (book_id, name, title, aliases, accent, first_chapter, portrait_url, sort)
    values (p_book_id, v_name, v_title, v_aliases, p_accent, p_first_chapter, v_portrait,
            coalesce((select max(sort) + 1 from public.characters where book_id = p_book_id), 1))
    returning id into v_id;
  else
    update public.characters
       set name = v_name, title = v_title, aliases = v_aliases, accent = p_accent,
           first_chapter = p_first_chapter, portrait_url = v_portrait
     where id = p_id and book_id = p_book_id
    returning id into v_id;
    if v_id is null then raise exception 'Character not found in this book'; end if;
  end if;
  return v_id;
end
$function$;

create or replace function public.author_delete_character(p_book_id text, p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.author_owns_book_text(p_book_id) then raise exception 'Not your book'; end if;
  delete from public.characters where id = p_id and book_id = p_book_id;
  if not found then raise exception 'Character not found in this book'; end if;
end
$function$;

revoke all on function public.author_list_characters(text) from public, anon;
revoke all on function public.author_save_character(text, uuid, text, text, text[], text, integer, text) from public, anon;
revoke all on function public.author_delete_character(text, uuid) from public, anon;
grant execute on function public.author_list_characters(text) to authenticated;
grant execute on function public.author_save_character(text, uuid, text, text, text[], text, integer, text) to authenticated;
grant execute on function public.author_delete_character(text, uuid) to authenticated;

do $$ begin
  raise notice 'Character card editing is on.';
end $$;

commit;
