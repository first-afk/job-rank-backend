import type { Request, Response } from "express";
import { z } from "zod";
import { generateFollowUpAnswers } from "./follow-up.service.js";

const parametersSchema = z.object({
  jobId: z.string().uuid(),
});

const requestSchema = z.object({
  questions: z
    .string()
    .trim()
    .min(1, "Enter at least one question.")
    .max(20000, "The questions are too long."),
});

export async function createFollowUpAnswers(
  request: Request,
  response: Response,
) {
  const { jobId } = parametersSchema.parse(request.params);
  const { questions } = requestSchema.parse(request.body);

  const document = await generateFollowUpAnswers({
    userId: request.auth!.userId,
    jobId,
    questions,
  });

  return response.status(201).json({
    data: document,
  });
}
