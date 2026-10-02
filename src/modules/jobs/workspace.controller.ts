import type { Request, Response } from "express";
import { z } from "zod";
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

/** Reload user annotations alongside canonical provider fields; never read another owner's jobs. */
export async function getWorkspace(request: Request, response: Response) {
  const { data, error } = await supabaseAdmin.from("user_jobs")
    .select("job_id,workspace_data,application_status,application_notes,interviews_needed,is_hidden,jobs(*)")
    .eq("user_id", request.auth!.userId);
  if (error) throw error;
  return response.json({ data });
}
