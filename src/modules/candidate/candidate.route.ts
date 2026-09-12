import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireActiveAccount } from "../../middleware/require-active-account.js";
import { uploadCandidateDocument } from "./candidate.controller.js";
import { candidateDocumentUpload } from "./candidate_upload.middleware.js";

export const candidateRouter = Router();

candidateRouter.post(
  "/documents",
  authenticate,
  requireActiveAccount,
  candidateDocumentUpload.single("file"),
  uploadCandidateDocument,
);
