import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { extractDocumentText } from "./document_text.service.js";

const bucketName = "candidate-documents";

export async function uploadCandidateDocument(
  request: Request,
  response: Response,
) {
  let stage = "starting";

  try {
    const userId = request.auth?.userId;
    const file = request.file;
    const documentType = request.body.documentType;

    if (!file) {
      return response.status(400).json({
        error: {
          code: "FILE_REQUIRED",
          message: "Please select a file.",
        },
      });
    }

    if (!["cv", "about_you"].includes(documentType)) {
      return response.status(400).json({
        error: {
          code: "INVALID_DOCUMENT_TYPE",
          message: "Document type must be cv or about_you.",
        },
      });
    }

    stage = "extracting text";

    const extractedText = await extractDocumentText(file.buffer, file.mimetype);

    stage = "checking previous revision";

    if (!extractedText) {
      return response.status(422).json({
        error: {
          code: "NO_EXTRACTABLE_TEXT",
          message: "No text could be extracted from this document.",
        },
      });
    }

    const documentId = randomUUID();

    const safeFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");

    const storagePath = `${userId}/${documentId}/${safeFilename}`;

    const contentHash = createHash("sha256").update(file.buffer).digest("hex");

    const { data: latestDocument } = await supabaseAdmin
      .from("candidate_documents")
      .select("revision")
      .eq("user_id", userId)
      .eq("document_type", documentType)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();

    const revision = (latestDocument?.revision ?? 0) + 1;

    stage = "uploading to storage";

    const { error: storageError } = await supabaseAdmin.storage
      .from(bucketName)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (storageError) {
      throw storageError;
    }

    stage = "deactivating previous document";

    const { error: deactivateError } = await supabaseAdmin
      .from("candidate_documents")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("document_type", documentType)
      .eq("is_active", true);

    if (deactivateError) throw deactivateError;

    stage = "inserting database record";

    await supabaseAdmin
      .from("candidate_documents")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("document_type", documentType)
      .eq("is_active", true);

    const { data: document, error: databaseError } = await supabaseAdmin
      .from("candidate_documents")
      .insert({
        id: documentId,
        user_id: userId,
        document_type: documentType,
        filename: file.originalname,
        storage_path: storagePath,
        extracted_text: extractedText,
        content_hash: contentHash,
        revision,
        is_active: true,
      })
      .select()
      .single();

    if (databaseError) {
      await supabaseAdmin.storage.from(bucketName).remove([storagePath]);

      throw databaseError;
    }

    return response.status(201).json({
      data: document,
    });
  } catch (error) {
    const details =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error;

    console.error("Candidate upload failed:", {
      stage,
      details,
    });

    return response.status(500).json({
      error: {
        code: "DOCUMENT_UPLOAD_FAILED",
        message: "Document upload failed.",
        details:
          process.env.NODE_ENV === "development"
            ? { stage, error: details }
            : null,
      },
    });
  }
}
export async function listCandidateDocuments(
  request: Request,
  response: Response,
) {
  const { data, error } = await supabaseAdmin
    .from("candidate_documents")
    .select(
      `
    id,
    document_type,
    filename,
    revision,
    is_active,
    created_at,
    updated_at
  `,
    )
    .eq("user_id", request.auth?.userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return response.status(200).json({
    data,
  });
}
