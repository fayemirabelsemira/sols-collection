-- Live-shaped comments / purchases / reading_progress (from the sql/09 export, 16 Nov 2026).
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated;
alter table public.purchases add column if not exists amount numeric(10,2) not null default 0,
  add column if not exists payment_reference text, add column if not exists purchased_at timestamptz default now();
alter table public.purchases alter column purchase_type set default 'chapter', alter column payment_status set default 'pending';
alter table public.purchases add constraint purchases_user_id_chapter_id_key unique (user_id, chapter_id);
alter table public.purchases enable row level security;
create policy "Users can view their own purchases" on public.purchases for select to authenticated using (auth.uid() = user_id);
create table public.comments (
  id uuid primary key default gen_random_uuid(), book_id text not null, chapter_id text not null,
  user_id uuid not null default auth.uid(), parent_id uuid references public.comments(id) on delete cascade,
  author_name text not null default 'Reader', body text not null check (char_length(btrim(body)) between 1 and 1000),
  like_count int not null default 0, created_at timestamptz not null default now());
alter table public.comments enable row level security;
create policy "comments are public" on public.comments for select to anon, authenticated using (true);
create policy "logged in users can comment" on public.comments for insert to authenticated with check (auth.uid() = user_id);
create or replace function public.comments_before_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in to comment.'; end if;
  new.user_id := auth.uid(); new.body := btrim(new.body); new.like_count := 0;
  if new.created_at is null then new.created_at := now(); end if;
  return new;
end $$;
create trigger trg_comments_before_insert before insert on public.comments for each row execute function public.comments_before_insert();
create table public.reading_progress (id uuid primary key default gen_random_uuid(), user_id uuid not null, book_id uuid not null,
  chapter_id uuid, chapter_number int, unique (user_id, book_id));
alter table public.reading_progress enable row level security;
create policy "progress own" on public.reading_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
