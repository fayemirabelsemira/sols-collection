#!/bin/sh
# Runs the SQL security checks in a throwaway local Postgres (Docker).
# Never connects to Supabase.  Usage:  sh tests/run-sql-tests.sh
set -e
cd "$(dirname "$0")/.."
NAME=sol-sec-pg
if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=localtest postgres:16-alpine >/dev/null
  until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
fi
run() { docker exec -i "$NAME" psql -q -U postgres -d "$1" -v ON_ERROR_STOP=1 2>&1; }
checks() { docker exec -i "$NAME" psql -q -U postgres -d "$1" 2>/dev/null < tests/sql/10_security_checks.sql | grep -E '^(PASS|FAIL|INFO)'; }
for db in sol_before sol_after; do
  docker exec "$NAME" psql -q -U postgres -c "drop database if exists $db" -c "create database $db" >/dev/null
  cat tests/sql/00_supabase_stub.sql sql/01_votes_views.sql sql/03_app_features.sql sql/04_discussions.sql | run "$db" >/dev/null
done
cat sql/06_security_hardening.sql | run sol_after | grep -i notice || true
# the chapter lock must step aside if a reader function runs with caller rights
docker exec "$NAME" psql -q -U postgres -c "drop database if exists sol_guard" -c "create database sol_guard" >/dev/null
{ cat tests/sql/00_supabase_stub.sql sql/01_votes_views.sql sql/03_app_features.sql sql/04_discussions.sql
  echo "create function public.reads_as_caller() returns bigint language sql as \$\$ select count(*) from public.chapters \$\$;"; } | run sol_guard >/dev/null
if cat sql/06_security_hardening.sql | run sol_guard | grep -q "Chapter lock SKIPPED"; then
  echo "PASS SOL-05 guard: lock skipped when a caller-rights function reads chapters"
else
  echo "FAIL SOL-05 guard did not skip"; GUARD_FAIL=1
fi
# open writing (sql/07) on top of sql/06
docker exec "$NAME" psql -q -U postgres -c "drop database if exists sol_open" -c "create database sol_open" >/dev/null
cat tests/sql/00_supabase_stub.sql sql/01_votes_views.sql sql/03_app_features.sql sql/04_discussions.sql \
    tests/sql/05_author_stub.sql sql/06_security_hardening.sql sql/07_open_writers.sql | run sol_open | grep -i "notice" || true
OPEN=$(docker exec -i "$NAME" psql -q -U postgres -d sol_open 2>&1 < tests/sql/20_open_writers.sql | grep -E '^(PASS|FAIL)')
# sql/07 must stop if a Writer Studio function skips the owner check
docker exec "$NAME" psql -q -U postgres -c "drop database if exists sol_guard7" -c "create database sol_guard7" >/dev/null
{ cat tests/sql/00_supabase_stub.sql sql/01_votes_views.sql sql/03_app_features.sql sql/04_discussions.sql tests/sql/05_author_stub.sql
  echo "drop function public.author_get_chapter(uuid); create function public.author_get_chapter(p_chapter_id uuid) returns public.chapters language sql stable security definer set search_path = public as \$\$ select * from public.chapters where id = p_chapter_id \$\$;"; } | run sol_guard7 >/dev/null
if cat sql/07_open_writers.sql | docker exec -i "$NAME" psql -q -U postgres -d sol_guard7 2>&1 | grep -q "STOPPED, nothing changed.*author_get_chapter" \
   && [ "$(docker exec "$NAME" psql -tA -U postgres -d sol_guard7 -c "select to_regclass('public.sol_admins') is null")" = "t" ]; then
  OPEN="$OPEN
PASS sql/07 stops and changes nothing when a studio function skips the owner check"
else
  OPEN="$OPEN
FAIL sql/07 safety check"
fi
# image uploads (sql/08) on top of sql/07
docker exec "$NAME" psql -q -U postgres -c "drop database if exists sol_img" -c "create database sol_img" >/dev/null
cat tests/sql/00_supabase_stub.sql tests/sql/02_storage_stub.sql sql/01_votes_views.sql sql/03_app_features.sql sql/04_discussions.sql \
    tests/sql/05_author_stub.sql sql/06_security_hardening.sql sql/07_open_writers.sql sql/08_image_uploads.sql | run sol_img | grep -i "image uploads" || true
IMG=$(docker exec -i "$NAME" psql -q -U postgres -d sol_img 2>&1 < tests/sql/30_images.sql | grep -E '^(PASS|FAIL)')
# rewards + spoiler-safe (sql/10)
docker exec "$NAME" psql -q -U postgres -c "drop database if exists sol_rw" -c "create database sol_rw" >/dev/null
cat tests/sql/00_supabase_stub.sql tests/sql/02_storage_stub.sql sql/01_votes_views.sql sql/03_app_features.sql sql/04_discussions.sql \
    tests/sql/05_author_stub.sql tests/sql/06_rewards_stub.sql sql/06_security_hardening.sql sql/07_open_writers.sql sql/10_rewards_and_spoilers.sql | run sol_rw | grep -i "rewards and" || true
RW=$(docker exec -i "$NAME" psql -q -U postgres -d sol_rw 2>&1 < tests/sql/40_rewards.sql | grep -E '^(PASS|FAIL|ERROR)')
# character cards + recaps (sql/11): stops by default, replaces only with the flag
docker exec "$NAME" psql -q -U postgres -c "drop database if exists sol_cx" -c "create database sol_cx" >/dev/null
cat tests/sql/00_supabase_stub.sql tests/sql/07_codex_stub.sql | run sol_cx >/dev/null
docker exec "$NAME" psql -q -U postgres -d sol_cx -c "insert into public.books (title) values ('Princess and the Seven Swords')" \
  -c "insert into public.chapters (book_id, chapter_number, title) select id, 55, 'Epilogue' from public.books where title ilike '%seven swords%'" \
  -c "insert into public.characters (book_id, name) select id::text, 'Old card' from public.books" >/dev/null
if sed "s/replace_cards boolean := true/replace_cards boolean := false/" sql/11_seven_swords_codex.sql | docker exec -i "$NAME" psql -q -U postgres -d sol_cx 2>&1 | grep -q "STOPPED, nothing changed: this book already has" \
   && [ "$(docker exec "$NAME" psql -tA -U postgres -d sol_cx -c "select count(*) from public.chapter_recaps")" = "0" ]; then
  CX="PASS sql/11 stops and changes nothing when the book already has cards"
else
  CX="FAIL sql/11 safety stop"
fi
sed 's/replace_cards boolean := false/replace_cards boolean := true/' sql/11_seven_swords_codex.sql | run sol_cx >/dev/null
sed 's/replace_cards boolean := false/replace_cards boolean := true/' sql/11_seven_swords_codex.sql | run sol_cx >/dev/null
CX="$CX
$(docker exec -i "$NAME" psql -q -U postgres -d sol_cx 2>&1 < tests/sql/50_codex.sql | grep -E '(PASS|FAIL|ERROR)' | sed 's/^ *//')
$( [ "$(docker exec "$NAME" psql -tA -U postgres -d sol_cx -c "select count(*) from public.characters where name = 'Old card'")" = "1" ] \
   && echo "PASS other books' cards are left alone" || echo "FAIL other books touched")"
echo "== BEFORE sql/06 =="; checks sol_before
echo "== AFTER sql/06 ==";  OUT=$(checks sol_after); echo "$OUT"
echo "== OPEN WRITERS (sql/07) =="; echo "$OPEN"; OUT="$OUT
$OPEN"
echo "== IMAGE UPLOADS (sql/08) =="; echo "$IMG"; OUT="$OUT
$IMG"
echo "== REWARDS + SPOILER-SAFE (sql/10) =="; echo "$RW"; OUT="$OUT
$RW"
echo "== CHARACTER CARDS + RECAPS (sql/11) =="; echo "$CX"; OUT="$OUT
$CX"
{ echo "$OUT" | grep -qE '^(FAIL|ERROR)' || [ -n "$GUARD_FAIL" ]; } && { echo "SQL security checks FAILED"; exit 1; } || echo "All SQL security checks passed."
