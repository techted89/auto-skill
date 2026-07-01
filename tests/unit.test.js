import { describe, it, expect, jest } from "@jest/globals";

// Mock node:fs and node:fs/promises
jest.unstable_mockModule("node:fs/promises", () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  readdir: jest.fn(),
  mkdir: jest.fn(),
  rm: jest.fn(),
  mkdtemp: jest.fn(),
}));

jest.unstable_mockModule("node:fs", () => ({
  existsSync: jest.fn(),
}));

// ──────────────────────────────────────────────
// skill-engine tests
// ──────────────────────────────────────────────
describe("skill-engine", () => {
  let engine;

  beforeAll(async () => {
    engine = await import("../src/skill-engine.js");
  });

  describe("generateSkill", () => {
    it("should generate a SKILL.md file with proper frontmatter", async () => {
      const { writeFile, mkdir } = await import("node:fs/promises");

      const result = await engine.generateSkill(
        "/tmp/skills",
        "React State Management",
        "Best practices for React state management",
        "# React State\nUse useState for local state."
      );

      expect(result.name).toBe("React State Management");
      expect(result.path).toContain("react-state-management/SKILL.md");

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();

      const writtenContent = writeFile.mock.calls[0][1];
      expect(writtenContent).toContain("name: React State Management");
      expect(writtenContent).toContain("description: Best practices for React state management");
      expect(writtenContent).toContain("# React State");
    });
  });

  describe("parseSkill", () => {
    it("should parse a valid SKILL.md", async () => {
      const { readFile } = await import("node:fs/promises");
      readFile.mockResolvedValueOnce(
        "---\nname: Test Skill\ndescription: A test skill\n---\n\n# Test\nContent here."
      );

      const result = await engine.parseSkill("/some/path/SKILL.md");
      expect(result).toEqual({
        name: "Test Skill",
        description: "A test skill",
        body: "# Test\nContent here.",
  });
});

// ──────────────────────────────────────────────
// web sourcing tests
// ──────────────────────────────────────────────
describe("web sourcing", () => {
  let web;

  beforeAll(async () => {
    web = await import("../src/sourcing/web.js");
  });

  describe("searchDocs with mocked fetch", () => {
    beforeEach(() => {
      jest.spyOn(global, "fetch").mockReset();
    });

    afterEach(() => {
      global.fetch.mockRestore();
    });

    it("should parse DuckDuckGo HTML results with real URLs", async () => {
      const fakeHtml = `
        <html>
        <a class="result__a" href="https://github.com/org/repo">Repo Title</a>
        <a class="result__snippet">Some description text</a>
        </html>
      `;
      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(fakeHtml),
      });

      const results = await web.searchDocs("test query", 1);
      expect(results.length).toBe(1);
      expect(results[0].url).toBe("https://github.com/org/repo");
      expect(results[0].title).toBe("Repo Title");
      expect(results[0].snippet).toBe("Some description text");
    });

    it("should extract real URL from DuckDuckGo redirect wrapper", async () => {
      const redirectUrl = "//duckduckgo.com/l/?uddg=https://opencode.ai/docs/skills/&amp;rut=e3a91815";
      const fakeHtml = `
        <html>
        <a class="result__a" href="${redirectUrl}">Agent Skills | OpenCode</a>
        <a class="result__snippet">Skill doc page</a>
        </html>
      `;
      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(fakeHtml),
      });

      const results = await web.searchDocs("opencode skills", 1);
      expect(results[0].url).toBe("https://opencode.ai/docs/skills/");
    });

    it("should throw on HTTP error", async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
      });

      await expect(web.searchDocs("fail")).rejects.toThrow("429");
    });
  });

  describe("fetchPage with mocked fetch", () => {
    beforeEach(() => {
      jest.spyOn(global, "fetch").mockReset();
    });

    afterEach(() => {
      global.fetch.mockRestore();
    });

    it("should extract title and strip scripts/styles", async () => {
      const fakeHtml = `<html><head><title>Test Page</title></head><body><script>bad</script><style>bad{}</style>Hello world</body></html>`;
      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(fakeHtml),
      });

      const page = await web.fetchPage("https://example.com");
      expect(page.title).toBe("Test Page");
      expect(page.content).not.toContain("bad");
      expect(page.content).toContain("Hello world");
      expect(page.url).toBe("https://example.com");
    });

    it("should decode HTML entities", async () => {
      const fakeHtml = `<html><body>&amp; &lt; &gt;</body></html>`;
      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(fakeHtml),
      });

      const page = await web.fetchPage("https://example.com");
      expect(page.content).toContain("&");
      expect(page.content).toContain("<");
      expect(page.content).toContain(">");
    });

    it("should truncate very large content", async () => {
      const long = "x".repeat(60000);
      const fakeHtml = `<html><body>${long}</body></html>`;
      global.fetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(fakeHtml),
      });

      const page = await web.fetchPage("https://example.com");
      expect(page.content.length).toBeLessThan(51000);
      expect(page.content).toContain("[content truncated]");
    });

    it("should throw on HTTP error", async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(web.fetchPage("https://example.com/missing")).rejects.toThrow("404");
    });
  });
});

    it("should return null for invalid files", async () => {
      const { readFile } = await import("node:fs/promises");
      readFile.mockResolvedValueOnce("No frontmatter here");

      const result = await engine.parseSkill("/some/path/SKILL.md");
      expect(result).toBeNull();
    });

    it("should return null if name is missing", async () => {
      const { readFile } = await import("node:fs/promises");
      readFile.mockResolvedValueOnce("---\ndescription: no name\n---\n\nBody");

      const result = await engine.parseSkill("/some/path/SKILL.md");
      expect(result).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────
// decomposition tests
// ──────────────────────────────────────────────
describe("decomposition", () => {
  let decomposition;

  beforeAll(async () => {
    decomposition = await import("../src/decomposition.js");
  });

  describe("parseSections", () => {
    it("should split document by ## headings", () => {
      const doc = `# Main Title

Intro text.

## API Setup
Install the package.

## Configuration
Set up your config file.

\`\`\`js
// ## Not a heading (in code block)
\`\`\`

## Testing
Run the tests.`;

      const sections = decomposition.parseSections(doc);
      expect(sections).toHaveLength(3);
      expect(sections[0].heading).toBe("API Setup");
      expect(sections[1].heading).toBe("Configuration");
      expect(sections[2].heading).toBe("Testing");
    });

    it("should handle empty documents", () => {
      const sections = decomposition.parseSections("");
      expect(sections).toEqual([]);
    });

    it("should handle documents with no headings", () => {
      const sections = decomposition.parseSections("Just some text\n\nNo headings here.");
      expect(sections).toEqual([]);
    });
  });

  describe("shouldCreateSkill", () => {
    it("should return true for sections with skill indicators", () => {
      const section = { heading: "API Reference", content: "a".repeat(150) };
      expect(decomposition.shouldCreateSkill(section)).toBe(true);
    });

    it("should return false for short sections", () => {
      const section = { heading: "API Reference", content: "short" };
      expect(decomposition.shouldCreateSkill(section)).toBe(false);
    });

    it("should return false for unrelated headings", () => {
      const section = { heading: "My Weekend Plans", content: "a".repeat(150) };
      expect(decomposition.shouldCreateSkill(section)).toBe(false);
    });
  });

  describe("splitDocument", () => {
    it("should return empty array for documents with no valid sections", async () => {
      const { existsSync } = await import("node:fs");
      existsSync.mockReturnValue(false);

      const result = await decomposition.splitDocument("# Just a title\n\nNo ## sections.", {
        baseName: "test",
      });
      expect(result).toEqual([]);
    });
  });
});

// ──────────────────────────────────────────────
// lifecycle tests
// ──────────────────────────────────────────────
describe("lifecycle", () => {
  let lifecycle;

  beforeAll(async () => {
    lifecycle = await import("../src/lifecycle.js");
  });

  describe("slugify", () => {
    it("should convert to lowercase and replace spaces", () => {
      expect(lifecycle.slugify("Hello World")).toBe("hello-world");
    });

    it("should strip special characters", () => {
      expect(lifecycle.slugify("React 101: Intro!")).toBe("react-101-intro");
    });

    it("should truncate long strings", () => {
      const long = "a".repeat(100);
      expect(lifecycle.slugify(long).length).toBeLessThanOrEqual(64);
    });

    it("should handle empty input", () => {
      expect(lifecycle.slugify("")).toBe("");
    });
  });

  describe("titleToSkillName", () => {
    it("should convert slug to title case", () => {
      const name = lifecycle.titleToSkillName("react-state-management");
      expect(name).toBe("React State Management");
    });
  });
});

// ──────────────────────────────────────────────
// SkillsetIndex tests
// ──────────────────────────────────────────────
describe("SkillsetIndex", () => {
  let SkillsetIndex, readFileMock, writeFileMock, mkdirMock;
  let index;
  const testSkills = [
    { name: "React Testing", description: "Testing React components with Jest" },
    { name: "Docker Deployment", description: "Deploying containers to production" },
    { name: "API Security", description: "Securing REST and GraphQL APIs" },
    { name: "Python Data Analysis", description: "Analyzing data with pandas and numpy" },
  ];

  beforeAll(async () => {
    SkillsetIndex = (await import("../src/skillset-index.js")).SkillsetIndex;
  });

  beforeEach(async () => {
    const fsp = await import("node:fs/promises");
    readFileMock = fsp.readFile;
    writeFileMock = fsp.writeFile;
    mkdirMock = fsp.mkdir;

    // Default: no existing index files — readFile rejects (fresh state)
    readFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);

    index = new SkillsetIndex("/tmp/test-auto-skill");
  });

  describe("build", () => {
    it("should build an inverted index from skill list", async () => {
      const result = await index.build(testSkills);
      expect(result.totalCount).toBe(4);

      // Verify persistence was written
      expect(writeFileMock).toHaveBeenCalled();
      const written = JSON.parse(writeFileMock.mock.calls[0][1]);
      expect(written.totalCount).toBe(4);
      expect(written.termIndex).toBeDefined();
      // Should have terms for "react", "testing", "docker", etc.
      expect(Object.keys(written.termIndex).length).toBeGreaterThan(10);
    });

    it("should handle empty skill list", async () => {
      const result = await index.build([]);
      expect(result.totalCount).toBe(0);
      expect(writeFileMock).toHaveBeenCalled();
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      await index.build(testSkills);
    });

    it("should find skills by exact name match", async () => {
      const results = await index.search("react testing", { limit: 5 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe("React Testing");
    });

    it("should find skills by description match", async () => {
      const results = await index.search("docker containers", { limit: 5 });
      expect(results.some((r) => r.name === "Docker Deployment")).toBe(true);
    });

    it("should return empty array for unrelated query", async () => {
      const results = await index.search("quantum cryptography", { limit: 5 });
      expect(results.length).toBe(0);
    });

    it("should rank name matches above description matches", async () => {
      // "React" appears in name of React Testing, but not in Docker Deployment name
      const results = await index.search("react", { limit: 5 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe("React Testing");
    });

    it("should handle empty query", async () => {
      const results = await index.search("", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should respect limit parameter", async () => {
      const results = await index.search("api", { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe("tokenization", () => {
    it("should filter stop words", () => {
      const tokens = index._tokenize("the quick brown fox and the lazy dog");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("and");
      expect(tokens).toContain("quick");
    });

    it("should filter short tokens", () => {
      const tokens = index._tokenize("a is to for abc");
      expect(tokens).not.toContain("a");
      expect(tokens).not.toContain("is");
      expect(tokens).toEqual(["abc"]);
    });

    it("should deduplicate within single text", () => {
      const tokens = index._tokenize("react react react testing");
      expect(tokens).toEqual(["react", "testing"]);
    });
  });

  describe("recordInjection and getStatus", () => {
    beforeEach(async () => {
      await index.build(testSkills);
    });

    it("should record and retrieve injection log", async () => {
      await index.recordInjection("React Testing", "search:react");
      await index.recordInjection("Docker Deployment", "tool:docker");

      const status = await index.getStatus(10);
      expect(status.totalSkills).toBe(4);
      expect(status.totalInjections).toBe(2);
      expect(status.recentInjections.length).toBe(2);
      expect(status.recentInjections[0].skill).toBe("Docker Deployment");
    });

    it("should record injection context", async () => {
      await index.recordInjection("API Security", "search:api security testing");
      const status = await index.getStatus(5);
      expect(status.recentInjections[0].context).toContain("api security");
    });

    it("should cap injection log at 100 entries", async () => {
      for (let i = 0; i < 150; i++) {
        await index.recordInjection(`Skill ${i}`, `iteration ${i}`);
      }
      const status = await index.getStatus(200);
      expect(status.totalInjections).toBe(150);
      expect(status.recentInjections.length).toBeLessThanOrEqual(100);
    });

    it("should return empty log when no injections", async () => {
      const status = await index.getStatus(10);
      expect(status.totalInjections).toBe(0);
      expect(status.recentInjections).toEqual([]);
    });
  });

  describe("merge", () => {
    beforeEach(async () => {
      await index.build(testSkills);
    });

    it("should merge new skills", async () => {
      const newSkills = [
        { name: "Kubernetes Orchestration", description: "Managing K8s clusters" },
      ];
      const result = await index.merge(newSkills);
      expect(result.merged).toBe(1);
      expect(result.total).toBe(5);
    });

    it("should not duplicate existing skills", async () => {
      const dupes = [
        { name: "React Testing", description: "Duplicate" },
      ];
      const result = await index.merge(dupes);
      expect(result.merged).toBe(0);
      expect(result.total).toBe(4);
    });

    it("should handle empty merge list", async () => {
      const result = await index.merge([]);
      expect(result.merged).toBe(0);
      expect(result.total).toBe(4);
    });
  });

  describe("_deriveSlug", () => {
    it("should derive slug from path", () => {
      const slug = index._deriveSlug({ name: "Test", path: "/skills/react-testing/SKILL.md" });
      expect(slug).toBe("react-testing");
    });

    it("should fall back to name slug", () => {
      const slug = index._deriveSlug({ name: "Hello World Test" });
      expect(slug).toBe("hello-world-test");
    });
  });
});

// ──────────────────────────────────────────────
// ContextInjector tests
// ──────────────────────────────────────────────
describe("ContextInjector", () => {
  let ContextInjector, SkillsetIndex, writeFileMock, mkdirMock, readFileMock;
  let injector, index;

  beforeAll(async () => {
    ContextInjector = (await import("../src/context-injector.js")).ContextInjector;
    SkillsetIndex = (await import("../src/skillset-index.js")).SkillsetIndex;
  });

  beforeEach(async () => {
    const fsp = await import("node:fs/promises");
    readFileMock = fsp.readFile;
    writeFileMock = fsp.writeFile;
    mkdirMock = fsp.mkdir;

    readFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
    mkdirMock.mockReset();
    mkdirMock.mockResolvedValue(undefined);

    index = new SkillsetIndex("/tmp/test-context");
    await index.build([
      { name: "React Testing", description: "Testing React components" },
      { name: "Docker Deployment", description: "Deploying containers" },
    ]);

    injector = new ContextInjector("/tmp/test-context", index);
  });

  describe("observe", () => {
    it("should update term weights from chat message", async () => {
      const output = { message: { text: "How do I test React components with Jest?" } };
      await injector.observe({}, output);

      const profile = await injector.getProfile();
      expect(profile.termWeights.react).toBeDefined();
      expect(profile.termWeights.test).toBeDefined();
      expect(profile.termWeights.components).toBeDefined();
    });

    it("should decay old terms on new messages", async () => {
      const msg1 = { message: { text: "React testing with Jest" } };
      const msg2 = { message: { text: "Docker deployment in production" } };

      await injector.observe({}, msg1);
      await injector.observe({}, msg2);

      const profile = await injector.getProfile();
      // First message terms should be decayed (0.8x)
      expect(profile.termWeights.react).toBeLessThan(2);
      expect(profile.termWeights.react).toBeGreaterThan(0);
    });

    it("should handle empty messages gracefully", async () => {
      await injector.observe({}, { message: {} });
      const profile = await injector.getProfile();
      expect(Object.keys(profile.termWeights).length).toBe(0);
    });

    it("should cap term weight at 10", async () => {
      const output = { message: { text: "react react react react react react react react react react react" } };
      await injector.observe({}, output);
      // Repeat to compound
      await injector.observe({}, output);
      await injector.observe({}, output);

      const profile = await injector.getProfile();
      for (const w of Object.values(profile.termWeights)) {
        expect(w).toBeLessThanOrEqual(10);
      }
    });
  });

  describe("getRelevantSkills", () => {
    beforeEach(async () => {
      // Prime the profile with context
      await injector.observe({}, { message: { text: "How do I test React components with Jest?" } });
    });

    it("should return skills relevant to current context", async () => {
      const relevant = await injector.getRelevantSkills(3);
      expect(relevant.length).toBeGreaterThanOrEqual(1);
      expect(relevant.some((s) => s.name.includes("React"))).toBe(true);
    });

    it("should respect limit", async () => {
      const relevant = await injector.getRelevantSkills(1);
      expect(relevant.length).toBeLessThanOrEqual(1);
    });

    it("should return empty without profile", async () => {
      const emptyInjector = new ContextInjector("/tmp/test-empty", index);
      const relevant = await emptyInjector.getRelevantSkills(3);
      expect(relevant).toEqual([]);
    });
  });

  describe("getCompactContextString", () => {
    it("should generate compact context string", async () => {
      await injector.observe({}, { message: { text: "react testing components" } });
      const ctx = await injector.getCompactContextString(2);
      expect(ctx).toContain("React Testing");
      expect(ctx.length).toBeLessThan(300); // Compact
    });

    it("should return empty string without context", async () => {
      const emptyInjector = new ContextInjector("/tmp/test-empty", index);
      const ctx = await emptyInjector.getCompactContextString();
      expect(ctx).toBe("");
    });
  });

  describe("observeTool", () => {
    it("should record tool names as context terms", async () => {
      await injector.observeTool({ tool: "read_file" });

      const profile = await injector.getProfile();
      expect(profile.termWeights.read).toBeDefined();
      expect(profile.termWeights.file).toBeDefined();
    });
  });

  describe("recordToolInjection", () => {
    it("should log injections for related skills", async () => {
      // Verify index is searchable first
      const preSearch = await index.search("docker", { limit: 5 });
      expect(preSearch.length).toBeGreaterThanOrEqual(1);
      expect(preSearch[0].name).toBe("Docker Deployment");

      // Now test injection tracking
      await injector.recordToolInjection("docker", "deploying containers");
      const status = await index.getStatus(5);
      expect(status.totalInjections).toBeGreaterThanOrEqual(1);
    });

    it("should handle empty tool name", async () => {
      // Should not throw
      await injector.recordToolInjection("");
    });
  });
});

// ──────────────────────────────────────────────
// RootScanner tests
// ──────────────────────────────────────────────
describe("RootScanner", () => {
  let RootScanner, parseSkill, readFileMock;

  beforeAll(async () => {
    RootScanner = (await import("../src/root-scanner.js")).RootScanner;
    parseSkill = (await import("../src/skill-engine.js")).parseSkill;
  });

  beforeEach(async () => {
    const fsp = await import("node:fs/promises");
    const fs = await import("node:fs");
    readFileMock = fsp.readFile;
    readFileMock.mockReset();
    fsp.readdir.mockReset();
    fsp.readdir.mockRejectedValue(new Error("ENOENT")); // default: no access
    fs.existsSync.mockReset();
    fs.existsSync.mockReturnValue(true);
  });

  describe("_isExcluded", () => {
    let scanner;
    beforeEach(() => {
      scanner = new RootScanner();
    });

    it("should exclude node_modules", () => {
      expect(scanner._isExcluded("node_modules", new Set(["node_modules"]))).toBe(true);
    });

    it("should exclude dotfiles", () => {
      expect(scanner._isExcluded(".git", new Set())).toBe(true);
      expect(scanner._isExcluded(".config", new Set())).toBe(true);
    });

    it("should not exclude normal dirs", () => {
      expect(scanner._isExcluded("skills", new Set(["node_modules"]))).toBe(false);
      expect(scanner._isExcluded("src", new Set(["node_modules"]))).toBe(false);
    });
  });

  describe("scanDirectory", () => {
    it("should handle empty or inaccessible directories gracefully", async () => {
      const scanner = new RootScanner();
      const result = await scanner.scanDirectory("/nonexistent");
      expect(result.skills).toEqual([]);
      expect(result.errorCount).toBeGreaterThanOrEqual(0);
    });

    it("should report scan statistics", async () => {
      const scanner = new RootScanner();
      const result = await scanner.scanDirectory("/tmp", { maxEntries: 10 });
      expect(result.scannedCount).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.skills)).toBe(true);
    });
  });
});
