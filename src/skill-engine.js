import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { slugify, ensureDir } from "./lifecycle.js";

/**
 * The standard opencode SKILL.md frontmatter keys.
 * OpenCode only recognizes `name` and `description` in YAML frontmatter.
 */
const FRONTMATTER_KEYS = ["name", "description"];

/**
 * Generate a SKILL.md file at the given path.
 *
 * @param {string} skillsDir - Directory where skills are stored
 * @param {string} name - Human-readable skill name
 * @param {string} description - One-line description of what the skill does
 * @param {string} body - Markdown body of the skill
 * @returns {Promise<{path: string, name: string, description: string}>}
 */
export async function generateSkill(skillsDir, name, description, body) {
  const skillSlug = slugify(name);
  const skillDir = join(skillsDir, skillSlug);

  await ensureDir(skillDir);

  const frontmatter = [
    "---",
    `name: ${escapeYAML(name)}`,
    `description: ${escapeYAML(description)}`,
    "---",
    "",
  ].join("\n");

  const content = frontmatter + (body || "").trim() + "\n";

  const filePath = join(skillDir, "SKILL.md");
  await writeFile(filePath, content, "utf-8");

  return { path: filePath, name, description };
}

/**
 * Read and parse a SKILL.md file.
 *
 * @param {string} filePath
 * @returns {Promise<{name: string, description: string, body: string} | null>}
 */
export async function parseSkill(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");

    // Extract YAML frontmatter
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return null;

    const frontmatterRaw = match[1];
    const body = (match[2] || "").trim();

    const frontmatter = {};
    for (const line of frontmatterRaw.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }

    if (!frontmatter.name) return null;

    return {
      name: frontmatter.name,
      description: frontmatter.description || "",
      body,
    };
  } catch {
    return null;
  }
}

/**
 * Convert a block of content (heading + markdown) into a SKILL.md body.
 */
export function wrapContentAsSkillBody(title, content) {
  return `# ${title}\n\n${content.trim()}\n`;
}

/**
 * Escape a string for YAML single-line value.
 */
function escapeYAML(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

export { FRONTMATTER_KEYS };
