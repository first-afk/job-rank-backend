<!-- Target audience: backend maintainers -->
# Keep candidate file writes on the backend

Candidate document rows hold extracted text, a content hash, and a revision.
Changing an original file directly in Storage leaves those values stale.
The existing own-folder upload/update/delete policies allow that separate path.

Apply `20260926162159_backend_owned_candidate_storage.sql` to require candidate
file writes to use the backend's authenticated document API. The three
restrictive policies block direct `anon` and `authenticated` inserts, updates,
and deletes in `candidate-documents`, even when another permissive policy
allows them. The update rule checks both the old and new bucket so a file cannot
be moved into this bucket through another bucket's policy.

Existing read policies, other buckets' rules, and the private bucket setting
stay in place. The backend uses its server-only Supabase secret key; its
`service_role` bypasses RLS and can still upload and clean up files. Never place
that key in a client. This policy does not itself make database replacement
atomic or provide file deletion/retention UI.

## Apply and verify

This is an incremental migration for an existing Supabase project with Storage
and the `candidate-documents` bucket, not a complete fresh-project schema.
Review the target's current policies and clients before applying it through
your normal migration process. Clients that write directly to this bucket must
first use the backend API; read-only clients need no change. Stop rollout if a
required client still relies on direct writes. No live migration is performed
by opening this PR.

In staging, verify that an ordinary user's direct upload, replacement, move-in,
and deletion fail; their own permitted reads still work; another user's files
stay hidden; and the backend upload/cleanup path succeeds. Also check an
unrelated bucket that permits writes. The local regression fixture tests these
RLS contracts in PostgreSQL; it does not exercise the hosted Storage HTTP API.

If rollback is needed, drop only `candidate_documents_backend_insert`,
`candidate_documents_backend_update`, and `candidate_documents_backend_delete`
on `storage.objects`. This restores the previous write policies and their
consistency risk; it does not undo files already written through the backend.

References: [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
and [PostgreSQL policy composition](https://www.postgresql.org/docs/current/sql-createpolicy.html).

## Regression check

Create a disposable empty PostgreSQL database, then run:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/candidate-storage-policy.sql
```

The connection must be able to create test roles and schemas. Drop the test
database afterward. Do not run the fixture in an existing Supabase database:
it creates its own small `storage.objects` table. The check compares the old
permitted writes with the migration's denied writes and verifies the read,
other-bucket, move-in, and backend cleanup contracts.
