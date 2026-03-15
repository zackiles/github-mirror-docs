import { assertEquals, assertStringIncludes } from "@std/assert"
import { toWikiMarkdown } from "../../src/markdown.ts"

const SOURCE_URL = "https://github.com/acme/repo/blob/main/docs/setup.md"

Deno.test("github-wiki - rewrites relative links to absolute GitHub URLs", () => {
  const result = toWikiMarkdown("[Guide](./guide.md)", SOURCE_URL, false)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/guide.md")
})

Deno.test("github-wiki - rewrites relative image paths", () => {
  const result = toWikiMarkdown("![pic](./images/diagram.png)", SOURCE_URL, false)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/images/diagram.png")
})

Deno.test("github-wiki - preserves absolute URLs", () => {
  const result = toWikiMarkdown("[Ext](https://external.com)", SOURCE_URL, false)
  assertStringIncludes(result, "https://external.com")
})

Deno.test("github-wiki - preserves anchor links", () => {
  const result = toWikiMarkdown("[Section](#section)", SOURCE_URL, false)
  assertStringIncludes(result, "(#section)")
})

Deno.test("github-wiki - preserves markdown content as-is", () => {
  const md = "# Title\n\n**Bold** and *italic*\n\n- list item\n\n```ts\ncode\n```"
  const result = toWikiMarkdown(md, SOURCE_URL, false)
  assertStringIncludes(result, "# Title")
  assertStringIncludes(result, "**Bold**")
  assertStringIncludes(result, "- list item")
  assertStringIncludes(result, "```ts")
})

Deno.test("github-wiki - prepends banner when enabled", () => {
  const result = toWikiMarkdown("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "Mirrored from GitHub")
  assertStringIncludes(result, "Edit on GitHub")
  assertStringIncludes(result, "acme/repo/docs/setup.md")
  assertStringIncludes(result, "---")
})

Deno.test("github-wiki - banner includes edit link", () => {
  const result = toWikiMarkdown("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "/edit/main/docs/setup.md")
})

Deno.test("github-wiki - no banner when disabled", () => {
  const result = toWikiMarkdown("# Test", SOURCE_URL, false)
  assertEquals(result.includes("Mirrored from GitHub"), false)
})

Deno.test("github-wiki - banner mentions wiki specifically", () => {
  const result = toWikiMarkdown("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "wiki page")
})

Deno.test("github-wiki - handles multiple links in one line", () => {
  const md = "[A](./a.md) and [B](./b.md)"
  const result = toWikiMarkdown(md, SOURCE_URL, false)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/a.md")
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/b.md")
})

Deno.test("github-wiki - handles mixed relative and absolute", () => {
  const md = "[Local](./local.md) and [Remote](https://example.com)"
  const result = toWikiMarkdown(md, SOURCE_URL, false)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/local.md")
  assertStringIncludes(result, "https://example.com")
})

Deno.test("github-wiki - hash marker format round-trips", () => {
  const slug = "setup-guide"
  const hash = "abc123def456"
  const marker = `<!-- docs-mirror:slug=${slug}&hash=${hash} -->`
  assertStringIncludes(marker, "docs-mirror:slug=setup-guide")
  assertStringIncludes(marker, "hash=abc123def456")

  const match = marker.match(/docs-mirror:slug=([^&]+)&hash=([a-f0-9]+)/)
  assertEquals(match?.[1], "setup-guide")
  assertEquals(match?.[2], "abc123def456")
})
