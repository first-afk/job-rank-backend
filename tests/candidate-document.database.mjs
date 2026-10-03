// Requires explicit TEST_DATABASE_URL; never reads app configuration or .env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
test("atomic document replacement and server-only execution", async () => {
  /** Use a disposable schema to prove atomic replacement and caller permissions. */
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(
    databaseUrl,
    "Set TEST_DATABASE_URL to an empty disposable PostgreSQL database.",
  );
  const config = {
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  };
  const clients = [];
  async function connect(role) {
    const client = new pg.Client(config);
    await client.connect();
    clients.push(client);
    if (role) await client.query("set role " + role);
    return client;
  }
  const uid = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
  const did = (n) => "10000000-0000-0000-0000-" + String(n).padStart(12, "0");
  /** Replace synthetic document IDs through the real transactional database function. */
  const call = (
    client,
    id,
    user = 1,
    filename = "synthetic.txt",
    kind = "cv",
  ) =>
    client.query(
      "select * from public.replace_candidate_document($1,$2,$3,$4,$5,$6,$7)",
      [
        did(id),
        uid(user),
        kind,
        filename,
        "synthetic/" + id + ".txt",
        "Synthetic CV",
        "synthetic-hash",
      ],
    );
  try {
    // Build disposable fixtures and verify transactions and service-only execution.
    const owner = await connect();
    const existing = await owner.query(
      "select tablename from pg_tables where schemaname not in ('pg_catalog', 'information_schema')",
    );
    assert.equal(
      existing.rowCount,
      0,
      "Use an empty disposable database; the fixture must not change existing application tables.",
    );
    await owner.query(
      await readFile(
        new URL("./fixtures/candidate-documents.sql", import.meta.url),
        "utf8",
      ),
    );
    await owner.query(
      await readFile(
        new URL(
          "../supabase/migrations/20260926162109_replace_candidate_document_atomic.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const fn = (
      await owner.query(
        "select prosecdef, proconfig from pg_proc where proname='replace_candidate_document'",
      )
    ).rows[0];
    assert.equal(fn.prosecdef, false);
    assert.deepEqual(fn.proconfig, ['search_path=""']);
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(
        () => connect(role).then((c) => call(c, 1)),
        (e) =>
          e.code === "42501" &&
          /permission denied for function/.test(e.message),
      );
    }
    const service = await connect("service_role");
    assert.equal((await call(service, 1)).rows[0].revision, 1);
    await assert.rejects(
      () => call(service, 2, 1, ""),
      (e) => e.code === "23514",
    );
    let documents = (
      await owner.query(
        "select revision,is_active from public.candidate_documents",
      )
    ).rows;
    assert.deepEqual(documents, [{ revision: 1, is_active: true }]);
    await assert.rejects(
      () => call(service, 2, 1, "synthetic.txt", "invalid"),
      (e) => e.code === "22P02",
    );

    await service.query("begin");
    assert.equal((await call(service, 2)).rows[0].revision, 2);
    const contender = await connect("service_role");
    await contender.query(
      "set application_name='document-integrity-contender'",
    );
    let completed = false;
    const pending = call(contender, 3).then((result) => {
      completed = true;
      return result;
    });
    // Observe the lock itself, rather than assuming overlapping requests raced.
    let waiting = false;
    for (let i = 0; i < 40; i++) {
      const result = await owner.query(
        "select 1 from pg_stat_activity where application_name='document-integrity-contender' and wait_event='advisory'",
      );
      if (result.rowCount) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(waiting, true);
    assert.equal(completed, false);
    const independent = await connect("service_role");
    assert.equal((await call(independent, 4, 2)).rows[0].revision, 1);
    assert.equal(
      (await call(independent, 5, 1, "synthetic.txt", "about_you")).rows[0]
        .revision,
      1,
    );
    assert.equal(
      completed,
      false,
      "Other user/type finished while the same user/type still waits",
    );
    await service.query("commit");
    assert.equal((await pending).rows[0].revision, 3);
    documents = (
      await owner.query(
        "select revision,is_active from public.candidate_documents where user_id=$1 and document_type='cv' order by revision",
        [uid(1)],
      )
    ).rows;
    assert.deepEqual(documents, [
      { revision: 1, is_active: false },
      { revision: 2, is_active: false },
      { revision: 3, is_active: true },
    ]);
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()));
  }
});
