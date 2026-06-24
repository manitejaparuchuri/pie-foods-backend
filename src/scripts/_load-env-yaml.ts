/**
 * Local-dev helper: load .env.yaml (the Cloud Run env file) into process.env
 * so CLI scripts can hit Brevo / SMTP / Firebase with the same creds Cloud
 * Run uses, without maintaining a separate .env.
 *
 * Import this BEFORE any service imports — ESM imports are hoisted, so the
 * env must already be populated when those modules read process.env.
 *
 * Tolerant parser: handles `KEY: 'value'`, `KEY: "value"`, `KEY: value`,
 * blank lines, and `#` comments. Multi-line YAML values are NOT supported
 * (we don't use them in .env.yaml).
 */
import fs from "fs";
import path from "path";

function loadEnvYaml(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.yaml"),
    path.resolve(__dirname, "..", "..", ".env.yaml"),
  ];
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    console.warn("[_load-env-yaml] .env.yaml not found — script will rely on existing process.env");
    return;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let loaded = 0;
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Strip a trailing inline comment that isn't inside quotes (rare for .env.yaml)
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!key) continue;
    // Don't clobber values already set explicitly in the shell
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
      loaded++;
    }
  }
  console.log(`[_load-env-yaml] loaded ${loaded} keys from ${filePath}`);
}

loadEnvYaml();
