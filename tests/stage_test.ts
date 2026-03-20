import { assertEquals, assertStringIncludes } from "@std/assert"
import { join } from "@std/path"
import {
  compilePrompt,
  fixBody,
  fixHeading,
  hasCoreFields,
  hasH1,
  parseOutput,
  scanFiles,
} from "../src/stage.ts"

Deno.test("hasCoreFields - returns true when title and slug present", () => {
  const raw = `---
title: "Test"
slug: "test"
---

Content`
  assertEquals(hasCoreFields(raw), true)
})

Deno.test("hasCoreFields - returns false when slug missing", () => {
  const raw = `---
title: "Test"
---

Content`
  assertEquals(hasCoreFields(raw), false)
})

Deno.test("hasCoreFields - returns false when title missing", () => {
  const raw = `---
slug: "test"
---

Content`
  assertEquals(hasCoreFields(raw), false)
})

Deno.test("hasCoreFields - returns false with malformed frontmatter", () => {
  const raw = `---
title: "Test"
no closing delimiter`
  assertEquals(hasCoreFields(raw), false)
})

Deno.test("hasH1 - detects H1 heading", () => {
  assertEquals(hasH1("# Title\n\nContent"), true)
  assertEquals(hasH1("Some text\n# Title\nMore"), true)
  assertEquals(hasH1("## Not H1\n\nContent"), false)
  assertEquals(hasH1("No heading"), false)
})

Deno.test("fixBody - preserves existing H1", () => {
  const body = "# Already Here\n\nContent"
  assertEquals(fixBody(body, "Fallback"), body)
})

Deno.test("fixBody - promotes H2 to H1", () => {
  const body = "## Was H2\n\nContent"
  assertEquals(fixBody(body, "Fallback"), "# Was H2\n\nContent")
})

Deno.test("fixBody - promotes H3 to H1", () => {
  const body = "### Was H3\n\nContent"
  assertEquals(fixBody(body, "Fallback"), "# Was H3\n\nContent")
})

Deno.test("fixBody - prepends H1 when no heading exists", () => {
  const body = "Just content here."
  const result = fixBody(body, "My Title")
  assertStringIncludes(result, "# My Title")
  assertStringIncludes(result, "Just content here.")
})

Deno.test("fixHeading - handles raw without frontmatter", () => {
  const raw = "## Sub Heading\n\nContent"
  const result = fixHeading(raw, "Fallback")
  assertEquals(result, "# Sub Heading\n\nContent")
})

Deno.test("fixHeading - handles raw with frontmatter", () => {
  const raw = `---
title: "Test"
---

## Sub Heading

Content`
  const result = fixHeading(raw, "Fallback")
  assertStringIncludes(result, '---\ntitle: "Test"\n---')
  assertStringIncludes(result, "# Sub Heading")
})

Deno.test("parseOutput - parses direct JSON", () => {
  const json = JSON.stringify({
    result: JSON.stringify({
      files: [
        {
          path: "docs/test.md",
          frontmatter: { title: "Test", slug: "test", publish: true },
          fixHeading: false,
        },
      ],
    }),
  })
  const result = parseOutput(json)
  assertEquals(result.files.length, 1)
  assertEquals(result.files[0].path, "docs/test.md")
  assertEquals(result.files[0].frontmatter.title, "Test")
})

Deno.test("parseOutput - parses fenced JSON in result", () => {
  const json = JSON.stringify({
    result:
      '```json\n{"files":[{"path":"a.md","frontmatter":{"title":"A","slug":"a","publish":true}}]}\n```',
  })
  const result = parseOutput(json)
  assertEquals(result.files.length, 1)
  assertEquals(result.files[0].frontmatter.title, "A")
})

Deno.test("parseOutput - extracts JSON from mixed text", () => {
  const mixed =
    'Some preamble text\n{"files":[{"path":"b.md","frontmatter":{"title":"B","slug":"b","publish":true}}]}\nmore text'
  const result = parseOutput(mixed)
  assertEquals(result.files.length, 1)
  assertEquals(result.files[0].frontmatter.title, "B")
})

Deno.test("compilePrompt - includes file list and base path", () => {
  const targets = [
    {
      path: "/project/docs/test.md",
      relativePath: "docs/test.md",
      raw: "# Test\n\nContent",
      hasFrontmatter: false,
      frontmatter: { title: "Test", slug: "test", publish: true, tags: [] as string[] },
      content: "# Test\n\nContent",
      needsStaging: true,
    },
  ]

  const prompt = compilePrompt("/project", targets, [], "README.md", ".docs-mirror.yml")
  assertStringIncludes(prompt, "/project")
  assertStringIncludes(prompt, "docs/test.md")
  assertStringIncludes(prompt, "README.md")
  assertStringIncludes(prompt, ".docs-mirror.yml")
  assertStringIncludes(prompt, "1")
})

Deno.test("compilePrompt - includes examples when available", () => {
  const examples = [
    {
      path: "/project/docs/good.md",
      relativePath: "docs/good.md",
      raw: '---\ntitle: "Good Doc"\nslug: "good-doc"\n---\n\n# Good Doc\n\nContent',
      hasFrontmatter: true,
      frontmatter: {
        title: "Good Doc",
        slug: "good-doc",
        publish: true,
        tags: [] as string[],
      },
      content: "# Good Doc\n\nContent",
      needsStaging: false,
    },
  ]

  const prompt = compilePrompt("/project", [], examples, undefined, undefined)
  assertStringIncludes(prompt, "docs/good.md")
  assertStringIncludes(prompt, "Good Doc")
})

Deno.test("compilePrompt - handles missing readme and config", () => {
  const prompt = compilePrompt("/project", [], [], undefined, undefined)
  assertStringIncludes(prompt, "(none)")
})

Deno.test("scanFiles - discovers markdown files in project structure", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "stage-test-" })
  try {
    await Deno.writeTextFile(join(tmp, "README.md"), "# My Project\n\nSome content")
    await Deno.mkdir(join(tmp, "docs"), { recursive: true })
    await Deno.writeTextFile(
      join(tmp, "docs/guide.md"),
      '---\ntitle: "Guide"\nslug: "guide"\n---\n\n# Guide\n\nContent',
    )
    await Deno.writeTextFile(join(tmp, "docs/api.md"), "## API Reference\n\nEndpoints here.")

    const entries = await scanFiles(tmp)
    assertEquals(entries.length, 3)

    const readme = entries.find((e) => e.relativePath === "README.md")!
    assertEquals(readme.hasFrontmatter, false)
    assertEquals(readme.needsStaging, true)

    const guide = entries.find((e) => e.relativePath.endsWith("guide.md"))!
    assertEquals(guide.hasFrontmatter, true)
    assertEquals(guide.needsStaging, false)

    const api = entries.find((e) => e.relativePath.endsWith("api.md"))!
    assertEquals(api.hasFrontmatter, false)
    assertEquals(api.needsStaging, true)
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})

Deno.test("scanFiles - returns empty for directory with no matching files", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "stage-test-empty-" })
  try {
    const entries = await scanFiles(tmp)
    assertEquals(entries.length, 0)
  } finally {
    await Deno.remove(tmp, { recursive: true })
  }
})
