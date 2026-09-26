<!-- Target audience: developers and release operators -->
# Replacing candidate documents

The upload API stores a new object, then calls `replace_candidate_document` to
publish its row. The function locks that user's document type, assigns the next
revision, deactivates the old row, and inserts the new row in one transaction.
If insertion fails, the old row stays active. Different users and document types
can upload independently. The existing index that permits only one active row
per user/type stays in place.

The function runs with the caller's privileges (`SECURITY INVOKER`) and an empty
search path. Only `service_role` receives execute permission; the upload API
supplies the owner ID from its verified session. The migration expects the
existing `public.candidate_documents` table and Supabase roles. It does not
create a fresh database or change its row policies. Ordinary user sessions must
not receive execute permission or the backend secret key.

## Deploy

1. Apply the migration to a disposable database with the existing candidate
   table first. Verify failed replacement leaves the old row active, concurrent
   uploads receive distinct revisions, and anonymous/authenticated roles cannot
   call the function.
2. Pause document uploads during rollout. Apply
   `supabase/migrations/20260926162109_replace_candidate_document_atomic.sql`
   through the normal reviewed database release process, then deploy this
   backend version to every API instance. Wait for old upload requests to finish
   before resuming uploads. Old instances do not take the new database lock.
3. Verify one upload and one replacement with a test account. Both must return
   HTTP 201 with the document record; exactly one row of that type remains active.

No remote migration is applied by this change. Rollback also requires pausing
uploads and draining requests. Keeping the unused function is harmless; do not
drop it while the new backend may still call it. Returning to the old upload
code restores its known non-atomic replacement failure.

## Failed or uncertain uploads

A confirmed database rejection allows the API to remove the new storage object.
The code recognizes data/constraint errors and specific transaction, permission,
and function errors. Other errors are treated as uncertain. The SDK does not
retry this POST RPC automatically.

A lost response can happen after a successful commit. In that case the API
returns an upload error but preserves the object. It logs the document ID,
storage path, stage, error code, and storage action. It does not log CV text or
raw database error details. Do not automatically retry the upload on this error;
refresh the active-document list first.

If the log says cleanup failed after a confirmed rejection, retry removal of
that logged object. For an uncertain outcome, check the original document ID
against the primary database after the request has finished. Keep the object
if its row exists, even if a later upload has made it inactive. An empty read
while a request might still commit is not permission to delete. Remove an
unreferenced object only after the original transaction is known to have ended
without publishing it; otherwise retain it for investigation.

This change does not add automatic retries, a cleanup worker, or client-write
storage policy changes. Those are separate concerns.

## Regression tests

`npm test` exercises the upload controller offline with synthetic SDK results.
It does not load the app's `.env` or contact Supabase.

`npm run test:database` requires `TEST_DATABASE_URL` pointing to a fresh, empty
database on a disposable PostgreSQL instance. Use an administrator connection:
the fixture creates the minimal candidate table and the three Supabase roles
when they do not already exist, then tests calls under each role. It never loads
`.env`, provisions a server, or drops an existing database. Create a new empty
test database before each run and discard it afterward. PostgreSQL 17 is the
tested version. For example, with a local test server already running:

```sh
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/candidate_document_test npm run test:database
```

The database test covers failed-insert rollback, concurrent revision allocation,
independent user/type uploads, and rejection of ordinary-user RPC calls. It uses
a small fixture, not a production schema export or live Supabase credentials.
