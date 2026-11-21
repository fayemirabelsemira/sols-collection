-- Sol: count views from readers who aren't logged in (one per device per book).
-- Run once in the Supabase SQL editor. Logged-in views still use increment_views().
-- Note: a device id is made by the browser, so a determined person could fake
-- many of them. Fine for a view counter; don't use it for rewards.
create table if not exists public.book_views_guest (
  device_id text not null check (char_length(device_id) between 16 and 64),
  book_id   uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (device_id, book_id)
);
alter table public.book_views_guest enable row level security;
revoke all on public.book_views_guest from anon, authenticated;

create or replace function public.increment_views_guest(p_book_id uuid, p_device text)
returns bigint language plpgsql security definer set search_path = public as
$$
declare n int; v bigint;
begin
  if p_device is null or char_length(p_device) not between 16 and 64 then
    raise exception 'Bad device id';
  end if;
  if not exists (select 1 from public.books where id = p_book_id and not coalesce(is_hidden, false)) then
    raise exception 'Book not found';
  end if;
  insert into public.book_views_guest (device_id, book_id) values (p_device, p_book_id)
    on conflict do nothing;
  get diagnostics n = row_count;
  if n = 1 then
    update public.books set views = coalesce(views, 0) + 1 where id = p_book_id returning views into v;
  else
    select views into v from public.books where id = p_book_id;
  end if;
  return coalesce(v, 0);
end
$$;
revoke all on function public.increment_views_guest(uuid, text) from public;
grant execute on function public.increment_views_guest(uuid, text) to anon, authenticated;
