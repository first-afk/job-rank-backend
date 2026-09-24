import { supabaseAdmin } from "../../config/supabase.js";

export async function createRankingRun(
  userId: string | undefined,
  jobIds: string[],
) {
  const { data: activeCv, error: cvError } = await supabaseAdmin
    .from("candidate_documents")
    .select("id")
    .eq("user_id", userId)
    .eq("document_type", "cv")
    .eq("is_active", true)
    .maybeSingle();

  if (cvError) throw cvError;
  if (!activeCv) throw new Error("ACTIVE_CV_NOT_FOUND");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", userId)
    .eq("cv_document_id", activeCv.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) throw new Error("SKILLS_PROFILE_NOT_FOUND");

  // Users may only rank jobs associated with their account.
  const { data: userJobs, error: jobsError } = await supabaseAdmin
    .from("user_jobs")
    .select("job_id")
    .eq("user_id", userId)
    .in("job_id", jobIds);

  if (jobsError) throw jobsError;

  const allowedJobIds = userJobs.map((record) => record.job_id);

  if (allowedJobIds.length !== jobIds.length) {
    throw new Error("INVALID_JOB_SELECTION");
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from("ranking_runs")
    .insert({
      user_id: userId,
      candidate_profile_id: profile.id,
      total_jobs: jobIds.length,
    })
    .select()
    .single();

  if (runError) throw runError;

  return {
    run,
    jobIds: allowedJobIds,
  };
}
