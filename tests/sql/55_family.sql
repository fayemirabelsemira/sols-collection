-- Checks for sql/15 (family tree), run after sql/11
\set b '(select id::text from public.books where title ilike ''%seven swords%'')'
select case when public.get_family(:b, 49)::text !~* 'twin' and public.get_family(:b, 50)::text ~* 'twin'
  then 'PASS family: twin hidden until ch50' else 'FAIL family twin spoiler' end;
select case when public.get_family(:b, 52)::text !~ 'Selene' and public.get_family(:b, 53)::text ~ 'Selene'
  then 'PASS family: Selene hidden until ch53' else 'FAIL family Selene spoiler' end;
select case when public.get_family(:b, 41)::text !~* 'not his blood' and public.get_family(:b, 42)::text ~* 'not his blood'
  then 'PASS family: Fiona reveal hidden until ch42' else 'FAIL family Fiona spoiler' end;
select case when public.get_family(:b, 38)::text !~* 'Aurelion' and public.get_family(:b, 39)::text ~* 'Aurelion'
  then 'PASS family: Yoseff house hidden until ch39' else 'FAIL family Yoseff spoiler' end;
select case when public.get_family(:b, 0) = '[]'::jsonb then 'PASS family: empty before ch1' else 'FAIL family ch0' end;
select case when not exists (
    select 1 from public.family_tree f where f.book_id = :b and f.kind in ('tie', 'parent')
       and not exists (select 1 from public.characters c where c.book_id = :b and c.name = f.related))
  then 'PASS family: every tie points at a real card' else 'FAIL family tie name' end;
select case when has_table_privilege('anon', 'public.family_tree', 'select') = false
  then 'PASS family: table not readable directly' else 'FAIL family table open' end;
select case when public.get_family(:b, 28)::text !~ 'Kaiden' and public.get_family(:b, 29)::text ~ 'Kaiden'
  then 'PASS family: Kaiden hidden until ch29' else 'FAIL family Kaiden spoiler' end;
