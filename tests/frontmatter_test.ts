import { assertEquals, assertStringIncludes } from "@std/assert"
import { parse, inject, extractTitle, slugify, resolve } from "../src/frontmatter.ts"

Deno.test("parse - extracts frontmatter from markdown with YAML header", () => {
  const raw = `---
title: "Test Doc"
publish: true
slug: "test-doc"
tags: ["a", "b"]
---

# Test Doc

Content here.`

  const result = parse(raw, "test.md")
  assertEquals(result.frontmatter.title, "Test Doc")
  assertEquals(result.frontmatter.publish, true)
  assertEquals(result.frontmatter.slug, "test-doc")
  assertEquals(result.frontmatter.tags, ["a", "b"])
  assertStringIncludes(result.content, "Content here.")
})

Deno.test("parse - handles file with no frontmatter", () => {
  const raw = `# My Document

Some content.`

  const result = parse(raw, "my-document.md")
  assertEquals(result.frontmatter.title, "My Document")
  assertEquals(result.frontmatter.slug, "my-document")
  assertEquals(result.frontmatter.publish, true)
  assertEquals(result.frontmatter.tags, [])
})

Deno.test("parse - falls back to filename when no H1", () => {
  const raw = "Just some text without a heading."
  const result = parse(raw, "api-reference.md")
  assertEquals(result.frontmatter.title, "Api Reference")
})

Deno.test("extractTitle - finds first H1 heading", () => {
  assertEquals(extractTitle("# Hello World\n\nContent"), "Hello World")
  assertEquals(extractTitle("## Not H1\n\n# Actual Title"), "Actual Title")
  assertEquals(extractTitle("No headings here"), undefined)
})

Deno.test("slugify - converts text to URL-safe slug", () => {
  assertEquals(slugify("Hello World"), "hello-world")
  assertEquals(slugify("API Reference (v2)"), "api-reference-v2")
  assertEquals(slugify("  Leading and Trailing  "), "leading-and-trailing")
  assertEquals(slugify("Special!@#Characters"), "special-characters")
})

Deno.test("resolve - merges attrs with defaults", () => {
  const fm = resolve({ title: "Custom" }, "# Ignored\n\nBody", "file.md")
  assertEquals(fm.title, "Custom")
  assertEquals(fm.slug, "custom")
  assertEquals(fm.publish, true)
})

Deno.test("resolve - uses H1 when no title attr", () => {
  const fm = resolve({}, "# From Heading\n\nBody", "file.md")
  assertEquals(fm.title, "From Heading")
})

Deno.test("inject - adds frontmatter to file without it", () => {
  const raw = "# My Doc\n\nContent."
  const result = inject(raw, { title: "My Doc", slug: "my-doc" }, "my-doc.md")
  assertStringIncludes(result, "---")
  assertStringIncludes(result, "title: My Doc")
  assertStringIncludes(result, "slug: my-doc")
  assertStringIncludes(result, "Content.")
})

Deno.test("inject - merges into existing frontmatter without overwriting", () => {
  const raw = `---
title: "Existing Title"
---

# Content`

  const result = inject(raw, { slug: "new-slug", tags: ["added"] }, "file.md")
  assertStringIncludes(result, "Existing Title")
  assertStringIncludes(result, "new-slug")
})

Deno.test("resolve - parent: false opts out of auto-parenting", () => {
  const fm = resolve({ parent: false }, "# Doc\n\nBody", "file.md")
  assertEquals(fm.parent, false)
})

Deno.test("resolve - parent: 'false' string opts out of auto-parenting", () => {
  const fm = resolve({ parent: "false" }, "# Doc\n\nBody", "file.md")
  assertEquals(fm.parent, false)
})

Deno.test("resolve - parent: '' empty string opts out of auto-parenting", () => {
  const fm = resolve({ parent: "" }, "# Doc\n\nBody", "file.md")
  assertEquals(fm.parent, false)
})

Deno.test("resolve - parent: 'API' is preserved as string", () => {
  const fm = resolve({ parent: "API" }, "# Doc\n\nBody", "file.md")
  assertEquals(fm.parent, "API")
})

Deno.test("resolve - parent undefined when not specified", () => {
  const fm = resolve({}, "# Doc\n\nBody", "file.md")
  assertEquals(fm.parent, undefined)
})
