-- Rider-Ablage: einmal im Supabase-Dashboard unter "SQL Editor" ausführen.

-- 1) Tabelle für Bands, Konzerte und Unterlagen (je Nutzer getrennt)
create table if not exists public.items (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  id         text        not null,
  kind       text        not null check (kind in ('band', 'concert', 'doc')),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists items_user_updated on public.items (user_id, updated_at);

-- Server-Zeitstempel für den Abgleich
create or replace function public.items_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.items_touch();

-- Jede:r sieht nur die eigenen Daten
alter table public.items enable row level security;
drop policy if exists "eigene items" on public.items;
create policy "eigene items" on public.items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Privater Dateispeicher für die Rider-Dateien (Ordner = Nutzer-ID)
insert into storage.buckets (id, name, public) values ('riders', 'riders', false)
  on conflict (id) do nothing;

drop policy if exists "riders lesen" on storage.objects;
drop policy if exists "riders hochladen" on storage.objects;
drop policy if exists "riders ersetzen" on storage.objects;
drop policy if exists "riders loeschen" on storage.objects;
create policy "riders lesen" on storage.objects for select to authenticated
  using (bucket_id = 'riders' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "riders hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'riders' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "riders ersetzen" on storage.objects for update to authenticated
  using (bucket_id = 'riders' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "riders loeschen" on storage.objects for delete to authenticated
  using (bucket_id = 'riders' and (storage.foldername(name))[1] = auth.uid()::text);
