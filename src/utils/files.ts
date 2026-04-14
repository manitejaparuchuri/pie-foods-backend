
import fs from "fs";
import path from "path";


export const normalizeImagePath = (val?: string | null) => {
  if (!val) return null;

  // If already contains folder path, return it
  if (val.includes("/") || val.includes("\\")) {
    return val;
  }

  return `${val}`;
};


export const tryDeleteFile = (relPath?: string | null) => {
  if (!relPath) return;

  try {
    
    const fullPath = path.join(process.cwd(), relPath);

    // Check if file exists
    if (fs.existsSync(fullPath)) {
      fs.unlink(fullPath, (err) => {
        if (err) {
          console.error("Error deleting file:", err);
        }
      });
    }
  } catch (err) {
    console.error("tryDeleteFile error:", err);
  }
  
};

export const generateShippingId = (): string => {
  return (
    "IONORA_" +
    Math.random().toString(36).substring(2, 10) +
    Date.now().toString(36)
  ).toUpperCase();
};
