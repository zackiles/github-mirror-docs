import type { Adapter, AdapterConfig, Page, SyncResult } from "./types.ts"
import { toLinearMarkdown } from "../markdown.ts"
import { contentHash } from "../engine.ts"

interface LinearState {
  apiKey: string
}

export function createLinearAdapter(_config: AdapterConfig): Adapter {
  let state: LinearState

  async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetchWithRetry("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Authorization": state.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    })
    const data = await res.json()
    if (data.errors?.length) {
      throw new Error(`Linear API error: ${data.errors.map((e: { message: string }) => e.message).join(", ")}`)
    }
    return data.data as T
  }

  const adapter: Adapter = {
    name: "linear",

    async validate(_config: AdapterConfig): Promise<void> {
      const apiKey = Deno.env.get("LINEAR_API_KEY")
      if (!apiKey) {
        throw new Error(
          "LINEAR_API_KEY is missing. Create one at Linear -> Settings -> API -> Personal API keys",
        )
      }
      state = { apiKey }

      await gql<{ viewer: { id: string } }>(`query { viewer { id } }`)
    },

    async ensureCollection(name: string): Promise<{ id: string; url: string }> {
      const data = await gql<{
        projects: { nodes: { id: string; url: string; name: string }[] }
      }>(
        `query($name: String!) {
          projects(filter: { name: { eq: $name } }) {
            nodes { id url name }
          }
        }`,
        { name },
      )

      if (data.projects.nodes.length > 0) {
        const project = data.projects.nodes[0]
        return { id: project.id, url: project.url }
      }

      const teams = await gql<{ teams: { nodes: { id: string }[] } }>(
        `query { teams(first: 1) { nodes { id } } }`,
      )
      const teamId = teams.teams.nodes[0]?.id
      if (!teamId) throw new Error("No Linear team found. Create a team first.")

      const created = await gql<{
        projectCreate: { project: { id: string; url: string } }
      }>(
        `mutation($name: String!, $teamIds: [String!]!) {
          projectCreate(input: { name: $name, teamIds: $teamIds }) {
            project { id url }
          }
        }`,
        { name, teamIds: [teamId] },
      )

      return {
        id: created.projectCreate.project.id,
        url: created.projectCreate.project.url,
      }
    },

    async ensureRootPage(collection: string, title: string): Promise<{ id: string; slug: string }> {
      const project = await adapter.ensureCollection(collection)
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

      const data = await gql<{
        documents: { nodes: { id: string; content: string }[] }
      }>(
        `query($projectId: String!) {
          documents(filter: { project: { id: { eq: $projectId } } }) {
            nodes { id content }
          }
        }`,
        { projectId: project.id },
      )

      const marker = `docs-mirror:slug=${slug}`
      const existing = data.documents.nodes.find((d) => d.content?.includes(marker))
      if (existing) return { id: existing.id, slug }

      const content = `# ${title}\n\nRoot page for mirrored documentation.\n\n<!-- ${marker} -->`
      const created = await gql<{
        documentCreate: { document: { id: string } }
      }>(
        `mutation($title: String!, $content: String!, $projectId: String!) {
          documentCreate(input: { title: $title, content: $content, projectId: $projectId }) {
            document { id }
          }
        }`,
        { title, content, projectId: project.id },
      )

      return { id: created.documentCreate.document.id, slug }
    },

    convertMarkdown(markdown: string, sourceUrl: string, banner: boolean): string {
      return toLinearMarkdown(markdown, sourceUrl, banner)
    },

    async sync(collection: string, pages: Page[]): Promise<SyncResult[]> {
      const project = await adapter.ensureCollection(collection)
      const results: SyncResult[] = []

      const allDocs = await gql<{
        documents: { nodes: { id: string; content: string; url: string }[] }
      }>(
        `query($projectId: String!) {
          documents(filter: { project: { id: { eq: $projectId } } }) {
            nodes { id content url }
          }
        }`,
        { projectId: project.id },
      )

      for (const page of pages) {
        try {
          const marker = `docs-mirror:slug=${page.slug}`
          const hash = await contentHash(page.content)
          const fullMarker = `<!-- docs-mirror:slug=${page.slug}&hash=${hash} -->`
          const contentWithMarker = `${page.content}\n\n${fullMarker}`

          const existing = allDocs.documents.nodes.find((d) => d.content?.includes(marker))

          if (existing) {
            const existingHashMatch = existing.content?.match(/docs-mirror:slug=[^&]+&hash=([a-f0-9]+)/)
            if (existingHashMatch?.[1] === hash) {
              results.push({ slug: page.slug, action: "skipped" })
              continue
            }

            await gql(
              `mutation($id: String!, $title: String!, $content: String!) {
                documentUpdate(id: $id, input: { title: $title, content: $content }) {
                  document { id }
                }
              }`,
              { id: existing.id, title: page.title, content: contentWithMarker },
            )

            results.push({
              slug: page.slug,
              action: "updated",
              url: existing.url,
            })
          } else {
            const created = await gql<{
              documentCreate: { document: { id: string; url: string } }
            }>(
              `mutation($title: String!, $content: String!, $projectId: String!) {
                documentCreate(input: { title: $title, content: $content, projectId: $projectId }) {
                  document { id url }
                }
              }`,
              { title: page.title, content: contentWithMarker, projectId: project.id },
            )

            results.push({
              slug: page.slug,
              action: "created",
              url: created.documentCreate.document.url,
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

    async lock(_collection: string, _slugs: string[]): Promise<void> {
      // Linear does not support document-level edit restrictions
    },
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
