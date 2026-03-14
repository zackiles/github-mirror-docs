import { assertEquals, assertThrows } from "@std/assert"
import { load, validate } from "../src/config.ts"
import { contentHash } from "../src/engine.ts"

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
