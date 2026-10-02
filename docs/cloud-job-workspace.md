<!-- Target audience: maintainers and agents -->
# Cloud job workspace

Deploy the candidate API and the error handling, atomic document replacement and storage write-policy fixes before enabling the paired cloud client. Apply the migrations in filename order, including `20261002214736_cloud_job_workspace.sql`. The workspace migration adds owner snapshots, source settings, stable run results and atomic service-only RPCs; it leaves existing row-level policies in place.

JobsDB and LinkedIn searches save account history with the existing NULL-safe parameter uniqueness rule. Public source adapters can register normalized jobs through `/v1/jobs/workspace`. Replacement removes only the authenticated owner's selected associations; shared public postings remain cached. Import for ranking preserves existing owner annotations. Missing or JSON-null provider payloads become empty objects to satisfy the live object constraint.

Ranking uses the active CV/profile, current schema/policy, owner job memberships and per-run snapshots. Counters use processed/succeeded/failed jobs. Failed retries preserve earlier valid ratings. The worker rejects results if the CV or saved job changes while a provider is running. `/v1/ranking-runs/configuration` publishes only classifier/model/version so the client checks freshness against server policy.

Configure `JOBRANK_CLASSIFIER` (`jev` default or `llm`), `TYPESAFE_API_KEY`/`JEV_MODEL` for Jev, or `OPENROUTER_API_KEY`/`JOBRANK_RANKING_MODEL` for LLM. Search needs a subscribed `JOBSDB_API_KEY`; ATS and LinkedIn host/endpoint settings must match that subscription. Keep keys in server configuration.

Run `npm run type-check`, `npm test`, and `TEST_DATABASE_URL=... npm run test:database` with a disposable PostgreSQL database. Storage-policy SQL tests require the migration test schema. Live verification in this task used the branch API on loopback against real Supabase and provider services; upstream deployment is still a separate action.
