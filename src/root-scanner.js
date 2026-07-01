/**
 * RootScanner — recursive SKILL.md scanner for root filesystem paths.
 *
 * Walks a directory tree looking for SKILL.md files, parses their
 * frontmatter, and returns structured skill entries ready for merging
 * into a SkillsetIndex.
 *
 * Safety:
 * - Max depth of 15 levels
 * - Max 5000 entries scanned per call
 * - Skips common system/vcs directories
 * - Gracefully handles permission errors
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseSkill } from "./skill-engine.js";

/** Directories always excluded from scanning. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "cache",
  "__pycache__",
  ".npm",
  ".cache",
  ".local",
  "snap",
  "proc",
  "sys",
  "dev",
  "run",
  "boot",
  "lost+found",
  "media",
  "mnt",
  "tmp",
  "var/log",
  "var/cache",
  "var/tmp",
]);

const MAX_DEPTH = 15;
const MAX_ENTRIES = 5_000;

export class RootScanner {
  constructor() {
    /** @type {Array<{name:string, description:string, path:string, slug:string}>} */
    this.foundSkills = [];
    this.scannedCount = 0;
    this.errorCount = 0;
  }

  /**
   * Recursively scan a directory for SKILL.md files.
   *
   * @param {string} rootPath - Absolute path to start scanning from
   * @param {{maxEntries?:number, excludeDirs?:Set<string>}} [options]
   * @returns {Promise<{skills:Array, scannedCount:number, errorCount:number}>}
   */
  async scanDirectory(
    rootPath,
    { maxEntries = MAX_ENTRIES, excludeDirs = EXCLUDED_DIRS } = {},
  ) {
    this.foundSkills = [];
    this.scannedCount = 0;
    this.errorCount = 0;

    await this._walk(rootPath, { maxEntries, excludeDirs }, 0);

    return {
      skills: this.foundSkills,
      scannedCount: this.scannedCount,
      errorCount: this.errorCount,
    };
  }

  /**
   * Convenience: scan /root/ (the VPS home dir) with smart exclusions.
   */
  async scanVpsRoot() {
    return this.scanDirectory("/root", {
      excludeDirs: new Set([
        ...EXCLUDED_DIRS,
        ".opencode-auto-skill", // Avoid scanning own data
      ]),
    });
  }

  // ───────── internal walker ─────────

  async _walk(dir, { maxEntries, excludeDirs }, depth) {
    if (depth > MAX_DEPTH) return;
    if (this.scannedCount >= maxEntries) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Permission denied or missing directory — skip silently
      this.errorCount++;
      return;
    }

    for (const entry of entries) {
      if (this.scannedCount >= maxEntries) break;

      const fullPath = join(dir, entry.name);

      if (entry.name === "SKILL.md" && entry.isFile()) {
        try {
          const parsed = await parseSkill(fullPath);
          if (parsed) {
            // Derive slug from parent directory name
            const slug = dir.split("/").pop() || parsed.name.toLowerCase().replace(/\s+/g, "-");
            this.foundSkills.push({
              name: parsed.name,
              description: parsed.description || "",
              path: fullPath,
              slug,
            });
          }
        } catch {
          // Corrupt or unreadable file
          this.errorCount++;
        }
      } else if (entry.isDirectory() && !this._isExcluded(entry.name, excludeDirs)) {
        await this._walk(fullPath, { maxEntries, excludeDirs }, depth + 1);
      }

      this.scannedCount++;
    }
  }

  /**
   * Check whether a directory name is in the exclusion set or is a dotfile.
   */
  _isExcluded(name, excludeDirs) {
    if (name.startsWith(".")) return true;
    return excludeDirs.has(name);
  }
}
