
// import multer from 'multer';
// import path from 'path';
// import fs from 'fs';
// import { v4 as uuidv4 } from 'uuid';

// const assetsDir = path.join(__dirname, '..', '..', 'assets', 'images');
// if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

// const storage = multer.diskStorage({
//   destination: (_req, _file, cb) => cb(null, assetsDir),
//   filename: (_req, file, cb) => {
//     const ext = path.extname(file.originalname) || '';
//     cb(null, `${Date.now()}-${uuidv4()}${ext}`);
//   }
// });

// export const uploadFields = multer({ storage }).fields([
//   { name: 'image_url', maxCount: 1 },
//   { name: 'image_url1', maxCount: 1 },
//   { name: 'image_url2', maxCount: 1 },
//   { name: 'image_url3', maxCount: 1 },
//   { name: 'image_url4', maxCount: 1 }
// ]);


import multer from "multer";
import path from "path";
import fs from "fs";

const imagesDir = path.join(__dirname, "..", "..", "assets", "images");
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, imagesDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

export const uploadFields = upload.fields([
  { name: 'image_url', maxCount: 1 },
  { name: 'image_url1', maxCount: 1 },
  { name: 'image_url2', maxCount: 1 },
  { name: 'image_url3', maxCount: 1 },
  { name: 'image_url4', maxCount: 1 }
]);

export default upload;

