import { assertEquals } from "@std/assert"
import {
  detectRenames,
  empty,
  load,
  lookup,
  remove,
  save,
  type StateData,
  update,
} from "../src/state.ts"

Deno.test("state - empty returns version 1 with no resources", () => {
  const s = empty()
  assertEquals(s.version, 1)
  assertEquals(s.resources, {})
})

Deno.test("state - save and load round-trips", async () => {
  const s: StateData = {
    version: 1,
    resources: {
      confluence: {
        "README.md": { id: "123", slug: "readme", hash: "abc" },
      },
    },
  }
  const dir = await Deno.makeTempDir()
  await save(dir, s)
  const loaded = await load(dir)
  assertEquals(loaded, s)
})

Deno.test("state - load returns empty for missing file", async () => {
  const dir = await Deno.makeTempDir()
  const loaded = await load(dir)
  assertEquals(loaded, empty())
})

Deno.test("state - update adds entry", () => {
  const s = empty()
  update(s, "confluence", "docs/guide.md", { id: "456", slug: "guide", hash: "def" })
  assertEquals(s.resources.confluence["docs/guide.md"].id, "456")
})

Deno.test("state - lookup finds entry", () => {
  const s = empty()
  update(s, "linear", "README.md", { id: "abc", slug: "readme", hash: "xyz" })
  const entry = lookup(s, "linear", "README.md")
  assertEquals(entry?.id, "abc")
})

Deno.test("state - lookup returns undefined for missing", () => {
  const s = empty()
  assertEquals(lookup(s, "linear", "missing.md"), undefined)
})

Deno.test("state - remove deletes entry", () => {
  const s = empty()
  update(s, "confluence", "docs/old.md", { id: "789", slug: "old", hash: "ghi" })
  remove(s, "confluence", "docs/old.md")
  assertEquals(lookup(s, "confluence", "docs/old.md"), undefined)
})

Deno.test("state - detectRenames returns empty when no tracked resources", () => {
  const s = empty()
  const renames = detectRenames(s, "confluence", ["README.md"])
  assertEquals(renames, [])
})

Deno.test("state - detectRenames returns empty when all paths still exist", () => {
  const s = empty()
  update(s, "confluence", "README.md", { id: "1", slug: "readme", hash: "a" })
  update(s, "confluence", "docs/guide.md", { id: "2", slug: "guide", hash: "b" })
  const renames = detectRenames(s, "confluence", ["README.md", "docs/guide.md"])
  assertEquals(renames, [])
})

Deno.test("state - detectRenames returns empty when removed but no new paths", () => {
  const s = empty()
  update(s, "confluence", "README.md", { id: "1", slug: "readme", hash: "a" })
  update(s, "confluence", "docs/old.md", { id: "2", slug: "old", hash: "b" })
  const renames = detectRenames(s, "confluence", ["README.md"])
  assertEquals(renames, [])
})

Deno.test("state - update overwrites existing entry", () => {
  const s = empty()
  update(s, "webhook", "README.md", { id: "old-id", slug: "readme", hash: "old" })
  update(s, "webhook", "README.md", { id: "new-id", slug: "readme", hash: "new" })
  assertEquals(lookup(s, "webhook", "README.md")?.id, "new-id")
})

Deno.test("state - multiple adapters tracked independently", () => {
  const s = empty()
  update(s, "confluence", "README.md", { id: "conf-1", slug: "readme", hash: "a" })
  update(s, "linear", "README.md", { id: "lin-1", slug: "readme", hash: "b" })
  assertEquals(lookup(s, "confluence", "README.md")?.id, "conf-1")
  assertEquals(lookup(s, "linear", "README.md")?.id, "lin-1")
})

Deno.test("state - save creates valid JSON", async () => {
  const s = empty()
  update(s, "confluence", "docs/test.md", { id: "42", slug: "test", hash: "h" })
  const dir = await Deno.makeTempDir()
  await save(dir, s)
  const text = await Deno.readTextFile(`${dir}/.docs-mirror-state.json`)
  const parsed = JSON.parse(text)
  assertEquals(parsed.version, 1)
  assertEquals(parsed.resources.confluence["docs/test.md"].id, "42")
})
