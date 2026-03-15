import { assert, assertEquals } from "@std/assert"
import { join } from "@std/path"
import { stringify as stringifyYaml } from "@std/yaml"
import { sync } from "../src/engine.ts"

interface MockRequest {
  method: string
  path: string
  body: string | null
}

function startMockServer(port: number): {
  server: Deno.HttpServer
  requests: MockRequest[]
  pages: Map<string, { id: string; title: string; slug: string }>
} {
  const requests: MockRequest[] = []
  const pages = new Map<string, { id: string; title: string; slug: string }>()
  let collectionCreated = false
  let idCounter = 1

  const server = Deno.serve({ port, onListen: () => {} }, async (req) => {
    const url = new URL(req.url)
    const body = req.method !== "GET" ? await req.text() : null
    requests.push({ method: req.method, path: url.pathname + url.search, body })

    const auth = req.headers.get("Authorization")
    if (auth !== "Bearer test-webhook-token") {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
    }

    if (url.pathname === "/api/collections" && req.method === "GET") {
      const name = url.searchParams.get("name")
      if (collectionCreated || name === "test") {
        return Response.json({
          id: "col-1",
          url: `http://localhost:${port}/collections/col-1`,
          name,
        })
      }
      return new Response("not found", { status: 404 })
    }

    if (url.pathname === "/api/collections" && req.method === "POST") {
      collectionCreated = true
      return Response.json({ id: "col-1", url: `http://localhost:${port}/collections/col-1` })
    }

    if (url.pathname === "/api/pages" && req.method === "GET") {
      const slug = url.searchParams.get("slug")
      if (slug && pages.has(slug)) {
        const page = pages.get(slug)!
        return Response.json({
          id: page.id,
          url: `http://localhost:${port}/pages/${page.id}`,
          title: page.title,
          slug: page.slug,
        })
      }
      return new Response("not found", { status: 404 })
    }

    if (url.pathname === "/api/pages" && req.method === "POST") {
      try {
        const data = JSON.parse(body!)
        const id = `page-${idCounter++}`
        pages.set(data.slug, { id, title: data.title, slug: data.slug })
        return Response.json({ id, url: `http://localhost:${port}/pages/${id}` })
      } catch (err) {
        return new Response(`JSON parse error: ${err}`, { status: 400 })
      }
    }

    if (url.pathname.startsWith("/api/pages/") && req.method === "PUT") {
      const id = url.pathname.split("/").pop()!
      return Response.json({ id, url: `http://localhost:${port}/pages/${id}` })
    }

    return new Response("not found", { status: 404 })
  })

  return { server, requests, pages }
}

async function createTempRepo(port: number): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "docs-mirror-smoke-" })

  for (
    const [args] of [
      [["init"]],
      [["config", "user.email", "test@test.com"]],
      [["config", "user.name", "Test"]],
    ] as [string[]][]
  ) {
    const cmd = new Deno.Command("git", { args, cwd: dir, stdout: "null", stderr: "null" })
    await cmd.output()
  }

  await Deno.writeTextFile(
    join(dir, "README.md"),
    `---
title: "Test Project"
publish: true
slug: "test-project"
tags: ["readme"]
---

# Test Project

This is the test project README.
`,
  )

  await Deno.mkdir(join(dir, "docs"), { recursive: true })

  await Deno.writeTextFile(
    join(dir, "docs", "setup.md"),
    `---
title: "Setup Guide"
publish: true
slug: "setup-guide"
tags: ["setup"]
order: 1
---

# Setup Guide

Follow these steps to get started.

## Prerequisites

- Node.js 18+
- A GitHub account

## Installation

\`\`\`bash
npm install my-project
\`\`\`

See the [API Reference](./api.md) for more details.
`,
  )

  await Deno.writeTextFile(
    join(dir, "docs", "api.md"),
    `---
title: "API Reference"
publish: true
slug: "api-reference"
tags: ["api"]
order: 2
---

# API Reference

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/users | List users |
| POST | /api/users | Create user |

## Authentication

Use a **Bearer token** in the \`Authorization\` header.
`,
  )

  await Deno.writeTextFile(
    join(dir, "docs", "draft.md"),
    `---
title: "Draft Notes"
publish: false
slug: "draft-notes"
---

# Draft Notes

This should NOT be synced.
`,
  )

  const base = `http://localhost:${port}`
  const webhookTemplate = {
    auth: { method: "bearer", token_env: "WEBHOOK_TOKEN" },
    content_format: "markdown",
    endpoints: {
      get_collection: { method: "GET", url: `${base}/api/collections?name={collection}` },
      create_collection: {
        method: "POST",
        url: `${base}/api/collections`,
        body: '{ "name": "{collection}" }',
      },
      get_page: { method: "GET", url: `${base}/api/pages?slug={slug}&collection={collection}` },
      create_page: {
        method: "POST",
        url: `${base}/api/pages`,
        body:
          '{ "title": "{title}", "slug": "{slug}", "space": "{collection}", "parent": "{parent}", "body": "{content}", "tags": {tags} }',
      },
      update_page: {
        method: "PUT",
        url: `${base}/api/pages/{page_id}`,
        body: '{ "title": "{title}", "body": "{content}", "tags": {tags} }',
      },
      lock_page: { method: "", url: "", body: "" },
    },
    response: { id_path: "id", url_path: "url" },
    banner: true,
  }
  await Deno.writeTextFile(join(dir, ".docs-mirror-webhook.yml"), stringifyYaml(webhookTemplate))

  const config = {
    collection: "Smoke Test Docs",
    source: { include: ["README.md", "docs/**/*.md"], exclude: [] },
    mirrors: [{
      adapter: "webhook",
      template: join(dir, ".docs-mirror-webhook.yml"),
      banner: true,
      lock: false,
    }],
  }
  await Deno.writeTextFile(join(dir, ".docs-mirror.yml"), stringifyYaml(config))

  return dir
}

Deno.test({
  name: "smoke - full sync cycle with mock webhook server",
  async fn() {
    const port = 19876
    const { server, requests } = startMockServer(port)
    const origCwd = Deno.cwd()
    let tempDir = ""

    try {
      Deno.env.set("WEBHOOK_TOKEN", "test-webhook-token")
      tempDir = await createTempRepo(port)
      Deno.chdir(tempDir)

      const results = await sync({
        configPath: join(tempDir, ".docs-mirror.yml"),
        repoUrl: "https://github.com/test-org/test-repo",
      })

      assertEquals(results.length, 1)
      assertEquals(results[0].adapter, "webhook")

      const created = results[0].results.filter((r) => r.action === "created")
      const failed = results[0].results.filter((r) => r.action === "failed")

      assertEquals(failed.length, 0, `No pages should fail: ${JSON.stringify(failed)}`)
      assertEquals(
        created.length,
        2,
        "Should create 2 pages (setup, api -- README becomes root page, draft excluded)",
      )

      const slugs = created.map((r) => r.slug).sort()
      assertEquals(slugs, ["api-reference", "setup-guide"])

      for (const r of created) {
        assert(r.url, `Created page ${r.slug} should have a URL`)
      }

      const collectionGets = requests.filter((r) =>
        r.method === "GET" && r.path.startsWith("/api/collections")
      )
      assert(collectionGets.length >= 1, "Should have queried for collection")

      const pageCreates = requests.filter((r) => r.method === "POST" && r.path === "/api/pages")
      assert(pageCreates.length >= 3, "Should have created at least 3 pages")

      const draftRequests = requests.filter((r) => r.body?.includes("draft-notes"))
      assertEquals(draftRequests.length, 0, "Draft (publish: false) should not be synced")

      const setupCreate = pageCreates.find((r) => r.body?.includes("setup-guide"))
      assert(setupCreate, "Should have created setup-guide page")
      assert(setupCreate.body?.includes("Mirrored from GitHub"), "Page body should contain banner")

      const setupBody = JSON.parse(setupCreate.body!)
      assertEquals(
        setupBody.parent,
        "test-project",
        "Pages should nest under root page (slug from README title)",
      )

      const rootPageCreate = pageCreates.find((r) =>
        r.body?.includes("test-project") && r.body?.includes("Test Project")
      )
      assert(rootPageCreate, "Root page should be created with README content")
    } finally {
      Deno.chdir(origCwd)
      Deno.env.delete("WEBHOOK_TOKEN")
      await server.shutdown()
      if (tempDir) await Deno.remove(tempDir, { recursive: true }).catch(() => {})
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
})

Deno.test({
  name: "smoke - dry-run produces no API calls",
  async fn() {
    const port = 19877
    const { server, requests } = startMockServer(port)
    const origCwd = Deno.cwd()
    let tempDir = ""

    try {
      Deno.env.set("WEBHOOK_TOKEN", "test-webhook-token")
      tempDir = await createTempRepo(port)
      Deno.chdir(tempDir)

      const results = await sync({
        configPath: join(tempDir, ".docs-mirror.yml"),
        dryRun: true,
        repoUrl: "https://github.com/test-org/test-repo",
      })

      assertEquals(results.length, 1)
      assertEquals(results[0].adapter, "webhook")
      assertEquals(requests.length, 0, "Dry-run should make zero API calls")

      const allSkipped = results[0].results.every((r) => r.action === "skipped")
      assert(allSkipped, "All results should be 'skipped' in dry-run mode")
      assertEquals(results[0].results.length, 3, "Should report 3 files in dry-run")
    } finally {
      Deno.chdir(origCwd)
      Deno.env.delete("WEBHOOK_TOKEN")
      await server.shutdown()
      if (tempDir) await Deno.remove(tempDir, { recursive: true }).catch(() => {})
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
})

Deno.test({
  name: "smoke - second sync updates existing pages",
  async fn() {
    const port = 19878
    const { server, requests } = startMockServer(port)
    const origCwd = Deno.cwd()
    let tempDir = ""

    try {
      Deno.env.set("WEBHOOK_TOKEN", "test-webhook-token")
      tempDir = await createTempRepo(port)
      Deno.chdir(tempDir)

      await sync({
        configPath: join(tempDir, ".docs-mirror.yml"),
        repoUrl: "https://github.com/test-org/test-repo",
      })

      const results2 = await sync({
        configPath: join(tempDir, ".docs-mirror.yml"),
        repoUrl: "https://github.com/test-org/test-repo",
      })

      const updated = results2[0].results.filter((r) => r.action === "updated")
      const created = results2[0].results.filter((r) => r.action === "created")
      const failed = results2[0].results.filter((r) => r.action === "failed")

      assertEquals(
        failed.length,
        0,
        `No pages should fail on second sync: ${JSON.stringify(failed)}`,
      )
      assertEquals(created.length, 0, "Second sync should not create new pages")
      assertEquals(
        updated.length,
        2,
        "Second sync should update 2 pages (README updates root page separately)",
      )

      const putRequests = requests.filter((r) =>
        r.method === "PUT" && r.path.startsWith("/api/pages/")
      )
      assert(putRequests.length >= 2, "Should have PUT requests for updates")
    } finally {
      Deno.chdir(origCwd)
      Deno.env.delete("WEBHOOK_TOKEN")
      await server.shutdown()
      if (tempDir) await Deno.remove(tempDir, { recursive: true }).catch(() => {})
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
})
