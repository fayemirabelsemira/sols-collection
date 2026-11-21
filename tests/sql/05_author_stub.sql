-- Writer Studio functions copied verbatim from the live project (CSV export, 15 Nov 2026).
-- The two helpers below are NOT known; they are modelled in their WEAKEST form
-- ("any writer is an author of any book") so the tests prove sql/07 makes them strict.

create table if not exists public.app_admins (user_id uuid primary key);

create or replace function public.is_site_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.books where owner_id = auth.uid()) $$;

create or replace function public.is_book_author(p_book uuid) returns boolean language sql stable security definer set search_path = public as $$ select public.is_site_admin() $$;

CREATE OR REPLACE FUNCTION public.author_can_write()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_site_admin()
    or exists (
      select 1 from public.books b where b.owner_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.author_list_my_books()
 RETURNS TABLE(id uuid, title text, author text, genre text, description text, cover_url text, price numeric, total_chapters integer, views bigint, votes bigint, owner_id uuid, created_at timestamp with time zone, draft_count bigint, published_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    b.id,
    b.title,
    b.author,
    b.genre,
    b.description,
    b.cover_url,
    b.price,
    b.total_chapters,
    b.views,
    b.votes,
    b.owner_id,
    b.created_at,
    (select count(*) from public.chapters c
      where c.book_id = b.id and c.status = 'draft') as draft_count,
    (select count(*) from public.chapters c
      where c.book_id = b.id and c.status = 'published') as published_count
  from public.books b
  where
    public.is_site_admin()
    or b.owner_id = auth.uid()
  order by b.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.author_upsert_book(p_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text, p_author text DEFAULT NULL::text, p_genre text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_cover_url text DEFAULT NULL::text, p_price numeric DEFAULT NULL::numeric)
 RETURNS books
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.books;
begin
  if v_uid is null then
    raise exception 'Login required';
  end if;

  if p_id is null then
    if coalesce(trim(p_title), '') = '' then
      raise exception 'Title is required';
    end if;

    insert into public.books (
      title, author, genre, description, cover_url, price, owner_id, total_chapters, views, votes
    ) values (
      trim(p_title),
      coalesce(nullif(trim(p_author), ''), 'Sol'),
      coalesce(nullif(trim(p_genre), ''), 'Romance'),
      coalesce(p_description, ''),
      nullif(trim(p_cover_url), ''),
      case when p_price is not null and p_price > 0 then p_price else 150 end,
      v_uid,
      0,
      0,
      0
    )
    returning * into v_row;

    return v_row;
  end if;

  -- Update existing
  if not public.is_book_author(p_id) then
    raise exception 'Not allowed to edit this book';
  end if;

  update public.books
  set
    title       = coalesce(nullif(trim(p_title), ''), title),
    author      = coalesce(nullif(trim(p_author), ''), author),
    genre       = coalesce(nullif(trim(p_genre), ''), genre),
    description = coalesce(p_description, description),
    cover_url   = case
                    when p_cover_url is null then cover_url
                    when trim(p_cover_url) = '' then null
                    else trim(p_cover_url)
                  end,
    price       = case
                    when p_price is not null and p_price > 0 then p_price
                    else price
                  end
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.author_upsert_chapter(p_id uuid DEFAULT NULL::uuid, p_book_id uuid DEFAULT NULL::uuid, p_chapter_number integer DEFAULT NULL::integer, p_title text DEFAULT NULL::text, p_content text DEFAULT NULL::text, p_is_free boolean DEFAULT NULL::boolean, p_price numeric DEFAULT NULL::numeric, p_status text DEFAULT 'draft'::text)
 RETURNS chapters
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.chapters;
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'draft'));
  v_num integer;
  v_book uuid;
begin
  if v_uid is null then
    raise exception 'Login required';
  end if;

  if v_status not in ('draft', 'published') then
    raise exception 'Status must be draft or published';
  end if;

  if p_id is null then
    -- Create
    if p_book_id is null then
      raise exception 'book_id is required';
    end if;
    if not public.is_book_author(p_book_id) then
      raise exception 'Not allowed to edit this book';
    end if;

    v_num := p_chapter_number;
    if v_num is null or v_num < 1 then
      select coalesce(max(chapter_number), 0) + 1
        into v_num
      from public.chapters
      where book_id = p_book_id;
    end if;

    -- Avoid duplicate chapter numbers
    if exists (
      select 1 from public.chapters
      where book_id = p_book_id and chapter_number = v_num
    ) then
      raise exception 'Chapter % already exists for this book', v_num;
    end if;

    insert into public.chapters (
      book_id, chapter_number, title, content, price, is_free, status, updated_at
    ) values (
      p_book_id,
      v_num,
      coalesce(nullif(trim(p_title), ''), 'Chapter ' || v_num),
      coalesce(p_content, ''),
      case
        when coalesce(p_is_free, false) then 0
        when p_price is not null and p_price >= 0 then p_price
        else 10
      end,
      coalesce(p_is_free, v_num <= 5),
      v_status,
      now()
    )
    returning * into v_row;

  else
    -- Update
    select book_id into v_book from public.chapters where id = p_id;
    if v_book is null then
      raise exception 'Chapter not found';
    end if;
    if not public.is_book_author(v_book) then
      raise exception 'Not allowed';
    end if;

    update public.chapters
    set
      title          = coalesce(nullif(trim(p_title), ''), title),
      content        = coalesce(p_content, content),
      chapter_number = coalesce(p_chapter_number, chapter_number),
      is_free        = coalesce(p_is_free, is_free),
      price          = case
                         when p_is_free = true then 0
                         when p_price is not null and p_price >= 0 then p_price
                         else price
                       end,
      status         = v_status,
      updated_at     = now()
    where id = p_id
    returning * into v_row;
  end if;

  -- Keep books.total_chapters = count of published chapters
  update public.books
  set total_chapters = (
    select count(*)::integer from public.chapters
    where book_id = v_row.book_id and status = 'published'
  )
  where id = v_row.book_id;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.author_get_chapter(p_chapter_id uuid)
 RETURNS TABLE(id uuid, book_id uuid, chapter_number integer, title text, content text, price numeric, is_free boolean, status text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_book uuid;
begin
  select c.book_id into v_book from public.chapters c where c.id = p_chapter_id;
  if v_book is null then
    raise exception 'Chapter not found';
  end if;
  if not public.is_book_author(v_book) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    c.id, c.book_id, c.chapter_number, c.title, c.content,
    c.price, c.is_free, c.status, c.created_at, c.updated_at
  from public.chapters c
  where c.id = p_chapter_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.author_list_chapters(p_book_id uuid)
 RETURNS TABLE(id uuid, book_id uuid, chapter_number integer, title text, price numeric, is_free boolean, status text, content_preview text, content_length integer, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_book_author(p_book_id) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    c.id,
    c.book_id,
    c.chapter_number,
    c.title,
    c.price,
    c.is_free,
    c.status,
    left(coalesce(c.content, ''), 160) as content_preview,
    length(coalesce(c.content, ''))::integer as content_length,
    c.created_at,
    c.updated_at
  from public.chapters c
  where c.book_id = p_book_id
  order by c.chapter_number asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.author_set_chapter_status(p_chapter_id uuid, p_status text)
 RETURNS chapters
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.chapters;
  v_status text := lower(trim(p_status));
  v_book uuid;
begin
  if v_status not in ('draft', 'published') then
    raise exception 'Status must be draft or published';
  end if;

  select book_id into v_book from public.chapters where id = p_chapter_id;
  if v_book is null then
    raise exception 'Chapter not found';
  end if;
  if not public.is_book_author(v_book) then
    raise exception 'Not allowed';
  end if;

  update public.chapters
  set status = v_status, updated_at = now()
  where id = p_chapter_id
  returning * into v_row;

  update public.books
  set total_chapters = (
    select count(*)::integer from public.chapters
    where book_id = v_book and status = 'published'
  )
  where id = v_book;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.author_delete_chapter(p_chapter_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_book uuid;
begin
  select book_id into v_book
  from public.chapters where id = p_chapter_id;

  if v_book is null then
    raise exception 'Chapter not found';
  end if;
  if not public.is_book_author(v_book) then
    raise exception 'Not allowed';
  end if;

  delete from public.chapters where id = p_chapter_id;

  update public.books
  set total_chapters = (
    select count(*)::integer from public.chapters
    where book_id = v_book and status = 'published'
  )
  where id = v_book;

  return true;
end;
$function$;
