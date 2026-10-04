// Actual upload controller with fake SDK responses; never contacts a service.
import { test } from "node:test";
import assert from "node:assert/strict";
test("document publication and storage compensation", async (t) => {
  /** Exercise upload publication and compensation without touching live accounts. */
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: new URL("./fixtures/no-runtime-env", import.meta.url)
      .pathname,
    NODE_ENV: "test",
    FRONTEND_URL: "http://localhost:3001",
    SUPABASE_URL: "https://synthetic.invalid",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
    SUPABASE_SECRET_KEY: "synthetic-secret",
    OPENROUTER_API_KEY: "synthetic",
    JOBSDB_API_KEY: "synthetic",
  });
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network prohibited");
  };
  const { supabaseAdmin } = await import("../src/config/supabase.ts");
  const { uploadCandidateDocument } =
    await import("../src/modules/candidate/candidate.controller.ts");
  const scenarios = [
    "success",
    "insert_rejected",
    "cleanup_error",
    "cleanup_throw",
    "transport_error_after_commit",
    "transport_throw_after_commit",
    "response_shape_error_after_commit",
    "completion_unknown",
    "storage_error",
  ];
  for (const scenario of scenarios) {
    // Run each isolated upload outcome against the same publication contract.
    let committed = false;
    let oldActive = true;
    let objects = 0;
    let cleanupCalls = 0;
    let rpcCalls = 0;
    let logged = "";
    await t.test(scenario, async () => {
      /** Isolate each transport outcome and check whether storage cleanup is safe. */
      const originalError = console.error;
      console.error = (...args) => {
        logged += JSON.stringify(args);
      };
      supabaseAdmin.from = (() => {
        throw new Error(
          "Controller must not update document rows outside the RPC",
        );
      }) as any;
      /** Model storage cleanup failures while preserving files for uncertain database outcomes. */
      supabaseAdmin.storage.from = (() => ({
        upload: async () => {
          if (scenario === "storage_error") return { error: { code: "503" } };
          objects++;
          return { error: null };
        },
        remove: async () => {
          cleanupCalls++;
          if (scenario === "cleanup_throw")
            throw new Error("SYNTHETIC_PRIVATE_ERROR");
          if (scenario === "cleanup_error")
            return { error: { message: "SYNTHETIC_PRIVATE_ERROR" } };
          objects--;
          return { error: null };
        },
      })) as any;
      supabaseAdmin.rpc = ((name: string, args: any) => ({
        /** Distinguish confirmed database rejection from an unknown commit outcome. */
        single: async () => {
          rpcCalls++;
          assert.equal(name, "replace_candidate_document");
          assert.equal(args.p_user_id, "synthetic-user");
          assert.equal(args.p_document_type, "cv");
          assert.equal(args.p_extracted_text, "Synthetic private CV");
          assert.equal(args.p_content_hash.length, 64);
          if (
            ["insert_rejected", "cleanup_error", "cleanup_throw"].includes(
              scenario,
            )
          )
            return {
              data: null,
              error: {
                code: "23514",
                message: "SYNTHETIC_PRIVATE_ERROR",
                details: args.p_extracted_text,
              },
            };
          committed = true;
          oldActive = false;
          if (scenario === "transport_throw_after_commit")
            throw new Error("SYNTHETIC_PRIVATE_ERROR");
          if (scenario === "transport_error_after_commit")
            return { data: null, error: { code: "", message: "fetch failed" } };
          if (scenario === "response_shape_error_after_commit")
            return { data: null, error: { code: "PGRST116" } };
          if (scenario === "completion_unknown")
            return { data: null, error: { code: "40003" } };
          return {
            data: { id: args.p_id, revision: 2, is_active: true },
            error: null,
          };
        },
      })) as any;
      let status = 0;
      let body: any;
      const response: any = {
        status: (value: number) => {
          status = value;
          return response;
        },
        json: (value: any) => {
          body = value;
          return response;
        },
      };
      try {
        // Exercise the actual upload handler while ensuring logging is restored afterward.
        await uploadCandidateDocument(
          {
            auth: { userId: "synthetic-user" },
            body: { documentType: "cv" },
            file: {
              originalname: "synthetic.txt",
              mimetype: "text/plain",
              buffer: Buffer.from("Synthetic private CV"),
            },
          } as any,
          response,
        );
      } finally {
        console.error = originalError;
      }
      assert.equal(status, scenario === "success" ? 201 : 500);
      assert.equal(rpcCalls, scenario === "storage_error" ? 0 : 1);
      assert.equal(
        cleanupCalls,
        ["insert_rejected", "cleanup_error", "cleanup_throw"].includes(scenario)
          ? 1
          : 0,
      );
      if (committed)
        assert.equal(
          objects,
          1,
          "A committed document must keep its file even when the response was lost",
        );
      if (scenario === "insert_rejected") {
        assert.equal(objects, 0);
        assert.equal(oldActive, true);
      }
      if (["cleanup_error", "cleanup_throw"].includes(scenario)) {
        assert.equal(objects, 1);
        assert.match(logged, /cleanup failed/);
      }
      assert.doesNotMatch(
        logged + JSON.stringify(body),
        /Synthetic private CV|SYNTHETIC_PRIVATE_ERROR/,
      );
    });
  }
  assert.equal(networkCalls, 0);
});
