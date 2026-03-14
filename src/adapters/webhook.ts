import { parse as parseYaml } from "@std/yaml"
import type { Adapter, AdapterConfig, Page, SyncResult } from "./types.ts"
import { toHtml, rewriteLinks } from "../markdown.ts"
import { contentHash } from "../engine.ts"

interface WebhookTemplate {
  auth: {
    method: "bearer" | "basic" | "header" | "none"
    token_env?: string
    username_env?: string
    password_env?: string
    header_name?: string
    header_value_env?: string
  }
  content_format: "markdown" | "html"
  endpoints: {
    get_collection?: EndpointDef
    create_collection?: EndpointDef
    get_page?: EndpointDef
    create_page?: EndpointDef
    update_page?: EndpointDef
    lock_page?: EndpointDef
  }
  response: {
    id_path: string
    url_path: string
  }
  banner: boolean
}

interface EndpointDef {
  method: string
  url: string
  body?: string
}

export function createWebhookAdapter(_config: AdapterConfig): Adapter {
  let template: WebhookTemplate
  let authHeaders: Record<string, string>

  async function ensureTemplate(config: AdapterConfig): Promise<void> {
    if (template) return
    const path = config.template ?? _config.template
    if (!path) throw new Error("Webhook adapter requires 'template' path in config")
    const text = await Deno.readTextFile(path)
    template = parseYaml(text) as WebhookTemplate
  }

  function replacePlaceholders(
    text: string,
    vars: Record<string, string>,
    jsonEscape = false,
  ): string {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      const val = vars[key]
      if (val === undefined) return match
      if (jsonEscape && key !== "tags") {
        return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
      }
      return val
    })
  }

  function extractJsonPath(obj: unknown, path: string): string | undefined {
    const parts = path.split(".")
    let current: unknown = obj
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current != null ? String(current) : undefined
  }

  async function callEndpoint(
    endpoint: EndpointDef | undefined,
    vars: Record<string, string>,
  ): Promise<Response | null> {
    if (!endpoint?.url) return null
    const url = replacePlaceholders(endpoint.url, vars)
    const options: RequestInit = {
      method: endpoint.method || "GET",
      headers: { "Content-Type": "application/json", ...authHeaders },
    }
    if (endpoint.body && endpoint.method !== "GET") {
      options.body = replacePlaceholders(endpoint.body, vars, true)
    }
    return await fetch(url, options)
  }

  const adapter: Adapter = {
    name: "webhook",

    async validate(config: AdapterConfig): Promise<void> {
      await ensureTemplate(config)
      authHeaders = resolveAuth(template.auth)

      if (template.endpoints.get_collection?.url) {
        const res = await callEndpoint(template.endpoints.get_collection, { collection: "test" })
        if (res && (res.status === 401 || res.status === 403)) {
          throw new Error(`Webhook auth failed (${res.status}). Check your credentials.`)
        }
      }
    },

    async ensureCollection(name: string): Promise<{ id: string; url: string }> {
      const vars = { collection: name }
      const getRes = await callEndpoint(template.endpoints.get_collection, vars)

      if (getRes?.ok) {
        const data = await getRes.json()
        return {
          id: extractJsonPath(data, template.response.id_path) ?? name,
          url: extractJsonPath(data, template.response.url_path) ?? "",
        }
      }

      const createRes = await callEndpoint(template.endpoints.create_collection, vars)
      if (!createRes?.ok) {
        const body = await createRes?.text()
        throw new Error(`Failed to create collection '${name}': ${body}`)
      }
      const data = await createRes.json()
      return {
        id: extractJsonPath(data, template.response.id_path) ?? name,
        url: extractJsonPath(data, template.response.url_path) ?? "",
      }
    },

    async ensureRootPage(collection: string, title: string): Promise<{ id: string; slug: string }> {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      const vars = { collection, slug, title }
      const getRes = await callEndpoint(template.endpoints.get_page, vars)

      if (getRes?.ok) {
        const data = await getRes.json()
        return {
          id: extractJsonPath(data, template.response.id_path) ?? slug,
          slug,
        }
      }

      const createRes = await callEndpoint(template.endpoints.create_page, {
        ...vars,
        content: `Root page for mirrored documentation.`,
        parent: "",
        tags: "[]",
      })
      if (!createRes?.ok) {
        const body = await createRes?.text()
        throw new Error(`Failed to create root page '${title}': ${body}`)
      }
      const data = await createRes.json()
      return {
        id: extractJsonPath(data, template.response.id_path) ?? slug,
        slug,
      }
    },

    convertMarkdown(markdown: string, sourceUrl: string, banner: boolean): string {
      if (template.content_format === "html") {
        return toHtml(markdown, sourceUrl, banner)
      }
      return banner
        ? toLinearStyleBanner(sourceUrl) + "\n\n" + rewriteLinks(markdown, sourceUrl)
        : rewriteLinks(markdown, sourceUrl)
    },

    async sync(collection: string, pages: Page[]): Promise<SyncResult[]> {
      const results: SyncResult[] = []

      for (const page of pages) {
        try {
          await contentHash(page.content)
          const vars: Record<string, string> = {
            collection,
            slug: page.slug,
            title: page.title,
            content: page.content,
            parent: page.parentSlug ?? "",
            tags: JSON.stringify(page.tags),
            page_id: "",
          }

          const getRes = await callEndpoint(template.endpoints.get_page, vars)

          if (getRes?.ok) {
            const data = await getRes.json()
            const pageId = extractJsonPath(data, template.response.id_path) ?? ""
            vars.page_id = pageId

            const updateRes = await callEndpoint(template.endpoints.update_page, vars)
            if (!updateRes?.ok) {
              const body = await updateRes?.text()
              results.push({ slug: page.slug, action: "failed", error: body })
              continue
            }
            const updateData = await updateRes.json()
            results.push({
              slug: page.slug,
              action: "updated",
              url: extractJsonPath(updateData, template.response.url_path),
            })
          } else {
            const createRes = await callEndpoint(template.endpoints.create_page, vars)
            if (!createRes?.ok) {
              const body = await createRes?.text()
              results.push({ slug: page.slug, action: "failed", error: body })
              continue
            }
            const createData = await createRes.json()
            results.push({
              slug: page.slug,
              action: "created",
              url: extractJsonPath(createData, template.response.url_path),
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

    async lock(_collection: string, slugs: string[]): Promise<void> {
      if (!template.endpoints.lock_page?.url) return
      for (const slug of slugs) {
        try {
          await callEndpoint(template.endpoints.lock_page, { slug, page_id: slug })
        } catch {
          // Lock failures are non-fatal
        }
      }
    },
  }

  return adapter
}

function resolveAuth(auth: WebhookTemplate["auth"]): Record<string, string> {
  switch (auth.method) {
    case "bearer": {
      const token = Deno.env.get(auth.token_env ?? "WEBHOOK_TOKEN")
      if (!token) throw new Error(`${auth.token_env ?? "WEBHOOK_TOKEN"} is missing`)
      return { Authorization: `Bearer ${token}` }
    }
    case "basic": {
      const user = Deno.env.get(auth.username_env ?? "WEBHOOK_USERNAME")
      const pass = Deno.env.get(auth.password_env ?? "WEBHOOK_PASSWORD")
      if (!user || !pass) throw new Error("Webhook basic auth credentials missing")
      return { Authorization: `Basic ${btoa(`${user}:${pass}`)}` }
    }
    case "header": {
      const name = auth.header_name ?? "X-API-Key"
      const value = Deno.env.get(auth.header_value_env ?? "WEBHOOK_API_KEY")
      if (!value) throw new Error(`${auth.header_value_env ?? "WEBHOOK_API_KEY"} is missing`)
      return { [name]: value }
    }
    case "none":
      return {}
    default:
      throw new Error(`Unknown webhook auth method: ${auth.method}`)
  }
}

function toLinearStyleBanner(sourceUrl: string): string {
  const editUrl = sourceUrl.replace("/blob/", "/edit/")
  const path = sourceUrl.match(/github\.com\/([^/]+\/[^/]+)\/blob\/[^/]+\/(.+)/)
  const display = path ? `${path[1]}/${path[2]}` : sourceUrl
  return [
    `> **Mirrored from GitHub** \u2014 This document is published from`,
    `> [${display}](${sourceUrl}).`,
    `> Edits here will be overwritten on next sync.`,
    `> [Edit on GitHub \u2192](${editUrl})`,
    "",
    "---",
  ].join("\n")
}
