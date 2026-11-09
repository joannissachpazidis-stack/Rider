-- Rider-Ablage: im Supabase-Dashboard unter "SQL Editor" einfügen und "Run" drücken.
-- Das Skript kann gefahrlos mehrfach ausgeführt werden und bringt auch ältere
-- Einrichtungen (jede:r nur eigene Daten) auf den Team-Stand.
--
-- Team-Prinzip:
--   * Wer in der Tabelle "members" steht, gehört zum Team.
--   * Rollen: 'admin' (eine Person, verwaltet alles), 'manager' (darf Mitglieder
--     hinzufügen/entfernen), 'member'. Nur der Admin vergibt oder entzieht 'manager'.
--     Admin wechseln: update public.members set role = 'admin' where email = 'neue@mail.de';
--                     update public.members set role = 'member' where email = 'alte@mail.de';
--   * Bands, Rider/Unterlagen und Stagebox-Profile sehen und bearbeiten alle im Team.
--   * Konzerte und Festivals sieht nur, wer sie angelegt hat – plus die Personen,
--     mit denen sie geteilt wurden ('*' = ganzes Team).

-- 1) Team-Mitglieder (per E-Mail, klein geschrieben)
create table if not exists public.members (
  email    text        primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

alter table public.members add column if not exists role text not null default 'member';
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('admin', 'manager', 'member'));

-- Beim ersten Ausführen: alle schon vorhandenen Konten kommen ins Team.
insert into public.members (email)
  select lower(email) from auth.users
  where email is not null and not exists (select 1 from public.members)
  on conflict do nothing;

create or replace function public.my_email() returns text
  language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- Gibt es noch keinen Admin, wird das älteste Konto im Team Admin (in der Regel du).
update public.members set role = 'admin'
  where not exists (select 1 from public.members where role = 'admin')
    and email = (select lower(u.email) from auth.users u join public.members m on m.email = lower(u.email) order by u.created_at limit 1);

create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.my_email())
$$;

-- Ist das Team noch leer, darf sich die erste Person selbst eintragen.
create or replace function public.members_empty() returns boolean
  language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.members)
$$;

create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.members where email = public.my_email()
$$;

-- Die erste Person im Team wird automatisch Admin
create or replace function public.members_first_admin() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where role = 'admin') then new.role := 'admin'; end if;
  return new;
end $$;
drop trigger if exists members_first_admin on public.members;
create trigger members_first_admin before insert on public.members
  for each row execute function public.members_first_admin();

alter table public.members enable row level security;
drop policy if exists "team sehen" on public.members;
drop policy if exists "team hinzufuegen" on public.members;
drop policy if exists "team entfernen" on public.members;
drop policy if exists "team rechte" on public.members;
create policy "team sehen" on public.members for select to authenticated using (public.is_member());
-- Hinzufügen: Admin und Verwaltung (nur als normales Mitglied) – oder die allererste Person
create policy "team hinzufuegen" on public.members for insert to authenticated
  with check ((public.my_role() in ('admin', 'manager') and role = 'member') or (public.members_empty() and email = public.my_email()));
-- Rechte ändern: nur der Admin, und nur zwischen Mitglied und Verwaltung
create policy "team rechte" on public.members for update to authenticated
  using (public.my_role() = 'admin' and role <> 'admin') with check (role in ('manager', 'member'));
-- Entfernen: Admin alle außer Admins, Verwaltung nur normale Mitglieder
create policy "team entfernen" on public.members for delete to authenticated
  using ((public.my_role() = 'admin' and role <> 'admin') or (public.my_role() = 'manager' and role = 'member'));

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
