import type { Request, Response } from "express";
import { generateCandidateProfile } from "./candidate-profile.service.js";

export async function generateSkillsProfile(
  request: Request,
  response: Response,
) {
  const documentId = request.body.documentId;

  if (typeof documentId !== "string" || !documentId) {
    return response.status(400).json({
      error: {
        code: "DOCUMENT_ID_REQUIRED",
        message: "A CV document ID is required.",
      },
    });
  }

  const result = await generateCandidateProfile(
    request.auth?.userId,
    documentId,
  );

  return response.status(result.generated ? 201 : 200).json({
    data: {
      ...result.profile,
      generated: result.generated,
    },
  });
}
