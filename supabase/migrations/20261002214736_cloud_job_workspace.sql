begin;

-- Keep owner-specific job annotations separate from shared provider postings.
-- Existing user_jobs/user_preferences RLS continues to protect these columns.
alter table public.user_jobs add column if not exists workspace_data jsonb;
alter table public.user_preferences add column if not exists source_settings jsonb;
-- Each run retains its result even when the latest-rating cache is replaced.
alter table public.ranking_run_jobs add column if not exists result_snapshot jsonb;

commit;

-- Serialize replacement for one account. A failed write must not leave a
-- partly deleted workspace; shared provider rows are never removed here.
create or replace function public.save_job_workspace(p_user_id uuid, p_source text, p_jobs jsonb, p_replace boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare item jsonb; job_uuid uuid; kept uuid[] := '{}'; result jsonb := '[]';
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':jobs', 0));
  for item in select value from pg_catalog.jsonb_array_elements(p_jobs) loop
    -- Upsert shared postings while replacing or preserving only this owner’s annotations.
    insert into public.jobs (source, external_id, title, company_name, location, description, application_url, provider_payload, last_fetched_at)
    values (item->>'source', item->>'id', item->>'title', item->>'companyName', item->>'location', item->>'description', item->>'url', case when pg_catalog.jsonb_typeof(item->'apiJobData') = 'object' then item->'apiJobData' else '{}'::jsonb end, now())
    on conflict (source, external_id) do update set title = excluded.title, company_name = excluded.company_name,
      location = excluded.location, description = excluded.description, application_url = excluded.application_url,
      provider_payload = excluded.provider_payload, last_fetched_at = excluded.last_fetched_at
    returning id into job_uuid;
    kept := pg_catalog.array_append(kept, job_uuid);
    insert into public.user_jobs (user_id, job_id, workspace_data, application_status, application_notes, interviews_needed, is_hidden)
    values (p_user_id, job_uuid, item, (item->>'databaseStatus')::public.application_status,
      coalesce(item->>'applicationNotes', ''), coalesce(item->>'interviewsNeeded', ''), coalesce((item->>'isHidden')::boolean, false))
    on conflict (user_id, job_id) do update set workspace_data = case when p_replace then excluded.workspace_data else public.user_jobs.workspace_data end,
      application_status = case when p_replace then excluded.application_status else public.user_jobs.application_status end, application_notes = case when p_replace then excluded.application_notes else public.user_jobs.application_notes end,
      interviews_needed = case when p_replace then excluded.interviews_needed else public.user_jobs.interviews_needed end, is_hidden = case when p_replace then excluded.is_hidden else public.user_jobs.is_hidden end, updated_at = now();
    result := result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('external_id', item->>'id', 'id', job_uuid));
  end loop;
  delete from public.user_jobs uj using public.jobs j
    where p_replace and uj.user_id = p_user_id and uj.job_id = j.id
      and (p_source = 'configured' or j.source = p_source) and not (uj.job_id = any(kept));
  return result;
end;
$$;
revoke all on function public.save_job_workspace(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.save_job_workspace(uuid, text, jsonb, boolean) to service_role;

-- History removal and reordering commit together. NULL cities share one identity
-- through the existing saved_searches_unique_parameters NULLS NOT DISTINCT index.
create or replace function public.save_search_history(p_user_id uuid, p_searches jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb; search_id uuid; kept uuid[] := '{}'; position integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':searches', 0));
  for item in select value from pg_catalog.jsonb_array_elements(p_searches) loop
    insert into public.saved_searches (user_id, query, location_mode, country_scope, has_salary, city, last_used_at)
    values (p_user_id, item->>'query', item->>'locationMode', item->>'countryScope', (item->>'hasSalary')::boolean,
      nullif(btrim(item->>'city'), ''), now() - position * interval '1 second')
    on conflict (user_id, query, location_mode, country_scope, has_salary, city) do update set last_used_at = excluded.last_used_at
    returning id into search_id;
    kept := pg_catalog.array_append(kept, search_id);
    position := position + 1;
  end loop;
  delete from public.saved_searches where user_id = p_user_id and not (id = any(kept));
end;
$$;
revoke all on function public.save_search_history(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_search_history(uuid, jsonb) to service_role;
