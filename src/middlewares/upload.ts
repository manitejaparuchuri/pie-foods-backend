import multer from "multer";

/**
 * In-memory multer storage. The uploaded file is held as a Buffer on
 * `req.file.buffer` and streamed directly into R2 by the controller — we never
 * touch disk. This avoids two classes of failure that plagued the earlier
 * disk-based variant on Railway:
 *   1. Writing into an ephemeral filesystem path that may not be writable.
 *   2. Leaving orphan local files when the R2 upload throws.
 *
 * 5 MB cap is generous for product imagery; tweak via the limits.fileSize
 * field if marketing ever needs to push larger source images.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only image files are allowed"));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

export default upload;
