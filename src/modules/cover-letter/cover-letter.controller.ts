import type { Request, Response } from "express";
import { z } from "zod";
import { generateCoverLetter } from "./cover-letter.service.js";

const requestSchema = z.object({
  tone: z
    .enum(["professional", "confident", "friendly", "concise"])
    .default("professional"),
});

const paramsSchema = z.object({
  jobId: z.string().uuid(),
});

export async function createCoverLetter(request: Request, response: Response) {
  const input = requestSchema.parse(request.body);
  const { jobId } = paramsSchema.parse(request.params);

  const document = await generateCoverLetter({
    userId: request.auth!.userId,
    jobId,
    tone: input.tone,
  });

  return response.status(201).json({
    data: document,
  });
}
