begin;

-- The storage object is uploaded first. This function atomically publishes its
-- database record and retires the previous document of the same type.
create or replace function public.replace_candidate_document(
  p_id uuid,
  p_user_id uuid,
  p_document_type text,
  p_filename text,
  p_storage_path text,
  p_extracted_text text,
  p_content_hash text
)
returns public.candidate_documents
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  document_kind public.candidate_documents.document_type%type;
  next_revision integer;
  new_document public.candidate_documents%rowtype;
begin
  document_kind := p_document_type;

  -- Also locks the first upload, when there is no existing row to lock.
  -- Transaction-scoped locks are released on both commit and rollback.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_document_type, 0)
  );

  select coalesce(max(revision), 0) + 1 into next_revision
  from public.candidate_documents
  where user_id = p_user_id and document_type = document_kind;

  update public.candidate_documents
  set is_active = false
  where user_id = p_user_id and document_type = document_kind and is_active;

  insert into public.candidate_documents (
    id, user_id, document_type, filename, storage_path,
    extracted_text, content_hash, revision, is_active
  ) values (
    p_id, p_user_id, document_kind, p_filename, p_storage_path,
    p_extracted_text, p_content_hash, next_revision, true
  )
  returning * into new_document;

  return new_document;
end;
$function$;

-- The server derives p_user_id from a verified token. Browsers must not call
-- this function with an arbitrary owner ID, even for their own documents.
revoke all on function public.replace_candidate_document(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.replace_candidate_document(uuid, uuid, text, text, text, text, text)
  to service_role;

commit;
