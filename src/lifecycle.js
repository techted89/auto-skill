import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

/**
 * Resolve the plugin data directory. Uses project-local `.opencode-auto-skill/`
 * when a project context is available, falling back to user config.
 */
export function resolveDataDir(projectDirectory) {
  if (projectDirectory && existsSync(join(projectDirectory, ".opencode"))) {
    return join(projectDirectory, ".opencode-auto-skill");
  }
  const home = process.env.HOME || process.env.USERPROFILE || "/root";
  return join(home, ".config", "opencode-auto-skill");
}

/**
 * Ensure a directory exists.
 */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

/**
 * Read a JSON file with safe fallback.
 */
export async function readJSON(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write a JSON file.
 */
export async function writeJSON(filePath, data) {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Create a slug from a name (lowercase, alphanumeric, hyphens).
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

/**
 * Sanitize a skill name from a title.
 */
export function titleToSkillName(title) {
  return slugify(title).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get the skills directory for a given project.
 */
export function getSkillsDir(projectDirectory) {
  if (projectDirectory && existsSync(join(projectDirectory, ".opencode"))) {
    return join(projectDirectory, ".opencode-auto-skill", "skills");
  }
  const home = process.env.HOME || process.env.USERPROFILE || "/root";
  return join(home, ".config", "opencode", "skills");
}

/**
 * Get the auto-learn database path.
 */
export function getLearnDBPath(dataDir) {
  return join(dataDir, "learn-db.json");
}

export { PROJECT_ROOT };
