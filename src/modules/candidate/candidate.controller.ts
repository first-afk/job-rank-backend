import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { extractDocumentText } from "./document_text.service.js";

const bucketName = "candidate-documents";

export async function uploadCandidateDocument(
  request: Request,
  response: Response,
) {
  const userId = request.auth?.userId!;
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

  const extractedText = await extractDocumentText(file.buffer, file.mimetype);

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

  const { error: storageError } = await supabaseAdmin.storage
    .from(bucketName)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (storageError) {
    throw storageError;
  }

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
}
