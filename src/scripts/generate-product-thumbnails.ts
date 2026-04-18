import dotenv from "dotenv";

import { generateProductThumbnails } from "../utils/product-thumbnails";

dotenv.config({ override: true });

void generateProductThumbnails({ log: true }).catch((error) => {
  console.error("Thumbnail generation failed:", error);
  process.exitCode = 1;
});
