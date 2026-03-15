import { assertEquals, assertStringIncludes } from "@std/assert"
import { rewriteLinks, toLinearMarkdown } from "../../src/markdown.ts"

const SOURCE_URL = "https://github.com/acme/repo/blob/main/docs/setup.md"

Deno.test("linear - rewrites relative links to absolute GitHub URLs", () => {
  const result = toLinearMarkdown("[Guide](./guide.md)", SOURCE_URL, false)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/guide.md")
})

Deno.test("linear - rewrites relative image paths", () => {
  const result = toLinearMarkdown("![pic](./images/diagram.png)", SOURCE_URL, false)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/images/diagram.png")
})

Deno.test("linear - preserves absolute URLs", () => {
  const result = toLinearMarkdown("[Ext](https://external.com)", SOURCE_URL, false)
  assertStringIncludes(result, "https://external.com")
})

Deno.test("linear - preserves anchor links", () => {
  const result = toLinearMarkdown("[Section](#section)", SOURCE_URL, false)
  assertStringIncludes(result, "(#section)")
})

Deno.test("linear - preserves markdown content as-is", () => {
  const md = "# Title\n\n**Bold** and *italic*\n\n- list item\n\n```ts\ncode\n```"
  const result = toLinearMarkdown(md, SOURCE_URL, false)
  assertStringIncludes(result, "# Title")
  assertStringIncludes(result, "**Bold**")
  assertStringIncludes(result, "- list item")
  assertStringIncludes(result, "```ts")
})

Deno.test("linear - prepends banner when enabled", () => {
  const result = toLinearMarkdown("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "Mirrored from GitHub")
  assertStringIncludes(result, "Edit on GitHub")
  assertStringIncludes(result, "acme/repo/docs/setup.md")
  assertStringIncludes(result, "---")
})

Deno.test("linear - banner includes edit link", () => {
  const result = toLinearMarkdown("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "/edit/main/docs/setup.md")
})

Deno.test("linear - no banner when disabled", () => {
  const result = toLinearMarkdown("# Test", SOURCE_URL, false)
  assertEquals(result.includes("Mirrored from GitHub"), false)
})

Deno.test("linear - hidden marker format", () => {
  const slug = "test-doc"
  const hash = "abc123"
  const marker = `<!-- docs-mirror:slug=${slug}&hash=${hash} -->`
  assertStringIncludes(marker, "docs-mirror:slug=test-doc")
  assertStringIncludes(marker, "hash=abc123")

  const match = marker.match(/docs-mirror:slug=([^&]+)&hash=([a-z0-9]+)/)
  assertEquals(match?.[1], "test-doc")
  assertEquals(match?.[2], "abc123")
})

Deno.test("rewriteLinks - handles multiple links in one line", () => {
  const md = "[A](./a.md) and [B](./b.md)"
  const result = rewriteLinks(md, SOURCE_URL)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/a.md")
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/b.md")
})

Deno.test("rewriteLinks - handles mixed relative and absolute", () => {
  const md = "[Local](./local.md) and [Remote](https://example.com)"
  const result = rewriteLinks(md, SOURCE_URL)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/local.md")
  assertStringIncludes(result, "https://example.com")
})
