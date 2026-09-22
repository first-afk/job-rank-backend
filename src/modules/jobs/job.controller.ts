import type { Request, Response } from "express";
import { jobSearchSchema } from "./job-search.schema.js";
import { searchJobsDb } from "./jobsdb.service.js";
import { saveSearchResults } from "./job.repository.js";
import z from "zod";

export async function searchJobs(request: Request, response: Response) {
  const parsed = jobSearchSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: {
        code: "INVALID_SEARCH",
        message: "The search details are invalid.",
        details: z.flattenError(parsed.error).fieldErrors,
      },
    });
  }

  const providerJobs = await searchJobsDb(parsed.data);

  const jobs = await saveSearchResults(request.auth?.userId, providerJobs);

  return response.status(200).json({
    data: jobs,
    meta: {
      count: jobs.length,
      page: parsed.data.page,
    },
  });
}
