-- =========================================================
-- Sol: character cards + chapter recaps for
--      "Princess and the Seven Swords" (spoiler-safe through chapter 55)
--   Run in Supabase -> SQL Editor AFTER sql/10. One transaction.
--
--   - 20 character cards. Each card appears only once a reader
--     reaches the chapter where that character is introduced, and each
--     fact unlocks at the chapter where the book reveals it.
--   - 54 chapter recaps (1-40, 42-54, Epilogue = 55), approved.
--     The PDF has no Chapter 41, so it has no recap; add one later with:
--       insert into public.chapter_recaps (book_id, chapter_number, recap, approved)
--       values ('<book id>', 41, 'Your recap here.', true);
--
--   You confirmed replacing the book's 7 old cards (replace_cards := true).
--   Set it back to false to make the script stop instead if the book
--   already has cards.
--   Card names, aliases and titles hold no spoilers; every secret is a
--   fact that unlocks at its chapter, and the site only unlocks a
--   chapter's facts once the reader has read to its end.
--   Recaps are always written (the recap table is empty today).
-- =========================================================

begin;

do $$
declare
  replace_cards boolean := true;       -- you confirmed (16 Nov): replace this book's old cards
  v_book text;
  n_books int;
  n_old int;
begin
  select count(*), min(b.id::text) into n_books, v_book
    from public.books b where b.title ilike '%seven swords%';
  if n_books = 0 then
    raise exception 'STOPPED, nothing changed: no book with "Seven Swords" in its title.';
  elsif n_books > 1 then
    raise exception 'STOPPED, nothing changed: % books match "Seven Swords". Put the right book id in v_book by hand.', n_books;
  end if;

  select count(*) into n_old from public.characters where book_id = v_book;
  if n_old > 0 and not replace_cards then
    raise exception 'STOPPED, nothing changed: this book already has % character cards. To replace them, set replace_cards := true at the top of this block and run again.', n_old;
  end if;
  delete from public.characters where book_id = v_book;   -- their facts go with them (on delete cascade)

  create temp table _c (name text, aliases text[], title text, accent text, first_chapter int, sort int) on commit drop;
  insert into _c values
    ('Navy Laurier', array['Hestia', 'Third Princess']::text[], 'The girl in the princess''s body', '#3b6fd8', 1, 1),
    ('Curtis', array['Asher Curtis Emmanuelle']::text[], 'First Prince of the Lost Empire', '#2f8cff', 3, 2),
    ('Koa Versailles', '{}'::text[], 'Hestia''s personal knight', '#c0392b', 5, 3),
    ('Zayair', '{}'::text[], 'One of Hestia''s favourites', '#d4a72c', 2, 4),
    ('Adelion Gauthier', '{}'::text[], 'General of the Dark Castle', '#8f9bab', 2, 5),
    ('The Executioner', '{}'::text[], 'Blade of the Dark Castle', '#8e5bd6', 24, 6),
    ('Yoseff', '{}'::text[], 'Knight of the Obsidian', '#3fa56b', 27, 7),
    ('Rhaegan Targaven', '{}'::text[], 'Xenon''s Hound', '#7d7d86', 33, 8),
    ('Nico', array['Little Fox']::text[], 'Nine-Tailed Fox', '#5fa8e8', 20, 9),
    ('Hestia', array['The original Third Princess']::text[], 'Third Princess of the Dark Castle', '#5b4b8a', 2, 10),
    ('The Dark Lord', array['Father']::text[], 'Ruler of the Dark Castle', '#b8922a', 4, 11),
    ('Xenon', array['Crown Prince']::text[], 'Crown Prince of the Dark Castle', '#b3261e', 2, 12),
    ('Fiona', '{}'::text[], 'First Princess of the Dark Castle', '#6fa8c4', 2, 13),
    ('Akira', '{}'::text[], 'Second Princess of the Dark Castle', '#d9739f', 2, 14),
    ('Wesley', '{}'::text[], 'Hestia''s maid', '#7cab3c', 2, 15),
    ('Diana', '{}'::text[], 'Adelion''s companion', '#b59a72', 6, 16),
    ('Kaiden Lucas', array['The White Mage']::text[], 'The Immortal Mage', '#e0b93c', 29, 17),
    ('Hyacinth', '{}'::text[], 'Curtis''s younger sister', '#e58bb0', 19, 18),
    ('Nick', array['Nickolos']::text[], 'Navy''s little brother', '#9c7a5b', 1, 19),
    ('King', '{}'::text[], 'Hestia''s demon horse', '#4a4a4a', 8, 20);

  insert into public.characters (book_id, name, aliases, title, accent, first_chapter, sort)
  select v_book, name, aliases, title, accent, first_chapter, sort from _c;

  create temp table _f (who text, unlock_chapter int, kind text, text text, related text, sort int) on commit drop;
  insert into _f values
    ('Navy Laurier', 1, 'about', 'A brilliant 22-year-old who left college to care for her sick little brother, Nick, while working at Gushin Café.', null, 1),
    ('Navy Laurier', 1, 'about', 'Died on the road after hearing Nick had passed, and woke up in a princess''s body in another world.', null, 2),
    ('Navy Laurier', 2, 'about', 'Now lives as Hestia, the feared Third Princess of the Dark Castle, without any of Hestia''s memories.', 'Hestia', 3),
    ('Navy Laurier', 3, 'trait', 'Quick-witted and stubborn; survives by bluffing in Hestia''s cold voice.', null, 4),
    ('Navy Laurier', 7, 'about', 'Gathers "swords" — people sworn to stand by her — instead of the men the old Hestia collected.', null, 5),
    ('Navy Laurier', 18, 'trait', 'Her ears turn red when she lies.', null, 6),
    ('Navy Laurier', 19, 'about', 'Won the Demon''s Hunt and is owed one favor from the crown.', null, 7),
    ('Navy Laurier', 20, 'about', 'The Dark Lord knows she is Navy — he says he called her soul here. He orders her to return the Blue Gem to the altar within 30 days.', 'The Dark Lord', 8),
    ('Navy Laurier', 28, 'trait', 'Hestia''s black smoke answers her fear, not her anger — and costs her a nosebleed.', null, 9),
    ('Navy Laurier', 31, 'about', 'Took 36 lashes in Curtis''s place before the whole court.', 'Curtis', 10),
    ('Navy Laurier', 38, 'about', 'Gave her own fate to the Heartwood in exchange for the truth about Hestia''s lost child.', null, 11),
    ('Navy Laurier', 47, 'relationship', 'Told Curtis "Mine. Gusto kita." — they are together now.', 'Curtis', 12),
    ('Navy Laurier', 48, 'trait', 'With the poison gone from this body, her black smoke finally obeys her at will.', null, 13),
    ('Navy Laurier', 50, 'about', 'She is Hestia''s twin sister — their mother carried her to the mortal world as a baby. That is why her soul fit the body.', 'Hestia', 14),
    ('Navy Laurier', 52, 'about', 'Came back from the edge of death whole, after the Heartwood answered to her true name.', null, 15),
    ('Navy Laurier', 53, 'about', 'Her birth name is Nyx.', null, 16),
    ('Navy Laurier', 54, 'about', 'Named the Dark Lord''s heir before the court. Who she chooses is hers alone to decide.', null, 17),
    ('Curtis', 3, 'about', 'Captured by Xenon in the mortal world and collared with a Binding Gorget; Navy holds his key.', 'Xenon', 1),
    ('Curtis', 3, 'trait', 'Wields blue flames; his eyes glow gold and red.', null, 2),
    ('Curtis', 7, 'about', 'The Binding Gorget seals his magic. It lets him use his power only when Navy''s life is in danger.', null, 3),
    ('Curtis', 9, 'about', 'Everyone else calls him "Ace". He calls Navy "Crybaby".', null, 4),
    ('Curtis', 12, 'about', 'Stole the Blue Gem from the Obsidian Temple — a stone taken from his family.', null, 5),
    ('Curtis', 15, 'relationship', 'Calls himself Navy''s sword, shield and slave.', 'Navy Laurier', 6),
    ('Curtis', 18, 'trait', 'Can feel Navy''s pulse through the gorget.', null, 7),
    ('Curtis', 21, 'relationship', 'His younger sister Hyacinth was sent to the Skye Empire on the night his family was attacked.', 'Hyacinth', 8),
    ('Curtis', 21, 'about', 'Wants Xenon dead for the attack on his family.', 'Xenon', 9),
    ('Curtis', 24, 'about', 'Refuses to give up the Blue Gem: the altar would use it to drag his sister to the Dark Castle.', null, 10),
    ('Curtis', 29, 'relationship', 'Old friends with Kaiden Lucas, the White Mage — and gave him the Blue Gem to keep it from the altar.', 'Kaiden Lucas', 11),
    ('Curtis', 31, 'about', 'Refused Lucas''s offer to break the gorget so he would still have a reason to stay by Navy''s side.', null, 12),
    ('Curtis', 42, 'about', 'Was dragged through Xenon''s portal by red threads tied to his gorget.', 'Xenon', 13),
    ('Curtis', 45, 'about', 'His mother calls him Asher.', null, 14),
    ('Curtis', 47, 'relationship', 'Yoseff is his cousin.', 'Yoseff', 15),
    ('Curtis', 47, 'about', 'The gorget broke, revealing his family''s Azure Diamond and restoring his full power. He no longer feels Navy''s heartbeat.', null, 16),
    ('Curtis', 54, 'about', 'Full name: Asher Curtis Emmanuelle Silvencia, wielder of the Heavenly Flame.', null, 17),
    ('Curtis', 55, 'about', 'Left for Grimoire Academy to find his sister, promising Navy he loves her.', 'Hyacinth', 18),
    ('Koa Versailles', 5, 'about', 'Hestia''s childhood friend and personal knight, back from a dangerous mission she sent him on.', 'Hestia', 1),
    ('Koa Versailles', 6, 'trait', 'Fire magic and a black greatsword. Teasing, but fiercely loyal.', null, 2),
    ('Koa Versailles', 7, 'relationship', 'Becomes Navy''s second sword.', 'Navy Laurier', 3),
    ('Koa Versailles', 14, 'relationship', 'Cousin of Akira through the Versailles side of her mother''s family.', 'Akira', 4),
    ('Koa Versailles', 15, 'about', 'The first to realise: "You''re not her."', null, 5),
    ('Koa Versailles', 21, 'about', 'Knows the truth about Navy and swore to her, not to Hestia''s face — no lies between them.', 'Navy Laurier', 6),
    ('Koa Versailles', 35, 'about', 'Knows Hestia is gone and has sworn to avenge her.', 'Hestia', 7),
    ('Koa Versailles', 55, 'relationship', 'Loved Hestia since they were children, and never told her.', 'Hestia', 8),
    ('Zayair', 2, 'about', 'One of the old Hestia''s favourites.', 'Hestia', 1),
    ('Zayair', 4, 'trait', 'Calls Hestia "Raven" for her black hair. Playful, flirtatious and hard to read.', null, 2),
    ('Zayair', 5, 'relationship', 'Was found in Fiona''s bed.', 'Fiona', 3),
    ('Zayair', 7, 'about', 'Was the old Hestia''s strategist, not just her lover. Feels she used him.', 'Hestia', 4),
    ('Zayair', 12, 'about', 'Was meant to become the next Heavenly Chief of the Obsidian Temple.', null, 5),
    ('Zayair', 27, 'about', 'Planned the fall of House Gauthier at Hestia''s request, so she could collar Adelion and keep him alive.', 'Adelion Gauthier', 6),
    ('Zayair', 27, 'relationship', 'Zayair Valcourt — swore himself as Navy''s sword.', 'Navy Laurier', 7),
    ('Zayair', 26, 'trait', 'Navy calls him "Blondie".', null, 8),
    ('Zayair', 42, 'about', 'Told the whole court he''d sleep in a dungeon before returning to Fiona.', 'Fiona', 9),
    ('Adelion Gauthier', 2, 'about', 'One of the men the old Hestia kept.', 'Hestia', 1),
    ('Adelion Gauthier', 4, 'trait', 'Brown hair, silver eyes. Calls her "Third Princess", never "Your Highness".', null, 2),
    ('Adelion Gauthier', 6, 'about', 'Last of House Gauthier — Hestia burned his kingdom and collared him.', 'Hestia', 3),
    ('Adelion Gauthier', 9, 'about', 'General of the Dark Castle.', null, 4),
    ('Adelion Gauthier', 17, 'relationship', 'Nico calls him "Dada" — the blood rite that saved Nico only works with mutual love.', 'Nico', 5),
    ('Adelion Gauthier', 22, 'about', 'Believed Hestia ended their unborn child without telling him.', 'Hestia', 6),
    ('Adelion Gauthier', 31, 'about', 'Took the remaining 64 lashes for Navy as "her property".', 'Navy Laurier', 7),
    ('Adelion Gauthier', 38, 'about', 'Saw the truth in the Heartwood: Hestia lost their child and let him hate her to keep him alive.', 'Hestia', 8),
    ('Adelion Gauthier', 38, 'relationship', 'Swore himself as Navy''s fourth sword.', 'Navy Laurier', 9),
    ('Adelion Gauthier', 52, 'about', 'Gave up his revenge. Knows her real name is Navy.', 'Navy Laurier', 10),
    ('Adelion Gauthier', 54, 'about', 'Freed from his collar by Navy; left with Nico to rebuild the Gauthier lands.', 'Nico', 11),
    ('The Executioner', 24, 'trait', 'Masked, with an amethyst eye and an iron chain. Everyone avoids his gaze.', null, 1),
    ('The Executioner', 25, 'trait', 'His chain forbids lies — and he feels every pain he inflicts.', null, 2),
    ('The Executioner', 25, 'about', 'The servant girl found dead at Green Lake was his little sister.', null, 3),
    ('The Executioner', 35, 'about', 'Left healing salve at Navy''s door after her lashing.', 'Navy Laurier', 4),
    ('The Executioner', 35, 'about', 'His name is Cassian. Fiona''s frozen handprint scars his face.', 'Fiona', 5),
    ('The Executioner', 36, 'about', 'Saw Hestia with Akira at the lake the night she vanished.', 'Akira', 6),
    ('The Executioner', 42, 'about', 'Freed from Fiona''s frost. Swore himself as Navy''s sixth sword.', 'Navy Laurier', 7),
    ('Yoseff', 27, 'about', 'Knight of the Obsidian with grey hair and green eyes. No family name, and he bows to no one.', null, 1),
    ('Yoseff', 27, 'trait', 'Nico says he "smells like the sky".', 'Nico', 2),
    ('Yoseff', 39, 'about', 'Revealed as Yoseff Aurelion, the hidden First Prince of the Skye Empire — offered as Navy''s husband.', null, 3),
    ('Yoseff', 40, 'about', 'Copied Fiona''s secret letters for a month. Stands behind Navy as "a loan, not a gift".', 'Fiona', 4),
    ('Yoseff', 40, 'relationship', 'Shared a night with the old Hestia, which she pretended to forget.', 'Hestia', 5),
    ('Yoseff', 47, 'relationship', 'Son of Medea, the sister of Curtis''s mother: Curtis''s cousin.', 'Curtis', 6),
    ('Yoseff', 54, 'about', 'Brought the Skye alliance against Xenon, and still stands by his engagement offer.', 'Navy Laurier', 7),
    ('Rhaegan Targaven', 33, 'about', 'Threw a knife near Nico to test whether Hestia still had her power.', null, 1),
    ('Rhaegan Targaven', 33, 'about', 'Xenon''s Hound: ash-white hair with black tips and a thorn tattoo that Xenon can make burn.', 'Xenon', 2),
    ('Rhaegan Targaven', 35, 'trait', 'Sees souls — he knows the soul in Hestia''s body is blue, not black.', null, 3),
    ('Rhaegan Targaven', 44, 'about', 'Navy burned away Xenon''s seal. He had secretly been hiding Curtis''s parents.', 'Navy Laurier', 4),
    ('Rhaegan Targaven', 46, 'relationship', 'Swore himself as the seventh sword to repay his debt.', 'Navy Laurier', 5),
    ('Nico', 20, 'about', 'A White Mage spirit beast — a Nine-Tailed Fox — whose power lives in its ninth tail.', null, 1),
    ('Nico', 20, 'about', 'Took human form from Navy''s and Adelion''s aura, so he calls them Momma and Dada.', 'Adelion Gauthier', 2),
    ('Nico', 20, 'about', 'Named after Navy''s brother Nick. Hides as a white fox keychain.', 'Nick', 3),
    ('Nico', 34, 'trait', 'Feeds on his bonded parents'' mana; needs their blood every three days.', null, 4),
    ('Nico', 38, 'about', 'His little wooden sword was made by Hestia for her unborn child.', 'Hestia', 5),
    ('Nico', 50, 'about', 'Swallowed half of Navy''s soul to save it, losing a tail.', 'Navy Laurier', 6),
    ('Nico', 52, 'about', 'Gave Navy her soul back. Now has a blue streak in his hair and blue eyes.', 'Navy Laurier', 7),
    ('Hestia', 2, 'about', 'Nyx Hestia Alastair — feared for collecting men and torturing servants.', null, 1),
    ('Hestia', 6, 'relationship', 'Loved Adelion, yet burned his kingdom and collared him.', 'Adelion Gauthier', 2),
    ('Hestia', 8, 'trait', 'Said to be as powerful as Xenon, and an unbeatable rider.', null, 3),
    ('Hestia', 27, 'about', 'Collared Adelion to save him from the Dark Lord''s order to wipe out the Gauthiers.', 'Adelion Gauthier', 4),
    ('Hestia', 34, 'about', 'Her last memory, kept by the Infinity Lake: a sibling behind her in the dark.', null, 5),
    ('Hestia', 37, 'about', 'Lost Adelion''s child to Akira''s poison, then claimed she ended it so he would hate her and live.', 'Akira', 6),
    ('Hestia', 42, 'about', 'Fiona was at the lake the night she vanished and hid her body.', 'Fiona', 7),
    ('Hestia', 50, 'about', 'Her soul never answered the altar — she is truly gone.', null, 8),
    ('Hestia', 53, 'about', 'Secretly kept childhood treasures and an unopened letter from her mother in the east tower.', null, 9),
    ('The Dark Lord', 14, 'trait', 'Never turns his throne to face anyone. Smokes, and keeps a Gloom Crawler.', null, 1),
    ('The Dark Lord', 19, 'trait', 'Blue eyes like Hestia''s, a scar over his left eye, and gold veins beneath his skin.', null, 2),
    ('The Dark Lord', 20, 'about', 'Knows Hestia''s body holds Navy, and says he summoned her soul.', 'Navy Laurier', 3),
    ('The Dark Lord', 33, 'about', 'Wants his daughter''s soul back — Navy is "Plan A", Silvencia blood is "Plan B".', 'Hyacinth', 4),
    ('The Dark Lord', 42, 'about', 'Revealed Fiona is not his blood, and crushed her mana core.', 'Fiona', 5),
    ('The Dark Lord', 48, 'about', 'Fed Akira''s birthday cakes to his dogs for four years.', 'Akira', 6),
    ('The Dark Lord', 53, 'relationship', 'Navy''s father. Selene, Hestia''s mother, told him his first twin was stillborn.', 'Navy Laurier', 7),
    ('The Dark Lord', 55, 'about', 'Secretly asked Xenon to bring him Hyacinth''s blood.', 'Xenon', 8),
    ('Xenon', 2, 'trait', 'Silver-white hair, red eyes, sweet fake smiles. Pits his sisters against each other.', null, 1),
    ('Xenon', 3, 'trait', 'Teleports people and things with a snap.', null, 2),
    ('Xenon', 15, 'about', 'Rubbed Blood Lotus on Hestia''s hunting gear to lure demons to her.', 'Hestia', 3),
    ('Xenon', 27, 'about', 'Wants "the Silvencia girl" and plans for Hestia to die at the temple.', 'Hyacinth', 4),
    ('Xenon', 33, 'about', 'Left the castle to hunt Hyacinth himself, leaving his Hound to watch Hestia.', 'Rhaegan Targaven', 5),
    ('Xenon', 42, 'trait', 'Opens gates in the air, black with red edges, and casts red threads.', null, 6),
    ('Xenon', 45, 'about', 'Held Curtis and his parents at the Kennel. Knows a stranger wears his sister''s face.', 'Curtis', 7),
    ('Xenon', 51, 'about', 'Turned on the Dark Lord with an army from Dark City.', 'The Dark Lord', 8),
    ('Fiona', 2, 'trait', 'Quiet, dirty-white hair, grey eyes.', null, 1),
    ('Fiona', 3, 'trait', 'Ice magic — her ice doesn''t melt, even in fire.', null, 2),
    ('Fiona', 26, 'about', 'Ice spread from her hand just like the ice on the dead servant girl.', 'The Executioner', 3),
    ('Fiona', 40, 'about', 'Was secretly plotting with Diana to kill Hestia.', 'Diana', 4),
    ('Fiona', 42, 'about', 'Not the Dark Lord''s blood. Was at the lake and hid Hestia''s body. Stripped of her mana core and exiled.', 'Hestia', 5),
    ('Fiona', 45, 'relationship', 'Now stands with Xenon.', 'Xenon', 6),
    ('Akira', 2, 'trait', 'Brown hair, sky-blue eyes, and an innocent act.', null, 1),
    ('Akira', 5, 'about', 'Tried to give Hestia a poisoned cupcake.', 'Hestia', 2),
    ('Akira', 25, 'about', 'Brought poisoned macarons and pointed Navy toward Fiona.', 'Fiona', 3),
    ('Akira', 37, 'about', 'Her poisoned cake caused Hestia''s miscarriage.', 'Hestia', 4),
    ('Akira', 48, 'about', 'Confessed to years of poisoning Hestia. Imprisoned.', null, 5),
    ('Wesley', 2, 'trait', 'Young maid, about 16, with brown hair and green eyes; Navy''s guide in the castle.', null, 1),
    ('Wesley', 37, 'about', 'Knew Hestia''s secrets all along and pretended not to, on Hestia''s old orders.', 'Hestia', 2),
    ('Diana', 6, 'about', 'A gentle woman Adelion protects.', 'Adelion Gauthier', 1),
    ('Diana', 22, 'relationship', 'Loves Adelion and begged him to run away with her.', 'Adelion Gauthier', 2),
    ('Diana', 38, 'about', 'Lured Hestia to the Gauthier ruins into an ambush: "She took the bait."', 'Fiona', 3),
    ('Diana', 43, 'about', 'Exiled from the Dark Castle at Adelion''s plea.', null, 4),
    ('Kaiden Lucas', 29, 'about', 'Half son of the god of creation. Can revive any living thing except the one he loves.', null, 1),
    ('Kaiden Lucas', 29, 'relationship', 'Has known Curtis since he was a child.', 'Curtis', 2),
    ('Kaiden Lucas', 30, 'relationship', 'Wants "everything" with Hyacinth.', 'Hyacinth', 3),
    ('Hyacinth', 21, 'about', '19, raised in hiding in the mortal world. Curtis sealed her powers and sent her to the Skye Empire.', 'Curtis', 1),
    ('Hyacinth', 24, 'about', 'Curtis calls her "Ash".', null, 2),
    ('Hyacinth', 30, 'about', 'Full name: Aphrodite Serenity Hyacinth Silvencia.', null, 3),
    ('Hyacinth', 32, 'about', 'Silvencia blood can bring back the dead — at the cost of her own life.', null, 4),
    ('Hyacinth', 55, 'trait', 'Pink hair and gold eyes; at Grimoire Academy in Skye territory.', null, 5),
    ('Nick', 1, 'about', 'Navy''s critically ill little brother. His death is the last thing Navy heard before the truck.', 'Navy Laurier', 1),
    ('Nick', 52, 'about', 'At peace and no longer in pain, he sent Navy back to her life.', 'Navy Laurier', 2),
    ('King', 8, 'trait', 'Black demon horse wreathed in smoke, with red eyes.', null, 1),
    ('King', 10, 'about', 'Obeys Curtis more readily than Navy.', 'Curtis', 2),
    ('King', 51, 'about', 'Came on his own to carry Navy to the Heartwood.', 'Navy Laurier', 3);

  insert into public.character_facts (character_id, unlock_chapter, kind, text, related_character_id, sort)
  select c.id, f.unlock_chapter, f.kind, f.text, r.id, f.sort
    from _f f
    join public.characters c on c.book_id = v_book and c.name = f.who
    left join public.characters r on r.book_id = v_book and r.name = f.related;

  create temp table _r (chapter_number int, recap text) on commit drop;
  insert into _r values
    (1, 'Navy Laurier gave up college to care for her dying brother Nick. The night he dies, she is hit by a truck — and wakes in a princess''s bed beside two strange men: a cold silver-eyed one and an amused blond.'),
    (2, 'Navy learns she is Hestia, the feared "crazy" Third Princess of the Dark Castle. With her young maid Wesley as guide, she is summoned by Crown Prince Xenon to see his newest captive, the First Prince of the Lost Empire.'),
    (3, 'Xenon challenges his sisters to collar the captive. Fiona and Akira fail; Xenon drugs the prince, Curtis, collars him and hands Navy the key. She treats his wounds herself and asks him to be her sword.'),
    (4, 'Navy realises she has Hestia''s power but no idea how to use it. A drunk Zayair slips into her bed and is thrown out. At the lake a servant nearly knocks her in, and Adelion kneels to take the girl''s punishment.'),
    (5, 'Curtis explains this is a parallel Earth where his magic doesn''t work on her. Akira offers a poisoned cupcake. Navy learns her childhood knight Koa is returning, and catches Zayair in bed with Fiona.'),
    (6, 'In Adelion''s territory, he accuses Hestia of burning his people. Overwhelmed by Hestia''s leftover feelings, Navy offers him her throat. Koa Versailles intervenes and offers to be her sword; her full name is Nyx Hestia Alastair.'),
    (7, 'Koa becomes Navy''s second sword. Curtis reveals his collar is a Binding Gorget that seals his magic. In the Grand Library Navy finds it can only be removed through genuine love, and Zayair confesses he was Hestia''s strategist.'),
    (8, 'Zayair vows to make her cry and leaves. Curtis takes Navy on her demon horse King to Moonshard Peak, where the floating Skye Empire is visible, and questions why she never shows her power.'),
    (9, 'Curtis pushes Navy off the cliff to test the gorget, then saves her with sudden power. They meet Adelion, now a general, leading soldiers to inspect the Obsidian Temple.'),
    (10, 'At the ruined Obsidian Temple Curtis vanishes. A grey-haired, green-eyed knight helps Navy down with a cryptic warning, and Captain Zadir welcomes her into the Obsidian Knights'' training ground.'),
    (11, 'Navy fends off flirting knights and a cold Adelion. Zayair, dressed as a priest, reports that Curtis was caught breaking a sacred formation. Navy claims Curtis as hers and finally tells him her name.'),
    (12, 'Navy promises to replace the stolen artifact. Curtis shows her the Blue Gem, a communication stone taken from his family. Xenon announces her birthday hunt, and she dreams of Hestia defeating Adelion — wearing Navy''s face.'),
    (13, 'A memory shows Hestia betraying and collaring Adelion. On her birthday Navy is given hunting gear "from Xenon". Curtis refuses to escort her, and the grey-haired knight catches her when she jumps from a tree.'),
    (14, 'At the Demon''s Hunt the Dark Lord, still facing away, orders Hestia to win first place or be fed to his Gloom Crawler. Koa escorts her, and in the Forbidden Forest three shadows attack.'),
    (15, 'Demons swarm only Hestia: her gear was smeared with Blood Lotus. A Gloom Crawler swallows Koa''s fire until Curtis destroys it with blue flame. Koa looks into Navy''s eyes and realises: "You''re not her."'),
    (16, 'Koa strangles Navy until Curtis stops him, his power returning because she is in danger. A white mist separates them, leaving Navy with Adelion against a Nine-Tailed Fox whose power lies in its hidden ninth tail.'),
    (17, 'Navy''s daggers strike the ninth tail, and the fox becomes a small boy who calls her Momma and Adelion Dada. To save him, Navy mixes her blood with Adelion''s — a rite that only works with mutual love.'),
    (18, 'Adelion leaves shaken. The cub hides as a fox keychain. At the hunt''s end, Navy presents 334 beast cores — double Xenon''s — from a pouch Curtis secretly gave her, and the Dark Lord turns his throne around.'),
    (19, 'The Dark Lord crowns Navy the hunt''s winner and grants her one favor. Navy bluffs past Koa''s test of who she is. Xenon mocks Curtis and threatens his sister Hyacinth, and Navy calls Curtis "my man".'),
    (20, 'Navy names the fox Nico, after her brother. At the Obsidian Spire the Dark Lord reveals he knows she is Navy and orders her to return the Blue Gem to the temple altar before the Blood Moon, thirty days away.'),
    (21, 'Navy tells Koa the truth, and he swears to her as her Second Sword. On the balcony Curtis tells Navy about his sister Hyacinth, sent to the Skye Empire the night his family was attacked.'),
    (22, 'Nico begs to see Adelion. Navy overhears Diana begging Adelion to elope. At the market Adelion dotes on Nico, then breaks: he believes Hestia ended their unborn child without telling him.'),
    (23, 'Navy can only say "I don''t remember." Nico''s fox fire flares in the market until Adelion shields them. That night Curtis shows Navy the Blue Gem glowing — proof his sister is still alive.'),
    (24, 'The gem is half of a pair: on the Blood Moon the altar would drag Curtis''s sister to it, so he refuses to give it up. A servant girl is found dead at Green Lake, and the masked Executioner, blaming Navy, chokes her until Curtis arrives in blue fire.'),
    (25, 'The Executioner''s chain forbids lies, so Navy can only tell the truth: she didn''t kill the girl, his sister. Navy spots unmelting ice on the body and suspects Fiona. Akira''s macarons poison the fish.'),
    (26, 'At the Obsidian Temple, Zayair shows Navy the Altar of Calling and warns her the Dark Lord is hunting someone. Fiona arrives, ice creeping from her hand, and the grey-haired knight stares at Nico as if he knows him.'),
    (27, 'Adelion names the knight Yoseff, who bows to no one. Zayair reveals he planned the Gauthiers'' fall so Hestia could collar Adelion and save him, then swears to Navy as her sword. Xenon orders a test of her power.'),
    (28, 'Koa trains Navy without success until a knife flies at Nico and terror unleashes her black smoke. That night a white-haired, gold-eyed stranger heals the broken trees and says she smells like someone who doesn''t belong here.'),
    (29, 'Zayair tells the legend of the Immortal White Mage. Navy plans to take the Blue Gem herself, but overhears Curtis with the stranger — Kaiden Lucas — and watches Curtis give him the gem.'),
    (30, 'Navy confronts them; Lucas leaves with the gem for Hyacinth. The Dark Lord sees the gem''s light vanish from his map and has Curtis arrested at dawn.'),
    (31, 'Navy invokes royal property law and takes Curtis''s 100 lashes herself, fainting at 36. Curtis breaks his cell as the gorget tightens, and Adelion takes the remaining 64 lashes for her.'),
    (32, 'Navy wakes a day later. Curtis reveals the secret of Silvencia blood: it can bring back the dead, at the cost of the life that gives it — and he can''t promise not to lie again.'),
    (33, 'Xenon leaves to hunt Hyacinth, leaving his Hound Rhaegan to watch Navy. The Dark Lord admits the real Hestia''s soul is gone from her body, and that Navy must step aside on the Blood Moon so it can return.'),
    (34, 'Nico falls ill from lack of his bonded parents'' mana, and Navy and Adelion save him with their blood. At the Infinity Lake, Hestia''s last memory reaches out: a sibling stood behind her.'),
    (35, 'Rhaegan sees that Navy''s soul is blue, not Hestia''s black. Navy tells Koa the real Hestia is gone. She unmasks the Executioner, Cassian, whose face bears Fiona''s frozen handprint.'),
    (36, 'Cassian reveals he saw Hestia with Akira at the lake the night she vanished, before someone knocked him out. Navy tends his spreading frost scar.'),
    (37, 'Wesley reveals Hestia miscarried from Akira''s poison and lied to Adelion so he''d hate her and live. Diana lures Navy to the Gauthier ruins, where assassins strike.'),
    (38, 'Navy pays the Heartwood her own fate for the truth. Adelion sees Hestia grieve their lost child and swears himself as Navy''s fourth sword, then finds Diana''s note on an assassin.'),
    (39, 'Curtis watches over Navy, and Adelion says Diana has fled. Skye envoys arrive offering peace through marriage — their First Prince is Yoseff, who greets her: "Your future husband."'),
    (40, 'Yoseff shows Navy Diana''s secret letters to Fiona and offers his help — on loan. Navy demands a Verdict on Fiona at dawn, but finds Cassian freezing from Fiona''s ice.'),
    (42, 'Diana is caught. The chain exposes Fiona: she isn''t the Dark Lord''s blood, and she hid Hestia''s body at the lake. Navy spends her favor to spare Fiona''s life, so the Dark Lord crushes her mana core instead. Cassian becomes Navy''s sixth sword, and Xenon''s portal drags Curtis away.'),
    (43, 'Navy refuses to cry. Diana is exiled at Adelion''s plea, the Dark Lord hints that Navy should take Curtis back, and the swords set out to find Rhaegan.'),
    (44, 'Navy burns Xenon''s seal off Rhaegan. He refuses to be her sword but agrees to lead them, revealing that Xenon also holds Curtis''s parents.'),
    (45, 'With Adelion, Navy plays bait at the Kennel''s main gate while the others go in by the side gates. Inside, Xenon reveals he knows she isn''t his sister.'),
    (46, 'Navy cracks the gorget by claiming Curtis as hers, then shields his mother; Curtis''s full power erupts and Xenon flees. Rhaegan swears as the seventh sword, and Yoseff finds a piece of his family''s stone.'),
    (47, 'Yoseff turns out to be Curtis''s cousin. Curtis and Navy confess their feelings, and by dawn the gorget has split, freeing him with the Azure Diamond. A blood-red moon rises early.'),
    (48, 'Navy makes Akira eat her own cake, and the Dark Lord''s dog dies from the rest. Akira confesses to years of poisoning Hestia. With the poison gone, Navy''s power is finally hers.'),
    (49, 'Navy stops her swords from fighting fifty knights and goes to the altar alone. She gives her blood willingly, and the mirror it forms shows a woman holding two babies.'),
    (50, 'The mirror reveals Navy is Hestia''s twin, carried to the mortal world by their mother Selene. The ritual tears Navy''s soul in half and Hestia never answers — she is truly gone. Nico swallows the other half of Navy''s soul.'),
    (51, 'Curtis arrives too late; the Dark Lord confirms Hestia is gone. Adelion carries Navy to the Heartwood, the only place that can save her. Xenon attacks with an army and sends Fiona after her.'),
    (52, 'Navy meets Nick in a dream; he is at peace and sends her back. The Heartwood answers only when Adelion calls her by her true name, Navy. Whole again, she defeats Fiona''s soldiers beside him.'),
    (53, 'Adelion grieves the Hestia he hated. Navy reunites with Curtis and Koa. The Dark Lord reveals her birth name is Nyx, and in her mother''s tower Navy finds Selene''s letter to Hestia.'),
    (54, 'The Dark Lord names Navy his heir and tears up the marriage treaty. The swords nearly brawl over her until he rules that she alone chooses. Adelion leaves with Nico, and Lucas arrives: Curtis''s sister is in trouble.'),
    (55, 'Curtis and Navy say "I love you" before he leaves to find his sister. Months later Navy is learning to rule. Koa mourns Hestia at the lake, and the Dark Lord secretly sends Xenon after Hyacinth.');

  insert into public.chapter_recaps (book_id, chapter_number, title, recap, approved)
  select v_book, r.chapter_number, ch.title, r.recap, true
    from _r r
    left join public.chapters ch on ch.book_id::text = v_book and ch.chapter_number = r.chapter_number
  on conflict (book_id, chapter_number) do update
     set recap = excluded.recap, title = coalesce(excluded.title, public.chapter_recaps.title), approved = true;

  raise notice 'Seven Swords: % cards, % facts, % recaps written.',
    (select count(*) from public.characters where book_id = v_book),
    (select count(*) from public.character_facts f join public.characters c on c.id = f.character_id where c.book_id = v_book),
    (select count(*) from public.chapter_recaps where book_id = v_book and approved);
end
$$;

commit;
