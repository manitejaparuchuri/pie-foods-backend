import dotenv from "dotenv";

dotenv.config({ override: true, quiet: true });

const ENV_ALIASES: Record<string, readonly string[]> = {
  DB_HOST: ["DB_HOST", "MYSQLHOST"],
  DB_PORT: ["DB_PORT", "MYSQLPORT"],
  DB_USER: ["DB_USER", "MYSQLUSER"],
  DB_PASS: ["DB_PASS", "MYSQLPASSWORD"],
  DB_NAME: ["DB_NAME", "MYSQLDATABASE"],
};

function getCandidates(key: string): readonly string[] {
  return ENV_ALIASES[key] || [key];
}

export function getEnvValue(key: string): string {
  for (const candidate of getCandidates(key)) {
    const value = String(process.env[candidate] || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

export function hasEnvValue(key: string): boolean {
  return Boolean(getEnvValue(key));
}

export function getMissingRequiredEnvVars(keys: readonly string[]): string[] {
  return keys.filter((key) => !hasEnvValue(key));
}

export function formatEnvRequirement(key: string): string {
  const aliases = getCandidates(key).filter((candidate) => candidate !== key);
  if (!aliases.length) {
    return key;
  }

  return `${key} (or ${aliases.join(" / ")})`;
}
