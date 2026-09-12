import multer from "multer";

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
  fileFilter: (_request, file, callback) => {
    if (!allowedTypes.includes(file.mimetype)) {
      callback(new Error("Only PDF, DOCX and TXT files are supported."));
      return;
    }

    callback(null, true);
  },
});
