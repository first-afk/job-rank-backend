import type { Request, Response } from "express";
import {
  assertActiveCv,
  CandidateContextChangedError,
  generateCandidateProfile,
  loadCandidateSchema,
} from "./candidate-profile.service.js";
import { supabaseAdmin } from "../../config/supabase.js";

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

  try {
    const result = await generateCandidateProfile(
      request.auth!.userId,
      documentId,
    );
    const schema = await loadCandidateSchema();
    if (
      result.profile.schema_hash !== schema.schemaHash ||
      result.profile.policy_version !== schema.policyVersion
    ) {
      throw new CandidateContextChangedError();
    }
    await assertActiveCv(request.auth!.userId, documentId);

    return response.status(result.generated ? 201 : 200).json({
      data: {
        ...result.profile,
        schema_json: schema.schemaText,
        generated: result.generated,
      },
    });
  } catch (error) {
    if (!(error instanceof CandidateContextChangedError)) throw error;
    return response.status(409).json({
      error: { code: "CANDIDATE_CONTEXT_CHANGED", message: error.message },
    });
  }
}

export async function getActiveSkillsProfile(
  request: Request,
  response: Response,
) {
  const { data: document, error: documentError } = await supabaseAdmin
    .from("candidate_documents")
    .select("id")
    .eq("user_id", request.auth?.userId)
    .eq("document_type", "cv")
    .eq("is_active", true)
    .maybeSingle();

  if (documentError) throw documentError;

  if (!document) {
    return response.status(404).json({
      error: {
        code: "ACTIVE_CV_NOT_FOUND",
        message: "No active CV was found.",
      },
    });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("candidate_profiles")
    .select(
      `
          id,
          cv_document_id,
          skills_profile,
          cv_hash,
          schema_hash,
          policy_version,
          model,
          created_at
        `,
    )
    .eq("user_id", request.auth?.userId)
    .eq("cv_document_id", document.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (profileError) throw profileError;

  if (!profile) return response.status(200).json({ data: null });

  const schema = await loadCandidateSchema();
  if (
    profile.schema_hash !== schema.schemaHash ||
    profile.policy_version !== schema.policyVersion
  ) {
    return response.status(200).json({ data: null });
  }

  try {
    await assertActiveCv(request.auth!.userId, document.id);
  } catch (error) {
    if (!(error instanceof CandidateContextChangedError)) throw error;
    return response.status(200).json({ data: null });
  }

  return response.status(200).json({
    data: { ...profile, schema_json: schema.schemaText },
  });
}
