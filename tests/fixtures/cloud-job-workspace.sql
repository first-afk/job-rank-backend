-- Target audience: agents. Behavior checks for the actual cloud migration on synthetic tables.
create type public.application_status as enum ('not_applied','applied','interviewing','offer_received','rejected','archived');
create table public.jobs (id uuid primary key default gen_random_uuid(), source text not null, external_id text not null,
 title text,company_name text,location text,description text,application_url text,provider_payload jsonb not null check (jsonb_typeof(provider_payload) = 'object'),last_fetched_at timestamptz,
 unique(source,external_id));
create table public.user_jobs (user_id uuid,job_id uuid references public.jobs(id),application_status public.application_status,
 application_notes text,interviews_needed text,is_hidden boolean,updated_at timestamptz,primary key(user_id,job_id));
create table public.user_preferences(user_id uuid primary key);
create table public.ranking_run_jobs(ranking_run_id uuid,job_id uuid);
create table public.saved_searches(id uuid primary key default gen_random_uuid(),user_id uuid,query text,location_mode text,
 country_scope text,has_salary boolean,city text,last_used_at timestamptz,
 unique nulls not distinct(user_id,query,location_mode,country_scope,has_salary,city));
\ir ../../supabase/migrations/20261002214736_cloud_job_workspace.sql
\ir ../../supabase/migrations/20261004093017_cloud_workspace_provider_ownership.sql

-- Prove cross-account posting ownership, annotation preservation, and rollback using the actual RPCs.
do $$
declare a uuid := '00000000-0000-0000-0000-000000000001'; b uuid := '00000000-0000-0000-0000-000000000002';
 job jsonb := '{"id":"posting-1","source":"jobicy","title":"API engineer","companyName":"Test","location":"Remote","description":"Python","url":"https://example.com","applicationStatus":"Applied","databaseStatus":"applied","applicationNotes":"Keep this note","isHidden":true,"apiJobData":null}';
 other jsonb := '{"id":"posting-2","source":"greenhouse","title":"Engineer","companyName":"Test","location":"London","description":"Python","url":"https://example.com","applicationStatus":"Not Applied","databaseStatus":"not_applied"}';
 history jsonb := '[{"query":"Python","locationMode":"all","countryScope":"","hasSalary":false,"city":null}]';
 before_data jsonb;
begin
 perform public.save_job_workspace(a,'configured',jsonb_build_array(job,other),true);
 perform public.save_job_workspace(b,'configured',jsonb_build_array(job || '{"description":"Stale other-account content"}'),true);
 if (select description from public.jobs where external_id='posting-1') <> 'Python' then raise exception 'Another account annotation save overwrote shared content'; end if;
 perform public.save_job_workspace(a,'configured',jsonb_build_array(job || '{"title":"Fresh title","description":"Fresh provider content","url":"https://example.com/new","apiJobData":{"revision":2}}'),false,true);
 perform public.save_job_workspace(b,'configured',jsonb_build_array(job || '{"applicationNotes":"New owner note"}'),true,false);
 if (select description from public.jobs where external_id='posting-1') <> 'Fresh provider content'
 or (select title from public.jobs where external_id='posting-1') <> 'Fresh title'
 or (select application_url from public.jobs where external_id='posting-1') <> 'https://example.com/new'
 or (select provider_payload from public.jobs where external_id='posting-1') <> '{"revision":2}'::jsonb then raise exception 'Annotation save reverted an explicit provider refresh'; end if;
 if (select application_notes from public.user_jobs where user_id=b) <> 'New owner note' then raise exception 'Owner annotation save failed'; end if;
 begin
  perform public.save_job_workspace(a,'configured',jsonb_build_array(job),true,true);
  raise exception 'Invalid destructive provider refresh succeeded';
 exception when raise_exception then
  if sqlerrm <> 'Provider refresh requires an import without workspace replacement' then raise; end if;
 end;
 if (select count(*) from public.jobs) <> 2 then raise exception 'Global posting deduplication failed'; end if;
 perform public.save_job_workspace(a,'configured',jsonb_build_array(job || '{"applicationNotes":"overwrite","databaseStatus":"not_applied"}'),false);
 if (select application_notes from public.user_jobs where user_id=a and workspace_data->>'id'='posting-1') <> 'Keep this note' then raise exception 'Import overwrote annotations'; end if;
 if not (select is_hidden from public.user_jobs where user_id=a and workspace_data->>'id'='posting-1') then raise exception 'Hidden state lost'; end if;
 select jsonb_agg(workspace_data order by job_id) into before_data from public.user_jobs where user_id=a;
 begin
  perform public.save_job_workspace(a,'configured',jsonb_build_array(job || '{"applicationNotes":"partial"}', other || '{"databaseStatus":"invalid"}'),true);
  raise exception 'Invalid replacement succeeded';
 exception when invalid_text_representation then null;
 end;
 if before_data is distinct from (select jsonb_agg(workspace_data order by job_id) from public.user_jobs where user_id=a) then raise exception 'Failed replacement partially committed'; end if;
 perform public.save_job_workspace(a,'jobicy','[]',true);
 if (select count(*) from public.user_jobs where user_id=a) <> 1 then raise exception 'Source-scoped removal failed'; end if;
 if (select count(*) from public.user_jobs where user_id=b) <> 1 then raise exception 'Removal affected another owner'; end if;
 if (select count(*) from public.jobs) <> 2 then raise exception 'Removal deleted shared postings'; end if;
 perform public.save_search_history(a,history);
 perform public.save_search_history(a,history);
 perform public.save_search_history(b,history);
 if (select count(*) from public.saved_searches) <> 2 then raise exception 'NULL-city query deduplication failed'; end if;
 perform public.save_search_history(a,'[]');
 if (select count(*) from public.saved_searches where user_id=b) <> 1 then raise exception 'History removal affected another owner'; end if;
 if to_regprocedure('public.save_job_workspace(uuid,text,jsonb,boolean)') is not null then raise exception 'Old four-argument write function survived'; end if;
 if not has_function_privilege('service_role','public.save_job_workspace(uuid,text,jsonb,boolean,boolean)','execute') then raise exception 'Service cannot save workspace'; end if;
 if has_function_privilege('authenticated','public.save_job_workspace(uuid,text,jsonb,boolean,boolean)','execute')
 or has_function_privilege('anon','public.save_job_workspace(uuid,text,jsonb,boolean,boolean)','execute')
 or has_function_privilege('anon','public.save_search_history(uuid,jsonb)','execute') then raise exception 'Browser can forge RPC owner'; end if;
end $$;
