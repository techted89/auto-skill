/**
 * Skill Engine — generates, parses, and manages SKILL.md files.
 *
 * OpenCode SKILL.md format:
 * ```markdown
 * ---
 * name: my-skill
 * description: Use when building X — covers Y and Z patterns
 * ---
 *
 * # My Skill
 *
 * (body content)
 * ```
 *
 * Key rules:
 * - `name` is required, lowercase hyphen-separated, ≤64 chars
 * - `description` is required — "Use when..." format preferred
 * - Front-load concrete trigger keywords in description
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Escape a string for YAML single-line value.
 */
export function escapeYAML(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

/**
 * Unescape a YAML single-line value back to plain text.
 */
export function unescapeYAML(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Slugify a name for folder/file naming.
 */
export function slugify(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/**
 * Build YAML frontmatter from name and description.
 */
export function buildFrontmatter(name, description) {
  return [
    '---',
    `name: ${escapeYAML(name)}`,
    `description: ${escapeYAML(description)}`,
    '---',
    '',
  ].join('\n');
}

/**
 * Build a complete SKILL.md string from name, description, and body.
 *
 * @param {string} name - Skill name (lowercase-hyphenated)
 * @param {string} description - One-line "Use when..." description
 * @param {string} body - Markdown body (should start with # Heading)
 * @returns {string} Complete SKILL.md content
 */
export function assembleSkill(name, description, body) {
  const frontmatter = buildFrontmatter(name, description);

  // Ensure body has a heading
  const trimmedBody = (body || '').trim();
  const hasHeading = /^#\s+/m.test(trimmedBody);
  const finalBody = hasHeading ? trimmedBody : `# ${name}\n\n${trimmedBody}`;

  return frontmatter + finalBody + '\n';
}

/**
 * Generate a SKILL.md file on disk (folder-based format: dir/slug/SKILL.md).
 *
 * @param {string} skillsDir - Parent directory for skill folders
 * @param {string} name - Skill name
 * @param {string} description - One-line description
 * @param {string} body - Full markdown body
 * @returns {Promise<{path: string, name: string, description: string}>}
 */
export async function generateSkill(skillsDir, name, description, body) {
  const skillSlug = slugify(name);
  const skillDir = join(skillsDir, skillSlug);
  await mkdir(skillDir, { recursive: true });

  const content = assembleSkill(name, description, body);
  const filePath = join(skillDir, 'SKILL.md');
  await writeFile(filePath, content, 'utf-8');

  return { path: filePath, name, description };
}

/**
 * Generate a flat SKILL.md file (dir/name.md — not in a subfolder).
 *
 * @param {string} targetDir - Directory to write into
 * @param {string} name - Skill name
 * @param {string} description - One-line description
 * @param {string} body - Full markdown body
 * @returns {Promise<{path: string, name: string, description: string}>}
 */
export async function generateFlatSkill(targetDir, name, description, body) {
  const slug = slugify(name);
  await mkdir(targetDir, { recursive: true });

  const content = assembleSkill(name, description, body);
  const filePath = join(targetDir, `${slug}.md`);
  await writeFile(filePath, content, 'utf-8');

  return { path: filePath, name, description };
}

/**
 * Parse a SKILL.md file, extracting frontmatter + body.
 *
 * @param {string} filePath - Path to read and parse
 * @returns {Promise<{name: string, description: string, body: string, slug: string} | null>}
 */
export async function parseSkill(filePath) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return parseSkillContent(raw, filePath);
  } catch {
    return null;
  }
}

/**
 * Parse SKILL.md content string (no file read needed).
 *
 * @param {string} content - Raw SKILL.md text
 * @param {string} [sourcePath] - Optional source path for reference
 * @returns {{name: string, description: string, body: string, slug: string} | null}
 */
export function parseSkillContent(content, sourcePath) {
  try {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return null;

    const frontmatterRaw = match[1];
    const body = (match[2] || '').trim();

    const frontmatter = {};
    for (const line of frontmatterRaw.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = unescapeYAML(value);
    }

    if (!frontmatter.name) return null;

    const slug = slugify(frontmatter.name);
    return {
      name: frontmatter.name,
      description: frontmatter.description || '',
      body,
      slug,
      path: sourcePath || '',
    };
  } catch {
    return null;
  }
}

/**
 * Wrap raw content as a valid skill body (adds heading if missing).
 */
export function wrapContentAsSkillBody(title, content) {
  const trimmed = (content || '').trim();
  if (/^#\s+/m.test(trimmed)) return trimmed;
  return `# ${title}\n\n${trimmed}\n`;
}

/**
 * Check if a skill file is valid by reading and parsing it.
 */
export async function isValidSkill(filePath) {
  const parsed = await parseSkill(filePath);
  return parsed !== null && parsed.name.length > 0;
}

/**
 * Check if content string is valid SKILL.md (no file I/O).
 */
export function isValidSkillContent(content) {
  const parsed = parseSkillContent(content);
  return parsed !== null && parsed.name.length > 0;
}

/**
 * Check if a skill name already exists in the given directory.
 */
export async function skillExists(skillsDir, name) {
  const slug = slugify(name);
  const folderPath = join(skillsDir, slug, 'SKILL.md');
  const flatPath = join(skillsDir, `${slug}.md`);
  return existsSync(folderPath) || existsSync(flatPath);
}

export default {
  generateSkill, generateFlatSkill, parseSkill, parseSkillContent,
  wrapContentAsSkillBody, slugify, escapeYAML, buildFrontmatter,
  assembleSkill, isValidSkill, isValidSkillContent, skillExists,
};
