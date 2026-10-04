import multer from "multer";
import { AppError } from "../../middleware/error-handling.js";

const allowedTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

export const candidateDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  /** Reject unsupported uploads before parsing or publishing candidate evidence. */
  fileFilter: (_request, file, callback) => {
    if (!allowedTypes.includes(file.mimetype)) {
      callback(
        new AppError(
          400,
          "UNSUPPORTED_DOCUMENT_TYPE",
          "Only PDF, DOCX and TXT files are supported.",
        ),
      );
      return;
    }

    callback(null, true);
  },
});
