-- Target audience: agents. Minimal synthetic fixture, disposable database only.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key);
create type public.synthetic_document_type as enum ('cv', 'about_you');
create table public.candidate_documents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type public.synthetic_document_type not null,
  filename text not null check (btrim(filename) <> ''),
  storage_path text unique,
  extracted_text text not null default '',
  content_hash text not null check (btrim(content_hash) <> ''),
  revision integer not null default 1 check (revision > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index candidate_documents_one_active_type_idx
  on public.candidate_documents (user_id, document_type) where is_active;
alter table public.candidate_documents enable row level security;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update on public.candidate_documents to service_role;
-- Deliberately generous table grants: the RPC execute boundary must still deny.
grant select, insert, update on public.candidate_documents to anon, authenticated;
insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
