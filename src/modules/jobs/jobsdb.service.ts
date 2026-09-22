import type { JobSearchInput } from "./job-search.schema.js";

function resolveTimeFrame(days: number) {
  if (days <= 1) return "24h";
  if (days <= 7) return "7d";
  return "6m";
}

export async function searchJobsDb(input: JobSearchInput) {
  const host = process.env.JOBSDB_API_HOST;
  const endpoint = process.env.JOBSDB_API_ENDPOINT;
  const apiKey = process.env.JOBSDB_API_KEY;

  if (!host || !endpoint || !apiKey) {
    throw new Error("JobsDB configuration is missing.");
  }

  const parameters = new URLSearchParams({
    description: input.query,
    time_frame: resolveTimeFrame(input.daysSincePosted),
    offset: input.page.toString(),
    limit: input.limit.toString(),
    description_format: "text",
  });

  if (input.city) {
    parameters.set("location", input.city);
  } else if (input.countryCodes.length > 0) {
    parameters.set(
      "location",
      input.countryCodes.map((code) => `"${code}"`).join(" OR "),
    );
  }

  if (input.isRemote) {
    parameters.set("ai_work_arrangement", "Remote OK,Remote Solely");
  }

  if (input.hasSalary) {
    parameters.set("has_salary", "true");
  }

  const response = await fetch(`https://${host}${endpoint}?${parameters}`, {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": host,
    },
  });

  if (!response.ok) {
    throw new Error(`JobsDB returned status ${response.status}.`);
  }

  const body = await response.json();

  if (Array.isArray(body)) return body;
  if (Array.isArray(body.jobs)) return body.jobs;
  if (Array.isArray(body.data)) return body.data;

  throw new Error("JobsDB returned an unexpected response.");
}
