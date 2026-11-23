-- =========================================================
-- Sol: GIFs in chapter comments (GIPHY)
--   Run in Supabase -> SQL Editor. Safe to run again.
--
--   Adds comments.gif_id: a GIPHY GIF id only (letters and digits),
--   never a link, so nobody can post images from other sites.
--   The site builds the image address itself from the id.
--   A GIF-only comment is saved with the text "[GIF]", which the site
--   hides, so the existing "comment can't be empty" rules keep working.
-- =========================================================

begin;

alter table public.comments add column if not exists gif_id text;

alter table public.comments drop constraint if exists comments_gif_id_check;
alter table public.comments add constraint comments_gif_id_check
  check (gif_id is null or gif_id ~ '^[A-Za-z0-9]{1,64}$');

do $$ begin
  raise notice 'Comment GIFs are on.';
end $$;

commit;
