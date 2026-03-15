import type { Adapter, AdapterConfig, Page, SyncResult } from "./types.ts"
import { toConfluenceStorage } from "../markdown.ts"
import { contentHash } from "../engine.ts"

interface ConfluenceState {
  baseUrl: string
  auth: string
}

export function createConfluenceAdapter(_config: AdapterConfig): Adapter {
  let state: ConfluenceState

  function headers(): Record<string, string> {
    return {
      "Authorization": `Basic ${state.auth}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    }
  }

  async function api(path: string, options?: RequestInit): Promise<Response> {
    const url = `${state.baseUrl}${path}`
    const response = await fetchWithRetry(url, { ...options, headers: { ...headers(), ...options?.headers } })
    return response
  }

  const adapter: Adapter = {
    name: "confluence",

    async validate(config: AdapterConfig): Promise<void> {
      const email = Deno.env.get("CONFLUENCE_EMAIL")
      const token = Deno.env.get("CONFLUENCE_TOKEN")
      if (!email) {
        throw new Error(
          "CONFLUENCE_EMAIL is missing. Set it as an environment variable or in .env",
        )
      }
      if (!token) {
        throw new Error(
          "CONFLUENCE_TOKEN is missing. Create one at https://id.atlassian.com/manage-profile/security/api-tokens",
        )
      }
      if (!config.url) {
        throw new Error("Confluence adapter requires 'url' in config")
      }

      state = {
        baseUrl: config.url.replace(/\/$/, ""),
        auth: btoa(`${email}:${token}`),
      }

      const res = await api("/wiki/api/v2/spaces?limit=1")
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Confluence auth failed (${res.status}): ${body}`)
      }
    },

    async ensureCollection(name: string): Promise<{ id: string; url: string }> {
      const res = await api(`/wiki/api/v2/spaces?keys=&limit=250`)
      const data = await res.json()
      const existing = data.results?.find(
        (s: { name: string }) => s.name === name,
      )
      if (existing) {
        return {
          id: existing.id,
          url: `${state.baseUrl}/wiki/spaces/${existing.key}`,
        }
      }

      const key = name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10) || "DOCS"

      const createRes = await api("/wiki/api/v2/spaces", {
        method: "POST",
        body: JSON.stringify({ name, key, description: { plain: { value: `Mirrored docs: ${name}`, representation: "plain" } } }),
      })
      if (!createRes.ok) {
        const body = await createRes.text()
        throw new Error(`Failed to create Confluence space '${name}': ${body}`)
      }
      const space = await createRes.json()
      return {
        id: space.id,
        url: `${state.baseUrl}/wiki/spaces/${space.key}`,
      }
    },

    async ensureRootPage(collection: string, title: string, content?: string): Promise<{ id: string; slug: string }> {
      const spaceResult = await adapter.ensureCollection(collection)
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      const searchRes = await api(
        `/wiki/api/v2/pages?space-id=${spaceResult.id}&title=${encodeURIComponent(title)}&limit=1`,
      )
      const searchData = await searchRes.json()
      if (searchData.results?.length > 0) {
        const page = searchData.results[0]
        const markerSlug = await getProperty(page.id, "docs-mirror-slug")
        const ownedByUs = markerSlug !== null
        if (content && ownedByUs) {
          const existingHash = await getProperty(page.id, "docs-mirror-hash")
          const newHash = await contentHash(content)
          if (existingHash !== newHash) {
            await api(`/wiki/api/v2/pages/${page.id}`, {
              method: "PUT",
              body: JSON.stringify({
                id: page.id,
                status: "current",
                title,
                version: { number: (page.version?.number ?? 1) + 1 },
                body: { representation: "storage", value: content },
              }),
            })
            await setProperty(page.id, "docs-mirror-hash", newHash)
          }
        }
        if (!ownedByUs) {
          await setProperty(page.id, "docs-mirror-slug", slug)
        }
        return { id: page.id, slug }
      }

      const bodyValue = content ?? `<p>Root page for mirrored documentation.</p>`
      const createRes = await api("/wiki/api/v2/pages", {
        method: "POST",
        body: JSON.stringify({
          spaceId: spaceResult.id,
          title,
          status: "current",
          body: { representation: "storage", value: bodyValue },
        }),
      })
      if (!createRes.ok) {
        const body = await createRes.text()
        throw new Error(`Failed to create root page '${title}': ${body}`)
      }
      const page = await createRes.json()
      await setProperty(page.id, "docs-mirror-slug", slug)
      if (content) {
        await setProperty(page.id, "docs-mirror-hash", await contentHash(content))
      }
      return { id: page.id, slug }
    },

    convertMarkdown(markdown: string, sourceUrl: string, banner: boolean): string {
      return toConfluenceStorage(markdown, sourceUrl, banner)
    },

    async sync(collection: string, pages: Page[]): Promise<SyncResult[]> {
      const spaceResult = await adapter.ensureCollection(collection)
      const results: SyncResult[] = []

      for (const page of pages) {
        try {
          const existing = page.remoteId
            ? await findPageById(page.remoteId)
            : await findPageBySlug(spaceResult.id, page.slug)
          const hash = await contentHash(page.content)

          if (existing) {
            const existingHash = await getProperty(existing.id, "docs-mirror-hash")
            if (existingHash === hash) {
              results.push({ slug: page.slug, action: "skipped", id: existing.id })
              continue
            }

            const updateRes = await api(`/wiki/api/v2/pages/${existing.id}`, {
              method: "PUT",
              body: JSON.stringify({
                id: existing.id,
                status: "current",
                title: page.title,
                version: { number: existing.version + 1 },
                body: { representation: "storage", value: page.content },
              }),
            })
            if (!updateRes.ok) {
              const body = await updateRes.text()
              results.push({ slug: page.slug, action: "failed", error: body })
              continue
            }

            await setProperty(existing.id, "docs-mirror-hash", hash)
            await setProperty(existing.id, "docs-mirror-slug", page.slug)
            if (page.tags.length > 0) await setLabels(existing.id, page.tags)

            const pageData = await updateRes.json()
            results.push({
              slug: page.slug,
              action: "updated",
              id: existing.id,
              url: `${state.baseUrl}/wiki${pageData._links?.webui ?? ""}`,
            })
          } else {
            const createRes = await api("/wiki/api/v2/pages", {
              method: "POST",
              body: JSON.stringify({
                spaceId: spaceResult.id,
                title: page.title,
                status: "current",
                parentId: page.parentSlug ? (await findPageBySlug(spaceResult.id, page.parentSlug))?.id : undefined,
                body: { representation: "storage", value: page.content },
              }),
            })
            if (!createRes.ok) {
              const body = await createRes.text()
              results.push({ slug: page.slug, action: "failed", error: body })
              continue
            }

            const pageData = await createRes.json()
            await setProperty(pageData.id, "docs-mirror-hash", hash)
            await setProperty(pageData.id, "docs-mirror-slug", page.slug)
            if (page.tags.length > 0) await setLabels(pageData.id, page.tags)

            results.push({
              slug: page.slug,
              action: "created",
              id: pageData.id,
              url: `${state.baseUrl}/wiki${pageData._links?.webui ?? ""}`,
            })
          }
        } catch (err) {
          results.push({
            slug: page.slug,
            action: "failed",
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return results
    },

    async delete(_collection: string, id: string): Promise<void> {
      const res = await api(`/wiki/api/v2/pages/${id}`, { method: "DELETE" })
      if (!res.ok && res.status !== 404) {
        const body = await res.text()
        throw new Error(`Failed to delete Confluence page ${id}: ${body}`)
      }
    },

    async lock(_collection: string, slugs: string[]): Promise<void> {
      const email = Deno.env.get("CONFLUENCE_EMAIL")
      if (!email) return

      for (const slug of slugs) {
        try {
          const searchRes = await api(
            `/wiki/api/v2/pages?title=&limit=250`,
          )
          const data = await searchRes.json()
          const page = data.results?.find(async (p: { id: string }) => {
            const propSlug = await getProperty(p.id, "docs-mirror-slug")
            return propSlug === slug
          })
          if (!page) continue

          await api(`/wiki/rest/api/content/${page.id}/restriction`, {
            method: "PUT",
            body: JSON.stringify({
              results: [
                {
                  operation: "update",
                  restrictions: {
                    user: { results: [{ type: "known", accountId: email }] },
                  },
                },
              ],
            }),
          })
        } catch {
          // Lock failures are non-fatal
        }
      }
    },
  }

  async function findPageById(
    pageId: string,
  ): Promise<{ id: string; version: number } | null> {
    const res = await api(`/wiki/api/v2/pages/${pageId}`)
    if (!res.ok) return null
    const page = await res.json()
    return { id: page.id, version: page.version?.number ?? 1 }
  }

  async function findPageBySlug(
    spaceId: string,
    slug: string,
  ): Promise<{ id: string; version: number } | null> {
    const res = await api(`/wiki/api/v2/pages?space-id=${spaceId}&limit=250`)
    const data = await res.json()

    for (const page of data.results ?? []) {
      const propSlug = await getProperty(page.id, "docs-mirror-slug")
      if (propSlug === slug) {
        return { id: page.id, version: page.version?.number ?? 1 }
      }
    }
    return null
  }

  async function getProperty(pageId: string, key: string): Promise<string | null> {
    const res = await api(`/wiki/api/v2/pages/${pageId}/properties?key=${key}`)
    if (!res.ok) return null
    const data = await res.json()
    const prop = data.results?.find((p: { key: string }) => p.key === key)
    return prop?.value ?? null
  }

  async function setProperty(pageId: string, key: string, value: string): Promise<void> {
    const existing = await getProperty(pageId, key)
    if (existing !== null) {
      const propsRes = await api(`/wiki/api/v2/pages/${pageId}/properties?key=${key}`)
      const propsData = await propsRes.json()
      const prop = propsData.results?.[0]
      if (prop) {
        await api(`/wiki/api/v2/pages/${pageId}/properties/${prop.id}`, {
          method: "PUT",
          body: JSON.stringify({ key, value, version: { number: (prop.version?.number ?? 0) + 1 } }),
        })
        return
      }
    }
    await api(`/wiki/api/v2/pages/${pageId}/properties`, {
      method: "POST",
      body: JSON.stringify({ key, value }),
    })
  }

  async function setLabels(pageId: string, labels: string[]): Promise<void> {
    const body = labels.map((name) => ({ prefix: "global", name }))
    await api(`/wiki/rest/api/content/${pageId}/label`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  return adapter
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  baseDelay = 1000,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, options)
    if (response.status === 429 && attempt < retries) {
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500
      await new Promise((r) => setTimeout(r, delay))
      continue
    }
    return response
  }
  throw new Error(`Request to ${url} failed after ${retries} retries`)
}
