import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

/**
 * Priority files we always try to extract first.
 */
const PRIORITY_FILES = [
  "README.md", "CONTRIBUTING.md", "API.md", "docs/README.md",
  "package.json", "pyproject.toml", "Cargo.toml",
  "index.js", "index.ts", "lib/main.dart", "src/index.js", "src/index.ts",
];

/**
 * Fetch repo content via shallow clone and extract source/docs.
 *
 * @param {string} repoUrl - GitHub repository URL
 * @returns {Promise<{content: string, files: string[], repoPath: string}>}
 */
export async function fetchRepoContent(repoUrl) {
  const tmpDir = await mkdtemp(join(tmpdir(), "gh-skill-"));
  const repoPath = join(tmpDir, "repo");

  try {
    // Shallow clone
    execSync(`git clone --depth 1 ${repoUrl} "${repoPath}"`, {
      stdio: "pipe",
      timeout: 60_000,
    });

    // Extract content
    const files = await collectFiles(repoPath);
    const content = await extractContent(repoPath, files);

    return { content, files, repoPath };
  } catch (err) {
    // Clean up on failure
    await rm(tmpDir, { recursive: true, force: true });
    throw new Error(`Failed to fetch repo ${repoUrl}: ${err.message}`);
  }
}

/**
 * Collect files from a repo path.
 */
async function collectFiles(repoPath) {
  const files = [];

  async function scan(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await scan(repoPath);
  return files;
}

/**
 * Extract meaningful content: priority files + up to 5 source files.
 */
async function extractContent(repoPath, files) {
  const parts = [];

  // Try priority files
  for (const relPath of PRIORITY_FILES) {
    const fullPath = join(repoPath, relPath);
    if (existsSync(fullPath)) {
      try {
        const content = await readFile(fullPath, "utf-8");
        const limited = content.length > 10000
          ? content.slice(0, 10000) + "\n... [truncated]"
          : content;
        parts.push(`=== ${relPath} ===\n${limited}`);
      } catch {
        // skip unreadable files
      }
    }
  }

  // Try up to 5 source files (alphabetically)
  const sourceFiles = files
    .filter((f) => !f.includes("node_modules") && !f.startsWith("."))
    .filter((f) => /\.(js|ts|py|rs|go|rb|dart|kt|java|c|cpp|h|cs|swift)$/i.test(f))
    .sort()
    .slice(0, 5);

  for (const filePath of sourceFiles) {
    if (filePath.includes("node_modules")) continue;
    try {
      const content = await readFile(filePath, "utf-8");
      const rel = filePath.replace(repoPath, "").replace(/^\//, "");
      const limited = content.length > 5000
        ? content.slice(0, 5000) + "\n... [truncated]"
        : content;
      parts.push(`=== ${rel} ===\n${limited}`);
    } catch {
      // skip unreadable files
    }
  }

  return parts.join("\n\n");
}

/**
 * Clean up a previously cloned repo.
 */
export async function cleanupRepo(repoPath) {
  const parent = repoPath ? repoPath.replace(/\/repo$/, "") : null;
  if (parent && parent.startsWith(tmpdir())) {
    await rm(parent, { recursive: true, force: true });
  }
}
