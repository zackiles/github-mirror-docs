import type { Adapter, AdapterConfig, Page, SyncResult } from "./types.ts"
import { toWikiMarkdown } from "../markdown.ts"
import { contentHash } from "../engine.ts"

interface WikiState {
  token: string
  owner: string
  repo: string
  wikiDir: string
  hasChanges: boolean
}

export function createGitHubWikiAdapter(_config: AdapterConfig): Adapter {
  let state: WikiState

  function wikiCloneUrl(): string {
    return `https://x-access-token:${state.token}@github.com/${state.owner}/${state.repo}.wiki.git`
  }

  function wikiUrl(): string {
    return `https://github.com/${state.owner}/${state.repo}/wiki`
  }

  function pageUrl(slug: string): string {
    return `${wikiUrl()}/${slug}`
  }

  function pagePath(slug: string): string {
    return `${state.wikiDir}/${slug}.md`
  }

  function git(
    args: string[],
    cwd?: string,
  ): { success: boolean; stdout: string; stderr: string } {
    const cmd = new Deno.Command("git", {
      args,
      cwd: cwd ?? state.wikiDir,
      stdout: "piped",
      stderr: "piped",
      env: { GIT_TERMINAL_PROMPT: "0" },
    })
    const output = cmd.outputSync()
    return {
      success: output.success,
      stdout: new TextDecoder().decode(output.stdout).trim(),
      stderr: new TextDecoder().decode(output.stderr).trim(),
    }
  }

  function parseRepo(config: AdapterConfig): { owner: string; repo: string } {
    if (config.repo && typeof config.repo === "string") {
      const parts = (config.repo as string).split("/")
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `Invalid 'repo' value '${config.repo}'. Expected 'owner/name' format (e.g. 'myorg/my-repo').`,
        )
      }
      return { owner: parts[0], repo: parts[1] }
    }
    if (config.url) {
      const match = config.url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.wiki)?(?:\.git)?$/)
      if (match) return { owner: match[1], repo: match[2] }
    }
    try {
      const cmd = new Deno.Command("git", {
        args: ["remote", "get-url", "origin"],
        stdout: "piped",
        stderr: "null",
      })
      const output = cmd.outputSync()
      const url = new TextDecoder().decode(output.stdout).trim()
      const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
      if (match) return { owner: match[1], repo: match[2] }
    } catch {
      // not in a git repo
    }
    throw new Error(
      "Could not determine target GitHub repository. " +
        "Set 'repo: owner/name' in the github-wiki mirror config, or run from within a GitHub repo.",
    )
  }

  function cloneWiki(wikiDir: string): void {
    const cloneResult = git(["clone", "--depth=1", wikiCloneUrl(), "."], wikiDir)

    if (cloneResult.success) {
      git(["config", "user.email", "docs-mirror@users.noreply.github.com"])
      git(["config", "user.name", "docs-mirror"])
      return
    }

    git(["init"], wikiDir)
    git(["checkout", "-b", "master"], wikiDir)
    git(["remote", "add", "origin", wikiCloneUrl()], wikiDir)
    git(["config", "user.email", "docs-mirror@users.noreply.github.com"], wikiDir)
    git(["config", "user.name", "docs-mirror"], wikiDir)
  }

  async function verifyRepo(): Promise<void> {
    const res = await fetch(`https://api.github.com/repos/${state.owner}/${state.repo}`, {
      headers: {
        Authorization: `Bearer ${state.token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `GitHub API check failed for ${state.owner}/${state.repo} (${res.status}): ${body}`,
      )
    }
    const data = await res.json()
    if (!data.has_wiki) {
      throw new Error(
        `Wiki is disabled for ${state.owner}/${state.repo}. ` +
          `Enable it at https://github.com/${state.owner}/${state.repo}/settings under "Features".`,
      )
    }
  }

  function commitAndPush(): void {
    git(["add", "-A"])

    const status = git(["status", "--porcelain"])
    if (!status.stdout) return

    const commitResult = git(["commit", "-m", "docs-mirror: sync documentation"])
    if (!commitResult.success) return

    const pushResult = git(["push", "origin", "HEAD:master"])
    if (!pushResult.success) {
      const pushMain = git(["push", "origin", "HEAD:main"])
      if (!pushMain.success) {
        throw new Error(
          `Failed to push wiki changes: ${pushResult.stderr}. ` +
            `Ensure the wiki is enabled and the token has push access. ` +
            `You may need to create an initial page at ${wikiUrl()}.`,
        )
      }
    }
  }

  function generateSidebar(rootTitle: string, pages: Page[]): string {
    const lines = [`**[${rootTitle}](Home)**`, "", "---", ""]
    const sorted = [...pages].sort((a, b) => a.order - b.order)
    for (const page of sorted) {
      lines.push(`- [${page.title}](${page.slug})`)
    }
    return lines.join("\n") + "\n"
  }

  const adapter: Adapter = {
    name: "github-wiki",

    async validate(config: AdapterConfig): Promise<void> {
      const token = Deno.env.get("GITHUB_TOKEN")
      if (!token) {
        throw new Error(
          "GITHUB_TOKEN is missing. In GitHub Actions use ${{ secrets.GITHUB_TOKEN }} or ${{ github.token }}. " +
            "For local use, create a PAT at https://github.com/settings/tokens",
        )
      }

      const { owner, repo } = parseRepo(config)
      const wikiDir = await Deno.makeTempDir({ prefix: "docs-mirror-wiki-" })

      state = { token, owner, repo, wikiDir, hasChanges: false }

      await verifyRepo()
      cloneWiki(wikiDir)
    },

    ensureCollection(_name: string): Promise<{ id: string; url: string }> {
      return Promise.resolve({ id: `${state.owner}/${state.repo}`, url: wikiUrl() })
    },

    async ensureRootPage(
      _collection: string,
      title: string,
      content?: string,
    ): Promise<{ id: string; slug: string }> {
      const slug = "Home"
      const filePath = pagePath(slug)
      const hash = content ? await contentHash(content) : null

      try {
        const existing = await Deno.readTextFile(filePath)
        const existingHash = extractHash(existing)
        if (hash && existingHash !== hash) {
          await Deno.writeTextFile(
            filePath,
            content + `\n\n<!-- docs-mirror:slug=${slug}&hash=${hash} -->\n`,
          )
          state.hasChanges = true
        }
      } catch {
        const body = content
          ? content + `\n\n<!-- docs-mirror:slug=${slug}&hash=${hash} -->\n`
          : `# ${title}\n\nRoot page for mirrored documentation.\n\n<!-- docs-mirror:slug=${slug} -->\n`
        await Deno.writeTextFile(filePath, body)
        state.hasChanges = true
      }

      return { id: slug, slug }
    },

    convertMarkdown(markdown: string, sourceUrl: string, banner: boolean): string {
      return toWikiMarkdown(markdown, sourceUrl, banner)
    },

    async sync(_collection: string, pages: Page[]): Promise<SyncResult[]> {
      const results: SyncResult[] = []
      let rootTitle = "Home"

      try {
        const homePath = pagePath("Home")
        const homeContent = await Deno.readTextFile(homePath)
        const titleMatch = homeContent.match(/^#\s+(.+)$/m)
        if (titleMatch) rootTitle = titleMatch[1]
      } catch {
        // Home.md may not exist yet
      }

      for (const page of pages) {
        try {
          const hash = await contentHash(page.content)
          const marker = `<!-- docs-mirror:slug=${page.slug}&hash=${hash} -->`
          const body = `${page.content}\n\n${marker}\n`
          const filePath = pagePath(page.slug)

          try {
            const existing = await Deno.readTextFile(filePath)
            const existingHash = extractHash(existing)
            if (existingHash === hash) {
              results.push({ slug: page.slug, action: "skipped", id: page.slug })
              continue
            }
            await Deno.writeTextFile(filePath, body)
            state.hasChanges = true
            results.push({
              slug: page.slug,
              action: "updated",
              id: page.slug,
              url: pageUrl(page.slug),
            })
          } catch {
            await Deno.writeTextFile(filePath, body)
            state.hasChanges = true
            results.push({
              slug: page.slug,
              action: "created",
              id: page.slug,
              url: pageUrl(page.slug),
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

      const sidebarPath = `${state.wikiDir}/_Sidebar.md`
      const sidebarContent = generateSidebar(rootTitle, pages)
      let sidebarChanged = true
      try {
        const existing = await Deno.readTextFile(sidebarPath)
        sidebarChanged = existing !== sidebarContent
      } catch {
        // file doesn't exist yet
      }
      if (sidebarChanged) {
        await Deno.writeTextFile(sidebarPath, sidebarContent)
        state.hasChanges = true
      }

      if (state.hasChanges) {
        commitAndPush()
      }

      return results
    },

    async delete(_collection: string, id: string): Promise<void> {
      try {
        await Deno.remove(pagePath(id))
        state.hasChanges = true
      } catch {
        // file may not exist
      }
    },

    async lock(_collection: string, _slugs: string[]): Promise<void> {
      // GitHub Wiki does not support per-page edit restrictions
    },
  }

  return adapter
}

function extractHash(content: string): string | null {
  const match = content.match(/docs-mirror:slug=[^&]*&hash=([a-f0-9]+)/)
  return match?.[1] ?? null
}
