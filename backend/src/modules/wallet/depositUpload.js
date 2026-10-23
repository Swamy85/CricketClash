
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";

const uploadDirectory = path.resolve(
  process.cwd(),
  "private-uploads",
  "deposits"
);

export const DEPOSIT_UPLOAD_LIMITS = Object.freeze({
  fileSize: 5 * 1024 * 1024,
  files: 1,
  fields: 5,
  fieldSize: 10 * 1024,
  fieldNameSize: 100,
  parts: 6,
});

// Create the private upload directory if it does not exist.
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDirectory);
  },

  filename: (_req, _file, callback) => {
    // Generate an unpredictable filename instead of using
    // the filename supplied by the user.
    const filename = `${Date.now()}-${randomBytes(16).toString("hex")}`;
    callback(null, filename);
  },
});

// Check the MIME type supplied by the upload client.
// The controller must additionally verify the actual file signature.
function fileFilter(_req, file, callback) {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    const error = new Error("Unsupported upload type.");
    error.code = "INVALID_FILE_TYPE";
    return callback(error);
  }

  callback(null, true);
}

const uploadDepositProof = multer({
  storage,
  fileFilter,
  limits: DEPOSIT_UPLOAD_LIMITS,
});

// Wrap Multer so upload errors receive a clear client response.
export function handleDepositProofUpload(req, res, next) {
  uploadDepositProof.single("paymentProof")(req, res, (error) => {
    if (error) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Screenshot must be 5 MB or smaller."
          : error.code === "LIMIT_FILE_COUNT"
            ? "Upload only one payment screenshot."
            : error.code === "LIMIT_UNEXPECTED_FILE"
              ? "Use the paymentProof field for one screenshot."
              : error.code === "INVALID_FILE_TYPE"
                ? "Upload a JPG, PNG, or WEBP screenshot."
                : "Unable to upload payment screenshot.";

      return res.status(400).json({
        success: false,
        message,
      });
    }

    next();
  });
}

export { uploadDirectory };

export default uploadDepositProof;
