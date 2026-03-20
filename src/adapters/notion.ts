import type { Adapter, AdapterConfig, Page, SyncResult } from "./types.ts"
import { SyncConflictError } from "./types.ts"
import { toNotionMarkdown } from "../markdown.ts"
import { contentHash } from "../engine.ts"

const API_BASE = "https://api.notion.com/v1"
const NOTION_VERSION = "2022-06-28"

interface NotionState {
  token: string
  parentPageId?: string
}

export function createNotionAdapter(_config: AdapterConfig): Adapter {
  let state: NotionState

  function headers(): Record<string, string> {
    return {
      "Authorization": `Bearer ${state.token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    }
  }

  async function api(
    path: string,
    options?: RequestInit,
  ): Promise<Response> {
    const url = `${API_BASE}${path}`
    return await fetchWithRetry(url, {
      ...options,
      headers: { ...headers(), ...options?.headers },
    })
  }

  async function searchPages(
    query: string,
    parentId?: string,
  ): Promise<NotionPage[]> {
    const body: Record<string, unknown> = {
      query,
      filter: { value: "page", property: "object" },
      page_size: 100,
    }
    const res = await api("/search", {
      method: "POST",
      body: JSON.stringify(body),
    })
    if (!res.ok) return []
    const data = await res.json()
    const pages = (data.results ?? []) as NotionPage[]
    if (parentId) {
      return pages.filter((p) => p.parent?.page_id === parentId)
    }
    return pages
  }

  function extractTitle(page: NotionPage): string {
    const titleProp = page.properties?.title ?? page.properties?.Name
    if (!titleProp?.title) return ""
    return titleProp.title.map((t: { plain_text: string }) => t.plain_text).join("")
  }

  function pageUrl(page: NotionPage): string {
    return page.url ?? `https://notion.so/${page.id.replace(/-/g, "")}`
  }

  async function getChildren(blockId: string): Promise<NotionBlock[]> {
    const blocks: NotionBlock[] = []
    let cursor: string | undefined

    do {
      const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100"
      const res = await api(`/blocks/${blockId}/children${qs}`)
      if (!res.ok) break
      const data = await res.json()
      blocks.push(...(data.results ?? []))
      cursor = data.has_more ? data.next_cursor : undefined
    } while (cursor)

    return blocks
  }

  async function getPageText(pageId: string): Promise<string> {
    const blocks = await getChildren(pageId)
    return blocks
      .map((b) => {
        const rt = b[b.type as keyof NotionBlock] as { rich_text?: RichText[] } | undefined
        if (!rt?.rich_text) return ""
        return rt.rich_text.map((t) => t.plain_text).join("")
      })
      .join("\n")
  }

  function markerBlock(slug: string, hash: string): Record<string, unknown> {
    return {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{
          type: "text",
          text: { content: `docs-mirror:slug=${slug}&hash=${hash}` },
          annotations: { color: "default" },
        }],
        color: "default",
      },
    }
  }

  function markdownToBlocks(md: string): Record<string, unknown>[] {
    const blocks: Record<string, unknown>[] = []
    const lines = md.split("\n")
    let inCode = false
    let codeLang = ""
    let codeLines: string[] = []

    for (const line of lines) {
      if (line.startsWith("```")) {
        if (!inCode) {
          inCode = true
          codeLang = line.slice(3).trim()
          codeLines = []
        } else {
          blocks.push({
            object: "block",
            type: "code",
            code: {
              rich_text: [{ type: "text", text: { content: codeLines.join("\n") } }],
              language: mapLanguage(codeLang),
            },
          })
          inCode = false
          codeLang = ""
          codeLines = []
        }
        continue
      }

      if (inCode) {
        codeLines.push(line)
        continue
      }

      if (line.startsWith("### ")) {
        blocks.push({
          object: "block",
          type: "heading_3",
          heading_3: { rich_text: parseInline(line.slice(4)) },
        })
      } else if (line.startsWith("## ")) {
        blocks.push({
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: parseInline(line.slice(3)) },
        })
      } else if (line.startsWith("# ")) {
        blocks.push({
          object: "block",
          type: "heading_1",
          heading_1: { rich_text: parseInline(line.slice(2)) },
        })
      } else if (line.startsWith("> ")) {
        blocks.push({
          object: "block",
          type: "quote",
          quote: { rich_text: parseInline(line.slice(2)) },
        })
      } else if (/^[-*]\s/.test(line)) {
        blocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: parseInline(line.replace(/^[-*]\s+/, "")) },
        })
      } else if (/^\d+\.\s/.test(line)) {
        blocks.push({
          object: "block",
          type: "numbered_list_item",
          numbered_list_item: { rich_text: parseInline(line.replace(/^\d+\.\s+/, "")) },
        })
      } else if (line.match(/^-{3,}$/)) {
        blocks.push({ object: "block", type: "divider", divider: {} })
      } else if (line.startsWith("![")) {
        const imgMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/)
        if (imgMatch) {
          blocks.push({
            object: "block",
            type: "image",
            image: { type: "external", external: { url: imgMatch[2] } },
          })
        }
      } else if (line.trim() === "") {
        continue
      } else {
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: parseInline(line) },
        })
      }
    }

    return blocks
  }

  function parseInline(text: string): Record<string, unknown>[] {
    const parts: Record<string, unknown>[] = []
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)|([^*`[]+))/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      if (match[2]) {
        parts.push({
          type: "text",
          text: { content: match[2] },
          annotations: { bold: true },
        })
      } else if (match[3]) {
        parts.push({
          type: "text",
          text: { content: match[3] },
          annotations: { italic: true },
        })
      } else if (match[4]) {
        parts.push({
          type: "text",
          text: { content: match[4] },
          annotations: { code: true },
        })
      } else if (match[5] && match[6]) {
        parts.push({
          type: "text",
          text: { content: match[5], link: { url: match[6] } },
        })
      } else if (match[7]) {
        parts.push({
          type: "text",
          text: { content: match[7] },
        })
      }
    }

    if (parts.length === 0) {
      parts.push({ type: "text", text: { content: text } })
    }

    return parts
  }

  function mapLanguage(lang: string): string {
    const map: Record<string, string> = {
      ts: "typescript",
      js: "javascript",
      py: "python",
      rb: "ruby",
      sh: "shell",
      bash: "shell",
      yml: "yaml",
      md: "markdown",
      "": "plain text",
    }
    return map[lang] ?? (lang || "plain text")
  }

  async function clearBlocks(pageId: string): Promise<void> {
    const blocks = await getChildren(pageId)
    for (const block of blocks) {
      await api(`/blocks/${block.id}`, { method: "DELETE" })
    }
  }

  async function appendBlocks(
    pageId: string,
    blocks: Record<string, unknown>[],
  ): Promise<void> {
    const chunks = chunkArray(blocks, 100)
    for (const chunk of chunks) {
      const res = await api(`/blocks/${pageId}/children`, {
        method: "PATCH",
        body: JSON.stringify({ children: chunk }),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Failed to append blocks to ${pageId}: ${body}`)
      }
    }
  }

  function extractMarker(
    text: string,
  ): { slug: string; hash?: string } | null {
    const match = text.match(/docs-mirror:slug=([^&\s]+)(?:&hash=([a-f0-9]+))?/)
    if (!match) return null
    return { slug: match[1], hash: match[2] }
  }

  const adapter: Adapter = {
    name: "notion",

    async validate(config: AdapterConfig): Promise<void> {
      const token = Deno.env.get("NOTION_TOKEN")
      if (!token) {
        throw new Error(
          "NOTION_TOKEN is missing. Create an internal integration at https://www.notion.so/my-integrations " +
            "and set the token as an environment variable.",
        )
      }

      state = {
        token,
        parentPageId: config.page_id as string | undefined,
      }

      const res = await api("/users/me")
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Notion auth failed (${res.status}): ${body}`)
      }
    },

    async ensureCollection(name: string): Promise<{ id: string; url: string }> {
      if (state.parentPageId) {
        const res = await api(`/pages/${state.parentPageId}`)
        if (!res.ok) {
          throw new Error(
            `Configured page_id '${state.parentPageId}' not found or not accessible. ` +
              `Share the page with your Notion integration.`,
          )
        }
        const page = await res.json()
        return {
          id: page.id,
          url: page.url ?? `https://notion.so/${page.id.replace(/-/g, "")}`,
        }
      }

      const results = await searchPages(name)
      const existing = results.find((p) => extractTitle(p) === name)
      if (existing) {
        return { id: existing.id, url: pageUrl(existing) }
      }

      const createRes = await api("/pages", {
        method: "POST",
        body: JSON.stringify({
          parent: { type: "workspace", workspace: true },
          properties: {
            title: { title: [{ type: "text", text: { content: name } }] },
          },
          children: [{
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{
                type: "text",
                text: { content: `Container for mirrored documentation: ${name}` },
              }],
            },
          }],
        }),
      })
      if (!createRes.ok) {
        const body = await createRes.text()
        throw new Error(`Failed to create Notion collection page '${name}': ${body}`)
      }
      const page = await createRes.json()
      return { id: page.id, url: pageUrl(page) }
    },

    async ensureRootPage(
      collection: string,
      title: string,
      content?: string,
    ): Promise<{ id: string; slug: string }> {
      const parent = await adapter.ensureCollection(collection)
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

      const results = await searchPages(title, parent.id)
      const existing = results.find((p) => extractTitle(p) === title)

      if (existing) {
        const text = await getPageText(existing.id)
        const marker = extractMarker(text)
        if (!marker) {
          throw new SyncConflictError(
            title,
            `A Notion page titled '${title}' already exists under '${collection}' ` +
              `(id: ${existing.id}) but is not managed by docs-mirror.`,
            `Set 'root_page' in .docs-mirror.yml to a unique title, or archive the existing page in Notion.`,
          )
        }

        if (content) {
          const hash = await contentHash(content)
          if (marker.hash !== hash) {
            await clearBlocks(existing.id)
            const blocks = markdownToBlocks(content)
            blocks.push(markerBlock(slug, hash))
            await appendBlocks(existing.id, blocks)
          }
        }
        return { id: existing.id, slug }
      }

      const hash = content ? await contentHash(content) : ""
      const blocks = content
        ? [...markdownToBlocks(content), markerBlock(slug, hash)]
        : [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{
                type: "text",
                text: { content: "Root page for mirrored documentation." },
              }],
            },
          },
          markerBlock(slug, ""),
        ]

      const createRes = await api("/pages", {
        method: "POST",
        body: JSON.stringify({
          parent: { type: "page_id", page_id: parent.id },
          properties: {
            title: { title: [{ type: "text", text: { content: title } }] },
          },
          children: blocks,
        }),
      })
      if (!createRes.ok) {
        const body = await createRes.text()
        throw new Error(`Failed to create root page '${title}': ${body}`)
      }
      const page = await createRes.json()
      return { id: page.id, slug }
    },

    convertMarkdown(markdown: string, sourceUrl: string, banner: boolean): string {
      return toNotionMarkdown(markdown, sourceUrl, banner)
    },

    async sync(collection: string, pages: Page[]): Promise<SyncResult[]> {
      const parent = await adapter.ensureCollection(collection)
      const results: SyncResult[] = []

      const allChildren = await searchPages("", parent.id)
      const childTextCache = new Map<string, string>()
      for (const child of allChildren) {
        const text = await getPageText(child.id)
        childTextCache.set(child.id, text)
      }

      for (const page of pages) {
        try {
          const hash = await contentHash(page.content)
          const blocks = markdownToBlocks(page.content)
          blocks.push(markerBlock(page.slug, hash))

          let existing: NotionPage | undefined
          if (page.remoteId) {
            existing = allChildren.find((c) => c.id === page.remoteId)
          }
          if (!existing) {
            existing = allChildren.find((c) => {
              const text = childTextCache.get(c.id) ?? ""
              const marker = extractMarker(text)
              return marker?.slug === page.slug
            })
          }

          if (existing) {
            const text = childTextCache.get(existing.id) ?? ""
            const marker = extractMarker(text)
            if (marker?.hash === hash) {
              results.push({ slug: page.slug, action: "skipped", id: existing.id })
              continue
            }

            await api(`/pages/${existing.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                properties: {
                  title: { title: [{ type: "text", text: { content: page.title } }] },
                },
              }),
            })

            await clearBlocks(existing.id)
            await appendBlocks(existing.id, blocks)

            results.push({
              slug: page.slug,
              action: "updated",
              id: existing.id,
              url: pageUrl(existing),
            })
          } else {
            let parentId = parent.id
            if (page.parentSlug) {
              const parentPage = allChildren.find((c) => {
                const text = childTextCache.get(c.id) ?? ""
                const marker = extractMarker(text)
                return marker?.slug === page.parentSlug
              })
              if (parentPage) parentId = parentPage.id
            }

            const createRes = await api("/pages", {
              method: "POST",
              body: JSON.stringify({
                parent: { type: "page_id", page_id: parentId },
                properties: {
                  title: { title: [{ type: "text", text: { content: page.title } }] },
                },
                children: blocks,
              }),
            })
            if (!createRes.ok) {
              const body = await createRes.text()
              results.push({
                slug: page.slug,
                action: "failed",
                error: `Create failed (${createRes.status}): ${body}`,
              })
              continue
            }
            const created = await createRes.json() as NotionPage
            allChildren.push(created)
            childTextCache.set(
              created.id,
              `docs-mirror:slug=${page.slug}&hash=${hash}`,
            )

            results.push({
              slug: page.slug,
              action: "created",
              id: created.id,
              url: pageUrl(created),
            })
          }
        } catch (err) {
          if (err instanceof SyncConflictError) throw err
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
      const res = await api(`/pages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      })
      if (!res.ok && res.status !== 404) {
        const body = await res.text()
        throw new Error(`Failed to archive Notion page ${id}: ${body}`)
      }
    },

    async lock(_collection: string, _slugs: string[]): Promise<void> {
      // Notion does not support page-level edit restrictions via API
    },
  }

  return adapter
}

interface RichText {
  plain_text: string
  type: string
}

interface NotionPage {
  id: string
  url?: string
  parent?: { page_id?: string; type?: string }
  properties?: Record<string, { title?: { plain_text: string }[] }>
  [key: string]: unknown
}

interface NotionBlock {
  id: string
  type: string
  [key: string]: unknown
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
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
      const retryAfter = response.headers.get("Retry-After")
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : baseDelay * Math.pow(2, attempt) + Math.random() * 500
      await new Promise((r) => setTimeout(r, delay))
      continue
    }
    return response
  }
  throw new Error(`Request to ${url} failed after ${retries} retries`)
}
