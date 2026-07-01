import { readFile } from "node:fs/promises";
import { generateSkill, wrapContentAsSkillBody } from "./skill-engine.js";
import { getSkillsDir, titleToSkillName } from "./lifecycle.js";

/**
 * Headings that indicate a section worth extracting as an atomic skill.
 * When heading text includes these keywords (case-insensitive), it's a candidate.
 */
const SKILL_INDICATORS = [
  "api", "setup", "configuration", "installation", "tutorial",
  "guide", "reference", "example", "pattern", "workflow",
  "integration", "deployment", "testing", "usage", "overview",
  "architecture", "best practice", "security", "performance", "migration",
  "troubleshooting", "debugging", "optimization", "faq",
];

/**
 * Split a markdown document into atomic skills based on ## headings.
 *
 * @param {string} markdown - Source markdown content
 * @param {Object} options
 * @param {string} options.baseName - Base name for derived skill names
 * @param {number} options.minSectionLength - Minimum chars for a section (default 100)
 * @returns {Promise<Array<{name: string, description: string, path: string}>>}
 */
export async function splitDocument(markdown, options = {}) {
  const { baseName = "skill", minSectionLength = 100 } = options;
  const skillsDir = getSkillsDir();

  const sections = parseSections(markdown);
  const results = [];

  for (const section of sections) {
    if (!shouldCreateSkill(section, minSectionLength)) continue;

    const skillName = deriveSkillName(section.heading, baseName);
    const description = deriveDescription(section);
    const body = wrapContentAsSkillBody(section.heading, section.content);

    const result = await generateSkill(skillsDir, skillName, description, body);
    results.push(result);
  }

  return results;
}

/**
 * Parse a markdown document into sections by ## headings.
 *
 * @param {string} content
 * @returns {Array<{heading: string, content: string, level: number}>}
 */
export function parseSections(content) {
  const lines = content.split("\n");
  const sections = [];
  let currentHeading = null;
  let currentContent = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Track code block boundaries to avoid parsing headings inside code
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (currentHeading) currentContent.push(line);
      continue;
    }

    if (!inCodeBlock) {
      const headingMatch = line.match(/^(#{2,4})\s+(.+)/);
      if (headingMatch) {
        if (currentHeading) {
          sections.push({
            heading: currentHeading,
            content: currentContent.join("\n").trim(),
            level: headingMatch[1].length,
          });
        }
        currentHeading = headingMatch[2].trim();
        currentContent = [];
        continue;
      }
    }

    if (currentHeading) {
      currentContent.push(line);
    }
  }

  // Push final section
  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      content: currentContent.join("\n").trim(),
      level: 2,
    });
  }

  return sections;
}

/**
 * Determine if a section is worth creating as a skill.
 */
export function shouldCreateSkill(section, minLength = 100) {
  if (section.content.length < minLength) return false;

  const headingLower = section.heading.toLowerCase();
  return SKILL_INDICATORS.some((indicator) => headingLower.includes(indicator));
}

/**
 * Derive a human-readable skill name from a heading.
 */
function deriveSkillName(heading, baseName) {
  const cleaned = heading
    .replace(/^(how to|what is|guide to|working with|using)\s+/i, "")
    .replace(/[<>:;"'/\\|?*]/g, "")
    .trim();
  return `${baseName}: ${cleaned}`;
}

/**
 * Derive a one-line description from section content.
 */
function deriveDescription(section) {
  const firstLine = section.content.split("\n")[0] || "";
  const cleaned = firstLine
    .replace(/^#+\s*/, "")
    .replace(/[`*_]/g, "")
    .trim();
  if (cleaned.length > 5 && cleaned.length < 120) return cleaned;
  return `Automated skill for ${section.heading}`;
}

export { SKILL_INDICATORS };
