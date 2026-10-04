-- Document writes must pass through the API so file contents and document
-- text/hash/revision cannot be changed independently. Keep existing read rules.
begin;

create policy candidate_documents_backend_insert
on storage.objects as restrictive for insert to anon, authenticated
with check (bucket_id <> 'candidate-documents');

create policy candidate_documents_backend_update
on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'candidate-documents')
with check (bucket_id <> 'candidate-documents');

create policy candidate_documents_backend_delete
on storage.objects as restrictive for delete to anon, authenticated
using (bucket_id <> 'candidate-documents');

commit;
