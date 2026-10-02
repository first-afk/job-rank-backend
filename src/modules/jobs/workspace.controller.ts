import type { Request, Response } from "express";
import { z } from "zod";
import { rankingVersion } from "../rankings/ranking.configuration.js";
import { AppError } from "../../middleware/error-handling.js";
import { supabaseAdmin } from "../../config/supabase.js";

const workspaceSchema = z.object({
  replace: z.boolean().default(true),
  sourceSite: z.string().min(1).max(100),
  jobs: z.array(z.object({
    id: z.string().min(1).max(500), source: z.string().min(1).max(100),
    title: z.string().max(2000), companyName: z.string().max(2000),
    location: z.string().max(2000), description: z.string().max(200000), url: z.string().max(4000),
    applicationStatus: z.enum(["Not Applied", "Applied", "Interviewing", "Offer Received", "Rejected", "Archived"]),
    isHidden: z.boolean().default(false),
  }).passthrough()).max(5000),
});

/** Replace only the authenticated owner's selected workspace, atomically in PostgreSQL. */
export async function saveWorkspace(request: Request, response: Response) {
  const input = workspaceSchema.parse(request.body);
  const keys = new Set(input.jobs.map(job => `${job.source}\0${job.id}`));
  if (keys.size !== input.jobs.length) throw new AppError(400, "DUPLICATE_WORKSPACE_JOB", "Duplicate workspace job IDs.");
  if (input.sourceSite !== "configured" && input.jobs.some(job => job.source !== input.sourceSite)) {
    return response.status(400).json({ error: { code: "INVALID_WORKSPACE_SOURCE", message: "Jobs must belong to the selected source." } });
  }
  const { data, error } = await supabaseAdmin.rpc("save_job_workspace", {
    p_user_id: request.auth!.userId, p_source: input.sourceSite, p_jobs: input.jobs.map(job => ({ ...job, databaseStatus: job.applicationStatus.toLowerCase().replaceAll(" ", "_") })), p_replace: input.replace,
  });
  if (error) throw error;
  return response.json({ data });
}

const pageSize = 200;

/** Read every REST page before exposing a snapshot that the client may replace. */
async function readPages<T>(read: (offset: number) => PromiseLike<{ data: T[] | null; count: number | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  // Exact counts keep lower deployment row caps from looking like complete workspaces.
  while (true) {
    const { data, count, error } = await read(rows.length);
    if (error) throw error;
    if (!data || count === null) throw new Error("Could not read the complete cloud workspace.");
    rows.push(...data);
    if (rows.length >= count) return rows;
    if (data.length === 0) throw new Error("The cloud workspace changed during loading. Please retry.");
  }
}

/** Restore server-owned ratings separately from notes, with complete owner-scoped pages. */
export async function getWorkspace(request: Request, response: Response) {
  const owner = request.auth!.userId;
  const rows = await readPages(offset => supabaseAdmin.from("user_jobs")
    .select("job_id,workspace_data,application_status,application_notes,interviews_needed,is_hidden,jobs(*)", { count: "exact" })
    .eq("user_id", owner).order("job_id").range(offset, offset + pageSize - 1));
  const ratings = new Map<string, Record<string, unknown>[]>();
  // Bound each lookup while joining only snapshots referenced by this owner's valid cache.
  for (let offset = 0; offset < rows.length; offset += pageSize) {
    const ids = rows.slice(offset, offset + pageSize).map(row => row.job_id);
    const cache = await readPages(page => supabaseAdmin.from("job_rankings")
      .select("job_id,candidate_profile_id,ranking_run_id", { count: "exact" })
      .eq("user_id", owner).eq("status", "rated").eq("ranking_version", rankingVersion)
      .in("job_id", ids).order("job_id").order("candidate_profile_id").range(page, page + pageSize - 1));
    if (cache.length === 0) continue;
    const runIds = [...new Set(cache.map(rating => rating.ranking_run_id))];
    const byKey = new Map<string, any>();
    // Keep REST URLs bounded even when several historical profiles rated the same jobs.
    for (let runOffset = 0; runOffset < runIds.length; runOffset += pageSize) {
      const snapshots = await readPages(page => supabaseAdmin.from("ranking_run_jobs")
        .select("ranking_run_id,job_id,result_snapshot", { count: "exact" })
        .in("ranking_run_id", runIds.slice(runOffset, runOffset + pageSize)).in("job_id", ids).eq("status", "rated")
        .order("ranking_run_id").order("job_id").range(page, page + pageSize - 1));
      for (const row of snapshots) byKey.set(`${row.ranking_run_id}:${row.job_id}`, row.result_snapshot);
    }
    // Cache membership admits the result; the client checks its profile and prompt identity.
    for (const rating of cache) {
      const snapshot = byKey.get(`${rating.ranking_run_id}:${rating.job_id}`);
      if (!snapshot || snapshot.candidate_profile_id !== rating.candidate_profile_id) continue;
      const values = ratings.get(rating.job_id) ?? [];
      values.push(snapshot);
      ratings.set(rating.job_id, values);
    }
  }
  return response.json({ data: rows.map(row => ({ ...row, ranking_results: ratings.get(row.job_id) ?? [] })) });
}
