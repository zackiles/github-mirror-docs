import { assertEquals, assertStringIncludes } from "@std/assert"
import { rewriteLinks, toNotionMarkdown } from "../../src/markdown.ts"

const SOURCE_URL = "https://github.com/acme/repo/blob/main/docs/setup.md"

Deno.test("notion - rewrites relative links to absolute GitHub URLs", () => {
  const result = toNotionMarkdown("[Guide](./guide.md)", SOURCE_URL, false)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/guide.md")
})

Deno.test("notion - rewrites relative image paths", () => {
  const result = toNotionMarkdown("![pic](./images/diagram.png)", SOURCE_URL, false)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/images/diagram.png")
})

Deno.test("notion - preserves absolute URLs", () => {
  const result = toNotionMarkdown("[Ext](https://external.com)", SOURCE_URL, false)
  assertStringIncludes(result, "https://external.com")
})

Deno.test("notion - preserves anchor links", () => {
  const result = toNotionMarkdown("[Section](#section)", SOURCE_URL, false)
  assertStringIncludes(result, "(#section)")
})

Deno.test("notion - preserves markdown content as-is", () => {
  const md = "# Title\n\n**Bold** and *italic*\n\n- list item\n\n```ts\ncode\n```"
  const result = toNotionMarkdown(md, SOURCE_URL, false)
  assertStringIncludes(result, "# Title")
  assertStringIncludes(result, "**Bold**")
  assertStringIncludes(result, "- list item")
  assertStringIncludes(result, "```ts")
})

Deno.test("notion - prepends banner when enabled", () => {
  const result = toNotionMarkdown("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "Mirrored from GitHub")
  assertStringIncludes(result, "Edit on GitHub")
  assertStringIncludes(result, "acme/repo/docs/setup.md")
  assertStringIncludes(result, "---")
})

Deno.test("notion - banner includes edit link", () => {
  const result = toNotionMarkdown("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "/edit/main/docs/setup.md")
})

Deno.test("notion - no banner when disabled", () => {
  const result = toNotionMarkdown("# Test", SOURCE_URL, false)
  assertEquals(result.includes("Mirrored from GitHub"), false)
})

Deno.test("notion - hidden marker format", () => {
  const slug = "test-doc"
  const hash = "abc123"
  const marker = `docs-mirror:slug=${slug}&hash=${hash}`
  assertStringIncludes(marker, "docs-mirror:slug=test-doc")
  assertStringIncludes(marker, "hash=abc123")

  const match = marker.match(/docs-mirror:slug=([^&]+)&hash=([a-z0-9]+)/)
  assertEquals(match?.[1], "test-doc")
  assertEquals(match?.[2], "abc123")
})

Deno.test("notion - marker extraction regex handles full marker", () => {
  const text = "some content\ndocs-mirror:slug=my-page&hash=deadbeef123\nmore content"
  const match = text.match(/docs-mirror:slug=([^&\s]+)(?:&hash=([a-f0-9]+))?/)
  assertEquals(match?.[1], "my-page")
  assertEquals(match?.[2], "deadbeef123")
})

Deno.test("notion - marker extraction handles slug without hash", () => {
  const text = "docs-mirror:slug=root-page"
  const match = text.match(/docs-mirror:slug=([^&\s]+)(?:&hash=([a-f0-9]+))?/)
  assertEquals(match?.[1], "root-page")
  assertEquals(match?.[2], undefined)
})

Deno.test("rewriteLinks - handles multiple links in one line (notion context)", () => {
  const md = "[A](./a.md) and [B](./b.md)"
  const result = rewriteLinks(md, SOURCE_URL)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/a.md")
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/b.md")
})

Deno.test("rewriteLinks - handles mixed relative and absolute (notion context)", () => {
  const md = "[Local](./local.md) and [Remote](https://example.com)"
  const result = rewriteLinks(md, SOURCE_URL)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/local.md")
  assertStringIncludes(result, "https://example.com")
})

Deno.test("notion - banner is blockquote format", () => {
  const result = toNotionMarkdown("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "> **Mirrored from GitHub**")
})

Deno.test("notion - converts code blocks with language", () => {
  const md = "```typescript\nconst x = 1\n```"
  const result = toNotionMarkdown(md, SOURCE_URL, false)
  assertStringIncludes(result, "```typescript")
  assertStringIncludes(result, "const x = 1")
})

Deno.test("notion - preserves tables", () => {
  const md = "| A | B |\n|---|---|\n| 1 | 2 |"
  const result = toNotionMarkdown(md, SOURCE_URL, false)
  assertStringIncludes(result, "| A | B |")
  assertStringIncludes(result, "| 1 | 2 |")
})
