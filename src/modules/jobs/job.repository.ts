import { createHash } from "node:crypto";
import { supabaseAdmin } from "../../config/supabase.js";

function normalizeJob(job: Record<string, unknown>) {
  const title = job.title?.toString().trim() ?? "";

  const locations = Array.isArray(job.locations_derived)
    ? job.locations_derived.map((value: unknown) => String(value)).join(" / ")
    : "";

  const location =
    locations ||
    job.address_locality?.toString() ||
    job.location?.toString() ||
    "";

  const description =
    job.description_text?.toString() || job.description?.toString() || "";

  const applicationUrl = job.url?.toString() ?? "";

  const fallbackId = createHash("sha256")
    .update(
      [
        title,
        job.organization ?? job.company ?? "",
        location,
        applicationUrl,
      ].join("|"),
    )
    .digest("hex");

  const externalId =
    job.id?.toString() ||
    job.job_id?.toString() ||
    applicationUrl ||
    fallbackId;

  return {
    external_id: externalId,
    source: "jobsdb",
    title: String(job.title ?? ""),
    company_name: String(job.organization ?? job.company ?? ""),
    location: String(job.location ?? ""),
    description,
    application_url: String(job.url ?? ""),
    provider_date_posted:
      job.date_posted?.toString() ?? job.datePosted?.toString() ?? null,
    provider_payload: job,
    last_fetched_at: new Date().toISOString(),
    content_hash: createHash("sha256")
      .update(JSON.stringify(job))
      .digest("hex"),
  };
}

export async function saveSearchResults(
  userId: string | undefined,
  providerJobs: Record<string, unknown>[],
) {
  const normalizedJobs = providerJobs
    .map(normalizeJob)
    .filter((job) => job.external_id && job.title);

  if (normalizedJobs.length === 0) return [];

  const { data: jobs, error } = await supabaseAdmin
    .from("jobs")
    .upsert(normalizedJobs, {
      onConflict: "source,external_id",
    })
    .select();

  if (error) throw error;

  const userJobs = jobs.map((job) => ({
    user_id: userId,
    job_id: job.id,
  }));

  const { error: associationError } = await supabaseAdmin
    .from("user_jobs")
    .upsert(userJobs, {
      onConflict: "user_id,job_id",
      ignoreDuplicates: true,
    });

  if (associationError) throw associationError;

  return jobs;
}
