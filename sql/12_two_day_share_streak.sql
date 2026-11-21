-- Sol: free chapter now needs a 2-day share streak (was 5).
-- One share per book per day counts, so shares_needed = days of sharing.
-- Run once in the Supabase SQL editor.
alter table public.reward_settings alter column shares_needed set default 2;
update public.reward_settings set shares_needed = 2 where id = 1;
