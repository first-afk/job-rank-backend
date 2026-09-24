import { readFile } from "node:fs/promises";
import { supabaseAdmin } from "../../config/supabase.js";
import { buildRankingPrompt } from "./ranking.prompt.js";
import { calculateCandidateScore } from "./ranking.score.js";

const rankingVersion = "0.0.17";

type DatabaseJob = {
  id: string;
  title: string;
  description: string;
  location: string | null;
  provider_payload: Record<string, unknown> | null;
};

type RankingContext = {
  runId: string;
  userId: string | undefined;
  candidateProfileId: string;
  cvContent: string;
  skillsProfile: unknown;
  schema: unknown;
  model: string;
};

type OpenRouterResult = {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
};

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function parseGeneratedJson(content: string) {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "");

  const parsed: unknown = JSON.parse(cleaned);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Ranking response was not a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

async function callOpenRouter(
  prompt: string,
  model: string,
): Promise<{
  analysis: Record<string, unknown>;
  providerRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}> {
  const apiKey = requiredEnvironmentValue("OPENROUTER_API_KEY");

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: {
          type: "json_object",
        },
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(120000),
    },
  );

  if (!response.ok) {
    const responseBody = await response.text();

    console.error("OpenRouter ranking request failed:", {
      status: response.status,
      responseLength: responseBody.length,
    });

    throw new Error(`OpenRouter returned status ${response.status}.`);
  }

  const result = (await response.json()) as OpenRouterResult;

  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter returned an empty ranking response.");
  }

  return {
    analysis: parseGeneratedJson(content),
    providerRequestId: result.id ?? null,
    inputTokens: result.usage?.prompt_tokens ?? 0,
    outputTokens: result.usage?.completion_tokens ?? 0,
    costUsd: result.usage?.cost ?? 0,
  };
}

async function loadRankingContext(
  runId: string,
  userId: string | undefined,
): Promise<RankingContext> {
  const { data: run, error: runError } = await supabaseAdmin
    .from("ranking_runs")
    .select("id, candidate_profile_id")
    .eq("id", runId)
    .eq("user_id", userId)
    .single();

  if (runError) throw runError;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("candidate_profiles")
    .select("id, cv_document_id, skills_profile")
    .eq("id", run.candidate_profile_id)
    .eq("user_id", userId)
    .single();

  if (profileError) throw profileError;

  const { data: document, error: documentError } = await supabaseAdmin
    .from("candidate_documents")
    .select("extracted_text")
    .eq("id", profile.cv_document_id)
    .eq("user_id", userId)
    .single();

  if (documentError) throw documentError;

  if (!document.extracted_text?.trim()) {
    throw new Error("The active CV does not contain extracted text.");
  }

  const schemaText = await readFile(
    new URL("../../../resources/skills.schema.json", import.meta.url),
    "utf8",
  );

  return {
    runId,
    userId,
    candidateProfileId: profile.id,
    cvContent: document.extracted_text,
    skillsProfile: profile.skills_profile,
    schema: JSON.parse(schemaText),
    model: process.env.JOBRANK_RANKING_MODEL?.trim() || "openai/gpt-5.6-luna",
  };
}

async function saveUsage(input: {
  context: RankingContext;
  result: Awaited<ReturnType<typeof callOpenRouter>>;
}) {
  const { error } = await supabaseAdmin.from("generation_usage").insert({
    user_id: input.context.userId,
    operation: "job_ranking",
    provider: "openrouter",
    model: input.context.model,
    input_tokens: input.result.inputTokens,
    output_tokens: input.result.outputTokens,
    provider_request_id: input.result.providerRequestId,
    cost_usd: input.result.costUsd,
    status: "succeeded",
  });

  if (error) {
    // Usage logging should be visible, but it should not
    // discard a successfully generated ranking.
    console.error("Could not save ranking usage:", error);
  }
}

async function rankOneJob(
  context: RankingContext,
  job: DatabaseJob,
): Promise<boolean> {
  const attemptedAt = new Date().toISOString();

  const { error: processingError } = await supabaseAdmin
    .from("job_rankings")
    .upsert(
      {
        run_id: context.runId,
        user_id: context.userId,
        job_id: job.id,
        candidate_profile_id: context.candidateProfileId,
        status: "processing",
        ranking_version: rankingVersion,
        attempted_version: rankingVersion,
        attempted_at: attemptedAt,
        processing_error: null,
        model: context.model,
      },
      {
        onConflict: "user_id,job_id,candidate_profile_id,ranking_version",
      },
    );

  if (processingError) throw processingError;

  try {
    const prompt = buildRankingPrompt({
      jobDescription: job.description,
      cvContent: context.cvContent,
      skillsProfile: context.skillsProfile,
      schema: context.schema,
    });

    const result = await callOpenRouter(prompt, context.model);

    const score = calculateCandidateScore(result.analysis);

    const verifiedLocation = result.analysis["verified_location"];

    const locationMismatch = result.analysis["location_mismatch"];

    const { error: saveError } = await supabaseAdmin
      .from("job_rankings")
      .upsert(
        {
          run_id: context.runId,
          user_id: context.userId,
          job_id: job.id,
          candidate_profile_id: context.candidateProfileId,
          prescriptive_score: score,
          analysis: result.analysis,
          verified_location:
            typeof verifiedLocation === "string" ? verifiedLocation : null,
          location_mismatch:
            typeof locationMismatch === "boolean" ? locationMismatch : false,
          status: "rated",
          ranking_version: rankingVersion,
          attempted_version: null,
          processing_error: null,
          attempted_at: attemptedAt,
          rated_at: new Date().toISOString(),
          model: context.model,
        },
        {
          onConflict: "user_id,job_id,candidate_profile_id,ranking_version",
        },
      );

    if (saveError) throw saveError;

    await saveUsage({ context, result });

    return true;
  } catch (error) {
    const publicMessage =
      error instanceof Error ? error.message : "Ranking failed.";

    console.error("Job ranking failed:", {
      runId: context.runId,
      jobId: job.id,
      error: publicMessage,
    });

    const { error: saveFailureError } = await supabaseAdmin
      .from("job_rankings")
      .upsert(
        {
          run_id: context.runId,
          user_id: context.userId,
          job_id: job.id,
          candidate_profile_id: context.candidateProfileId,
          prescriptive_score: null,
          analysis: null,
          status: "failed",
          ranking_version: rankingVersion,
          attempted_version: rankingVersion,
          attempted_at: attemptedAt,
          processing_error: publicMessage,
          model: context.model,
        },
        {
          onConflict: "user_id,job_id,candidate_profile_id,ranking_version",
        },
      );

    if (saveFailureError) {
      console.error("Could not save failed ranking:", saveFailureError);
    }

    return false;
  }
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
) {
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= items.length) return;

      await handler(items[index]!);
    }
  }

  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export async function processRankingRun(
  runId: string,
  userId: string | undefined,
  jobIds: string[],
) {
  try {
    const { error: startError } = await supabaseAdmin
      .from("ranking_runs")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", runId)
      .eq("user_id", userId);

    if (startError) throw startError;

    const context = await loadRankingContext(runId, userId);

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("jobs")
      .select(
        `
          id,
          title,
          description,
          location,
          provider_payload
        `,
      )
      .in("id", jobIds);

    if (jobsError) throw jobsError;

    if (!jobs || jobs.length !== jobIds.length) {
      throw new Error("One or more selected jobs could not be loaded.");
    }

    let completedJobs = 0;
    let failedJobs = 0;

    const configuredConcurrency = Number.parseInt(
      process.env.RANKING_CONCURRENCY ?? "3",
      10,
    );

    const concurrency =
      Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
        ? Math.min(configuredConcurrency, 10)
        : 3;

    await processWithConcurrency(
      jobs as DatabaseJob[],
      concurrency,
      async (job) => {
        const succeeded = await rankOneJob(context, job);

        if (succeeded) {
          completedJobs++;
        } else {
          failedJobs++;
        }

        const { error: progressError } = await supabaseAdmin
          .from("ranking_runs")
          .update({
            completed_jobs: completedJobs,
            failed_jobs: failedJobs,
          })
          .eq("id", runId)
          .eq("user_id", userId);

        if (progressError) {
          console.error("Could not update ranking progress:", progressError);
        }
      },
    );

    const { error: completeError } = await supabaseAdmin
      .from("ranking_runs")
      .update({
        status: "completed",
        completed_jobs: completedJobs,
        failed_jobs: failedJobs,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);

    if (completeError) throw completeError;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Ranking run failed.";

    console.error("Ranking run failed:", {
      runId,
      userId,
      error: message,
    });

    const { error: failureUpdateError } = await supabaseAdmin
      .from("ranking_runs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);

    if (failureUpdateError) {
      console.error(
        "Could not mark ranking run as failed:",
        failureUpdateError,
      );
    }
  }
}
