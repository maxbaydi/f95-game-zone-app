insert into storage.buckets (id, name, public)
values ('atlas-cloud-saves', 'atlas-cloud-saves', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "atlas cloud saves select own objects" on storage.objects;
create policy "atlas cloud saves select own objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'atlas-cloud-saves'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "atlas cloud saves insert own objects" on storage.objects;
create policy "atlas cloud saves insert own objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'atlas-cloud-saves'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "atlas cloud saves update own objects" on storage.objects;
create policy "atlas cloud saves update own objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'atlas-cloud-saves'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'atlas-cloud-saves'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "atlas cloud saves delete own objects" on storage.objects;
create policy "atlas cloud saves delete own objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'atlas-cloud-saves'
  and (storage.foldername(name))[1] = auth.uid()::text
);
