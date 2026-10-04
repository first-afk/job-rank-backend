begin;

-- Replace the applied four-argument function so an old overload cannot retain shared-content writes.
drop function public.save_job_workspace(uuid, text, jsonb, boolean);

-- Normal saves own annotations. Only an explicit fresh provider import may update shared postings.
create function public.save_job_workspace(
  p_user_id uuid,
  p_source text,
  p_jobs jsonb,
  p_replace boolean,
  p_refresh_provider_content boolean default false
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  job_uuid uuid;
  kept uuid[] := '{}';
  result jsonb := '[]';
begin
  if p_refresh_provider_content and p_replace then
    raise exception 'Provider refresh requires an import without workspace replacement';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':jobs', 0));
  -- Register missing jobs, preserve ordinary shared content, and mutate only this owner's annotations.
  for item in select value from pg_catalog.jsonb_array_elements(p_jobs) loop
    insert into public.jobs (
      source, external_id, title, company_name, location, description,
      application_url, provider_payload, last_fetched_at
    ) values (
      item->>'source', item->>'id', item->>'title', item->>'companyName',
      item->>'location', item->>'description', item->>'url',
      case when pg_catalog.jsonb_typeof(item->'apiJobData') = 'object' then item->'apiJobData' else '{}'::jsonb end,
      now()
    )
    on conflict (source, external_id) do update set
      title = excluded.title,
      company_name = excluded.company_name,
      location = excluded.location,
      description = excluded.description,
      application_url = excluded.application_url,
      provider_payload = excluded.provider_payload,
      last_fetched_at = excluded.last_fetched_at
    where p_refresh_provider_content
    returning id into job_uuid;
    if job_uuid is null then
      select id into strict job_uuid from public.jobs
      where source = item->>'source' and external_id = item->>'id';
    end if;
    kept := pg_catalog.array_append(kept, job_uuid);
    insert into public.user_jobs (
      user_id, job_id, workspace_data, application_status,
      application_notes, interviews_needed, is_hidden
    ) values (
      p_user_id, job_uuid, item, (item->>'databaseStatus')::public.application_status,
      coalesce(item->>'applicationNotes', ''), coalesce(item->>'interviewsNeeded', ''),
      coalesce((item->>'isHidden')::boolean, false)
    )
    on conflict (user_id, job_id) do update set
      workspace_data = case when p_replace then excluded.workspace_data else public.user_jobs.workspace_data end,
      application_status = case when p_replace then excluded.application_status else public.user_jobs.application_status end,
      application_notes = case when p_replace then excluded.application_notes else public.user_jobs.application_notes end,
      interviews_needed = case when p_replace then excluded.interviews_needed else public.user_jobs.interviews_needed end,
      is_hidden = case when p_replace then excluded.is_hidden else public.user_jobs.is_hidden end,
      updated_at = now();
    result := result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('external_id', item->>'id', 'id', job_uuid));
  end loop;
  delete from public.user_jobs uj using public.jobs j
    where p_replace and uj.user_id = p_user_id and uj.job_id = j.id
      and (p_source = 'configured' or j.source = p_source) and not (uj.job_id = any(kept));
  return result;
end;
$$;
revoke all on function public.save_job_workspace(uuid, text, jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.save_job_workspace(uuid, text, jsonb, boolean, boolean) to service_role;

commit;
