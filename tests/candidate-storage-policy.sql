-- Audience: maintainers. Run with psql -v ON_ERROR_STOP=1 in a disposable,
-- empty PostgreSQL database as a role allowed to create test roles/schemas.
-- It uses no Supabase service, real credentials, or user data.
create schema storage;
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create table storage.objects(id integer primary key,bucket_id text not null,name text not null);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
create policy own_files on storage.objects for all to authenticated
  using (split_part(name,'/',1)=current_setting('test.owner',true))
  with check (split_part(name,'/',1)=current_setting('test.owner',true));
insert into storage.objects values
  (1,'candidate-documents','alice/cv.txt'),
  (2,'other','alice/file.txt'),
  (3,'candidate-documents','bob/cv.txt');

-- Control: the old own-folder policy permits all three direct write paths.
set role authenticated;
set test.owner='alice';
insert into storage.objects values(4,'candidate-documents','alice/extra.txt');
do $$ begin
  update storage.objects set name='alice/replaced.txt' where id=4;
  if not found then raise exception 'Control replacement failed'; end if;
  delete from storage.objects where id=4;
  if not found then raise exception 'Control deletion failed'; end if;
end $$;
reset role;

\ir ../supabase/migrations/20260926162159_backend_owned_candidate_storage.sql

set role authenticated;
set test.owner='alice';
-- Prove restrictive candidate-write rules preserve owner reads and other-bucket writes.
do $$ begin
  if (select array_agg(id order by id) from storage.objects) is distinct from array[1,2]
    then raise exception 'Own reads or cross-user isolation changed'; end if;
  begin
    insert into storage.objects values(4,'candidate-documents','alice/extra.txt');
    raise exception 'Direct candidate upload unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  update storage.objects set name='alice/replaced.txt' where id=1;
  if found then raise exception 'Direct candidate replacement allowed'; end if;
  delete from storage.objects where id=1;
  if found then raise exception 'Direct candidate deletion allowed'; end if;
  begin
    update storage.objects set bucket_id='candidate-documents' where id=2;
    raise exception 'Move into candidate bucket unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  insert into storage.objects values(5,'other','alice/extra.txt');
  update storage.objects set name='alice/other.txt' where id=5;
  if not found then raise exception 'Other-bucket replacement blocked'; end if;
  delete from storage.objects where id=5;
  if not found then raise exception 'Other-bucket deletion blocked'; end if;
end $$;
set test.owner='bob';
do $$ begin
  if (select array_agg(id order by id) from storage.objects) is distinct from array[3]
    then raise exception 'Second-user reads changed'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  if exists(select from storage.objects) then raise exception 'Anonymous read allowed'; end if;
  begin
    insert into storage.objects values(6,'candidate-documents','alice/anon.txt');
    raise exception 'Anonymous upload unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
insert into storage.objects values(7,'candidate-documents','alice/server.txt');
do $$ begin
  update storage.objects set name='alice/server-replaced.txt' where id=7;
  if not found then raise exception 'Backend replacement blocked'; end if;
  delete from storage.objects where id=7;
  if not found then raise exception 'Backend cleanup blocked'; end if;
end $$;
reset role;
select 'PASS: client candidate writes denied; reads, other buckets and backend writes preserved' as result;
