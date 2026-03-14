import { assertEquals, assertStringIncludes } from "@std/assert"
import { toConfluenceStorage, rewriteLinks } from "../../src/markdown.ts"

const SOURCE_URL = "https://github.com/acme/repo/blob/main/docs/setup.md"

Deno.test("confluence - converts headings to storage format", () => {
  const result = toConfluenceStorage("# Title\n\n## Subtitle", SOURCE_URL, false)
  assertStringIncludes(result, "<h1>Title</h1>")
  assertStringIncludes(result, "<h2>Subtitle</h2>")
})

Deno.test("confluence - converts bold and italic", () => {
  const result = toConfluenceStorage("**bold** and *italic*", SOURCE_URL, false)
  assertStringIncludes(result, "<strong>bold</strong>")
  assertStringIncludes(result, "<em>italic</em>")
})

Deno.test("confluence - converts inline code", () => {
  const result = toConfluenceStorage("Use `npm install`", SOURCE_URL, false)
  assertStringIncludes(result, "<code>npm install</code>")
})

Deno.test("confluence - converts code blocks to macros", () => {
  const md = "```typescript\nconst x = 1\n```"
  const result = toConfluenceStorage(md, SOURCE_URL, false)
  assertStringIncludes(result, 'ac:name="code"')
  assertStringIncludes(result, 'ac:name="language">typescript')
  assertStringIncludes(result, "const x = 1")
})

Deno.test("confluence - converts unordered lists", () => {
  const result = toConfluenceStorage("- one\n- two\n- three", SOURCE_URL, false)
  assertStringIncludes(result, "<ul>")
  assertStringIncludes(result, "<li>one</li>")
  assertStringIncludes(result, "</ul>")
})

Deno.test("confluence - converts ordered lists", () => {
  const result = toConfluenceStorage("1. first\n2. second", SOURCE_URL, false)
  assertStringIncludes(result, "<ol>")
  assertStringIncludes(result, "<li>first</li>")
  assertStringIncludes(result, "</ol>")
})

Deno.test("confluence - converts tables", () => {
  const md = "| A | B |\n|---|---|\n| 1 | 2 |"
  const result = toConfluenceStorage(md, SOURCE_URL, false)
  assertStringIncludes(result, "<table>")
  assertStringIncludes(result, "<th>")
  assertStringIncludes(result, "<td>")
})

Deno.test("confluence - converts links", () => {
  const result = toConfluenceStorage("[Click](https://example.com)", SOURCE_URL, false)
  assertStringIncludes(result, '<a href="https://example.com">Click</a>')
})

Deno.test("confluence - converts images", () => {
  const result = toConfluenceStorage("![alt](https://img.com/pic.png)", SOURCE_URL, false)
  assertStringIncludes(result, "ac:image")
  assertStringIncludes(result, "https://img.com/pic.png")
})

Deno.test("confluence - prepends banner when enabled", () => {
  const result = toConfluenceStorage("# Test", SOURCE_URL, true)
  assertStringIncludes(result, "Mirrored from GitHub")
  assertStringIncludes(result, 'ac:name="info"')
  assertStringIncludes(result, "Edit on GitHub")
})

Deno.test("confluence - no banner when disabled", () => {
  const result = toConfluenceStorage("# Test", SOURCE_URL, false)
  assertEquals(result.includes("Mirrored from GitHub"), false)
})

Deno.test("confluence - rewrites relative links to absolute GitHub URLs", () => {
  const result = rewriteLinks("[Guide](./guide.md)", SOURCE_URL)
  assertStringIncludes(result, "https://github.com/acme/repo/blob/main/guide.md")
})

Deno.test("confluence - preserves absolute URLs", () => {
  const result = rewriteLinks("[Ext](https://external.com)", SOURCE_URL)
  assertStringIncludes(result, "https://external.com")
})

Deno.test("confluence - preserves anchor links", () => {
  const result = rewriteLinks("[Section](#section)", SOURCE_URL)
  assertStringIncludes(result, "(#section)")
})
