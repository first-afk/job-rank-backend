import type { JobSearchInput } from "./job-search.schema.js";

function resolveTimeFrame(days: number) {
  if (days <= 1) return "24h";
  if (days <= 7) return "7d";
  return "6m";
}
const countryNames: Record<string, string> = {
  GB: "United Kingdom",
  US: "United States",
  NG: "Nigeria",
  CA: "Canada",
  AU: "Australia",
};

function formatLocations(countryCodes: string[]) {
  return countryCodes
    .map((code) => countryNames[code] ?? code)
    .map((country) => (country.includes(" ") ? `"${country}"` : country))
    .join(" OR ");
}

function extractProviderJobs(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item),
    );
  }

  if (typeof body === "object" && body !== null) {
    const object = body as Record<string, unknown>;

    for (const key of ["data", "jobs", "results", "items"]) {
      const value = object[key];

      if (Array.isArray(value)) {
        return value.filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && !Array.isArray(item),
        );
      }
    }
  }

  throw new Error("JobsDB returned an unexpected response structure.");
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
    parameters.set("location", formatLocations(input.countryCodes));
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
  const responseText = await response.text();
  console.log("JobsDB response:", {
    status: response.status,
    contentType: response.headers.get("content-type"),
    responseLength: responseText.length,
    responsePreview: responseText.slice(0, 300),
  });
  if (!response.ok) {
    throw new Error(`JobsDB returned status ${response.status}.`);
  }

  let body: unknown;

  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error("JobsDB returned an invalid JSON response.");
  }

  return extractProviderJobs(body);

  // if (Array.isArray(body)) return body;
  // if (Array.isArray(body.jobs)) return body.jobs;
  // if (Array.isArray(body.data)) return body.data;

  // throw new Error("JobsDB returned an unexpected response.");
}
