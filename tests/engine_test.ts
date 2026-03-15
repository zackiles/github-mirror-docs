import { assert, assertEquals, assertThrows } from "@std/assert"
import { load, validate } from "../src/config.ts"
import { contentHash, inferParentSlug, detectSlugCollisions } from "../src/engine.ts"
import { parse } from "../src/frontmatter.ts"
import { SyncConflictError } from "../src/adapters/types.ts"

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname

Deno.test("config - loads minimal config", async () => {
  const config = await load(`${FIXTURES}config-minimal.yml`)
  assertEquals(config.collection, "Test Docs")
  assertEquals(config.mirrors.length, 1)
  assertEquals(config.mirrors[0].adapter, "confluence")
  assertEquals(config.mirrors[0].url, "https://test.atlassian.net")
})

Deno.test("config - loads full config with all fields", async () => {
  const config = await load(`${FIXTURES}config-full.yml`)
  assertEquals(config.collection, "Engineering Docs")
  assertEquals(config.source.include, ["README.md", "docs/**/*.md"])
  assertEquals(config.source.exclude, ["docs/internal/**"])
  assertEquals(config.defaults.publish, true)
  assertEquals(config.defaults.tags, ["engineering"])
  assertEquals(config.mirrors.length, 2)
  assertEquals(config.mirrors[0].adapter, "confluence")
  assertEquals(config.mirrors[0].collection, "Eng Docs")
  assertEquals(config.mirrors[1].adapter, "linear")
})

Deno.test("config - applies defaults for source and defaults", async () => {
  const config = await load(`${FIXTURES}config-minimal.yml`)
  assertEquals(config.source.include, ["README.md", "docs/**/*.md"])
  assertEquals(config.source.exclude, [])
  assertEquals(config.defaults.publish, true)
  assertEquals(config.defaults.tags, [])
})

Deno.test("config - validates missing collection", () => {
  assertThrows(
    () => validate({ mirrors: [{ adapter: "confluence", url: "https://x.com" }] }),
    Error,
    "collection",
  )
})

Deno.test("config - validates empty mirrors", () => {
  assertThrows(
    () => validate({ collection: "Test", mirrors: [] }),
    Error,
    "mirrors",
  )
})

Deno.test("config - validates unknown adapter", () => {
  assertThrows(
    () => validate({ collection: "Test", mirrors: [{ adapter: "notion" }] }),
    Error,
    "not valid",
  )
})

Deno.test("config - validates confluence requires url", () => {
  assertThrows(
    () => validate({ collection: "Test", mirrors: [{ adapter: "confluence" }] }),
    Error,
    "url",
  )
})

Deno.test("config - validates webhook requires template", () => {
  assertThrows(
    () => validate({ collection: "Test", mirrors: [{ adapter: "webhook" }] }),
    Error,
    "template",
  )
})

Deno.test("contentHash - produces consistent SHA-256 hex", async () => {
  const hash1 = await contentHash("hello world")
  const hash2 = await contentHash("hello world")
  assertEquals(hash1, hash2)
  assertEquals(hash1.length, 64)
})

Deno.test("contentHash - different content produces different hash", async () => {
  const hash1 = await contentHash("content A")
  const hash2 = await contentHash("content B")
  assertEquals(hash1 !== hash2, true)
})

function mockFile(relativePath: string, title: string) {
  const parsed = parse(`# ${title}\n\nContent.`, relativePath)
  return { ...parsed, path: `/repo/${relativePath}`, relativePath }
}

Deno.test("inferParentSlug - root-level file parents to root slug", () => {
  const files = new Map([
    ["docs/setup.md", mockFile("docs/setup.md", "Setup")],
  ])
  assertEquals(inferParentSlug("docs/setup.md", files, "root"), "root")
})

Deno.test("inferParentSlug - file in subdir with README parents to that README", () => {
  const apiReadme = mockFile("docs/api/README.md", "API")
  const files = new Map([
    ["docs/api/README.md", apiReadme],
    ["docs/api/endpoints.md", mockFile("docs/api/endpoints.md", "Endpoints")],
  ])
  assertEquals(inferParentSlug("docs/api/endpoints.md", files, "root"), "api")
})

Deno.test("inferParentSlug - subdir README parents to root slug", () => {
  const files = new Map([
    ["docs/api/README.md", mockFile("docs/api/README.md", "API")],
  ])
  assertEquals(inferParentSlug("docs/api/README.md", files, "root"), "root")
})

Deno.test("inferParentSlug - deep file without local README walks up to nearest", () => {
  const apiReadme = mockFile("docs/api/README.md", "API")
  const files = new Map([
    ["docs/api/README.md", apiReadme],
    ["docs/api/v2/changes.md", mockFile("docs/api/v2/changes.md", "Changes")],
  ])
  assertEquals(inferParentSlug("docs/api/v2/changes.md", files, "root"), "api")
})

Deno.test("inferParentSlug - file without any ancestor README falls back to root", () => {
  const files = new Map([
    ["docs/advanced/terraform.md", mockFile("docs/advanced/terraform.md", "Terraform")],
  ])
  assertEquals(inferParentSlug("docs/advanced/terraform.md", files, "root"), "root")
})

Deno.test("inferParentSlug - nested README parents to parent dir README", () => {
  const docsReadme = mockFile("docs/README.md", "Docs")
  const apiReadme = mockFile("docs/api/README.md", "API")
  const files = new Map([
    ["docs/README.md", docsReadme],
    ["docs/api/README.md", apiReadme],
  ])
  assertEquals(inferParentSlug("docs/api/README.md", files, "root"), "docs")
})

Deno.test("SyncConflictError - includes resource, reason, and resolution", () => {
  const err = new SyncConflictError("my-page", "already exists", "rename it")
  assertEquals(err.name, "SyncConflictError")
  assertEquals(err.resource, "my-page")
  assertEquals(err.reason, "already exists")
  assertEquals(err.resolution, "rename it")
  assert(err.message.includes("my-page"))
  assert(err.message.includes("already exists"))
  assert(err.message.includes("rename it"))
})

Deno.test("detectSlugCollisions - allows unique slugs", () => {
  detectSlugCollisions([
    { slug: "setup", title: "Setup", content: "", tags: [], order: 1, sourcePath: "docs/setup.md" },
    { slug: "api", title: "API", content: "", tags: [], order: 2, sourcePath: "docs/api.md" },
  ])
})

Deno.test("detectSlugCollisions - throws on duplicate slugs", () => {
  assertThrows(
    () => detectSlugCollisions([
      { slug: "guide", title: "Guide", content: "", tags: [], order: 1, sourcePath: "docs/guide.md" },
      { slug: "guide", title: "Guide 2", content: "", tags: [], order: 2, sourcePath: "docs/Guide.md" },
    ]),
    SyncConflictError,
    "Duplicate slug",
  )
})
