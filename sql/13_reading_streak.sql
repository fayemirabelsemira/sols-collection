-- Sol: consecutive-day reading streak. Run once in the Supabase SQL editor.
-- One row per reader per day (Manila time). Browser can't write the table directly.
create table if not exists public.reading_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default ((now() at time zone 'Asia/Manila')::date),
  primary key (user_id, day)
);
alter table public.reading_days enable row level security;
revoke all on public.reading_days from anon, authenticated;

create or replace function public.reading_streak()
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'Asia/Manila')::date;
  d date; cur int := 0; best int := 0; run int := 0; prev date; read_today boolean;
begin
  if uid is null then return jsonb_build_object('signed_in', false); end if;
  read_today := exists (select 1 from public.reading_days where user_id = uid and day = today);
  -- best streak
  for d in select day from public.reading_days where user_id = uid order by day loop
    if prev is not null and d = prev + 1 then run := run + 1; else run := 1; end if;
    if run > best then best := run; end if;
    prev := d;
  end loop;
  -- current streak: counts back from today, or from yesterday if today isn't read yet
  d := case when read_today then today else today - 1 end;
  while exists (select 1 from public.reading_days where user_id = uid and day = d) loop
    cur := cur + 1; d := d - 1;
  end loop;
  return jsonb_build_object('signed_in', true, 'current', cur, 'best', best, 'read_today', read_today);
end
$$;
revoke all on function public.reading_streak() from public, anon;
grant execute on function public.reading_streak() to authenticated;

create or replace function public.record_read_day()
returns jsonb language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null then raise exception 'Log in to keep a streak'; end if;
  insert into public.reading_days (user_id) values (auth.uid()) on conflict do nothing;
  return public.reading_streak();
end
$$;
revoke all on function public.record_read_day() from public, anon;
grant execute on function public.record_read_day() to authenticated;
