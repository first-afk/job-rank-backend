// Audience: maintainers. Run only against the explicitly supplied disposable database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

/** Execute the actual migration and owner/rollback contracts inside a disposable transaction. */
test("atomic cloud workspace, null-safe history and service-only ownership", async () => {
  /** Refuse existing workspace tables and roll back every fixture even after a failed assertion. */
  assert.ok(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable PostgreSQL database.");
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  await client.connect();
  // The fixture creates its own tables and must never replace an existing workspace.
  try {
    await client.query("begin");
    const existing = await client.query("select to_regclass('public.jobs') as jobs, to_regclass('public.user_jobs') as user_jobs");
    assert.equal(existing.rows[0].jobs, null, "The disposable database must have no workspace tables.");
    assert.equal(existing.rows[0].user_jobs, null);
    const fixture = new URL("./fixtures/cloud-job-workspace.sql", import.meta.url);
    let sql = await readFile(fixture, "utf8");
    for (const match of [...sql.matchAll(/^\\ir\s+(.+)$/gm)]) {
      const migration = await readFile(new URL(match[1].trim(), fixture), "utf8");
      sql = sql.replace(match[0], () => migration.replace(/^\s*(begin|commit);\s*$/gim, ""));
    }
    await client.query(sql);
  } finally {
    await client.query("rollback");
    await client.end();
  }
});
