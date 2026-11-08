-- Rider-Ablage: im Supabase-Dashboard unter "SQL Editor" einfügen und "Run" drücken.
-- Das Skript kann gefahrlos mehrfach ausgeführt werden und bringt auch ältere
-- Einrichtungen (jede:r nur eigene Daten) auf den Team-Stand.
--
-- Team-Prinzip:
--   * Wer in der Tabelle "members" steht, gehört zum Team.
--   * Bands, Rider/Unterlagen und Stagebox-Profile sehen und bearbeiten alle im Team.
--   * Konzerte und Festivals sieht nur, wer sie angelegt hat – plus die Personen,
--     mit denen sie geteilt wurden ('*' = ganzes Team).

-- 1) Team-Mitglieder (per E-Mail, klein geschrieben)
create table if not exists public.members (
  email    text        primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

-- Beim ersten Ausführen: alle schon vorhandenen Konten kommen ins Team.
insert into public.members (email)
  select lower(email) from auth.users
  where email is not null and not exists (select 1 from public.members)
  on conflict do nothing;

create or replace function public.my_email() returns text
  language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.my_email())
$$;

-- Ist das Team noch leer, darf sich die erste Person selbst eintragen.
create or replace function public.members_empty() returns boolean
  language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.members)
$$;

alter table public.members enable row level security;
drop policy if exists "team sehen" on public.members;
drop policy if exists "team hinzufuegen" on public.members;
drop policy if exists "team entfernen" on public.members;
create policy "team sehen" on public.members for select to authenticated using (public.is_member());
create policy "team hinzufuegen" on public.members for insert to authenticated
  with check (public.is_member() or (public.members_empty() and email = public.my_email()));
create policy "team entfernen" on public.members for delete to authenticated using (public.is_member());

-- 2) Bands, Konzerte und Unterlagen
create table if not exists public.items (
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade, -- angelegt von
  id          text        not null primary key,
  kind        text        not null check (kind in ('band', 'concert', 'doc')),
  data        jsonb,
  deleted     boolean     not null default false,
  shared_with text[]      not null default '{}', -- nur für Konzerte: E-Mails oder '*'
  updated_at  timestamptz not null default now()
);
alter table public.items add column if not exists shared_with text[] not null default '{}';

-- Ältere Einrichtungen: Schlüssel war (user_id, id) → jetzt nur id
do $$ begin
  if exists (select 1 from pg_constraint where conrelid = 'public.items'::regclass and contype = 'p' and array_length(conkey, 1) = 2) then
    execute (select 'alter table public.items drop constraint ' || quote_ident(conname) from pg_constraint where conrelid = 'public.items'::regclass and contype = 'p');
    alter table public.items add primary key (id);
  end if;
end $$;
drop index if exists public.items_user_updated;
create index if not exists items_updated on public.items (updated_at);

-- Server-Zeitstempel für den Abgleich; wer etwas angelegt hat, bleibt erhalten
create or replace function public.items_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then new.user_id := old.user_id; end if;
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.items_touch();

create or replace function public.can_see(k text, owner uuid, shared text[]) returns boolean
  language sql stable as $$
  select public.is_member() and (
    k <> 'concert' or owner = auth.uid() or '*' = any(shared) or public.my_email() = any(shared)
  )
$$;

alter table public.items enable row level security;
drop policy if exists "eigene items" on public.items;
drop policy if exists "items sehen" on public.items;
drop policy if exists "items anlegen" on public.items;
drop policy if exists "items aendern" on public.items;
drop policy if exists "items loeschen" on public.items;
create policy "items sehen" on public.items for select to authenticated
  using (public.can_see(kind, user_id, shared_with));
create policy "items anlegen" on public.items for insert to authenticated
  with check (user_id = auth.uid() and public.can_see(kind, user_id, shared_with));
create policy "items aendern" on public.items for update to authenticated
  using (public.can_see(kind, user_id, shared_with)) with check (public.can_see(kind, user_id, shared_with));
create policy "items loeschen" on public.items for delete to authenticated
  using (public.can_see(kind, user_id, shared_with));

-- 3) Dateispeicher für die Rider-Dateien: alle im Team dürfen lesen,
--    hochgeladen wird in den eigenen Ordner (Ordner = Nutzer-ID).
insert into storage.buckets (id, name, public) values ('riders', 'riders', false)
  on conflict (id) do nothing;

drop policy if exists "riders lesen" on storage.objects;
drop policy if exists "riders hochladen" on storage.objects;
drop policy if exists "riders ersetzen" on storage.objects;
drop policy if exists "riders loeschen" on storage.objects;
create policy "riders lesen" on storage.objects for select to authenticated
  using (bucket_id = 'riders' and public.is_member());
create policy "riders hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'riders' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "riders ersetzen" on storage.objects for update to authenticated
  using (bucket_id = 'riders' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "riders loeschen" on storage.objects for delete to authenticated
  using (bucket_id = 'riders' and public.is_member());
