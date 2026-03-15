export interface RepoInfo {
  root: string
  remote: string
  owner: string
  name: string
  branch: string
}

export function detectRepo(): RepoInfo | null {
  try {
    const root = run("git", ["rev-parse", "--show-toplevel"])
    if (!root) return null

    const remote = run("git", ["remote", "get-url", "origin"]) ?? ""
    const clean = remote.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/")
    const match = clean.match(/([^/]+)\/([^/]+)$/)
    const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "main"

    return {
      root,
      remote: clean,
      owner: match?.[1] ?? "",
      name: match?.[2] ?? "",
      branch,
    }
  } catch {
    return null
  }
}

export interface GhStatus {
  available: boolean
  authenticated: boolean
  repo?: string
}

export function detectGh(): GhStatus {
  try {
    const version = run("gh", ["--version"])
    if (!version) return { available: false, authenticated: false }

    const status = run("gh", ["auth", "status"])
    const authenticated = !!status && !status.includes("not logged")

    let repo: string | undefined
    if (authenticated) {
      try {
        const view = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
        if (view) repo = view
      } catch { /* not in a gh repo context */ }
    }

    return { available: true, authenticated, repo }
  } catch {
    return { available: false, authenticated: false }
  }
}

export function setGhSecret(name: string, value: string): boolean {
  try {
    const cmd = new Deno.Command("gh", {
      args: ["secret", "set", name],
      stdin: "piped",
      stdout: "null",
      stderr: "piped",
    })
    const proc = cmd.spawn()
    const writer = proc.stdin.getWriter()
    writer.write(new TextEncoder().encode(value))
    writer.close()
    const status = waitForProcess(proc)
    return status
  } catch {
    return false
  }
}

function waitForProcess(proc: Deno.ChildProcess): boolean {
  const result = new Promise<boolean>((resolve) => {
    proc.status.then((s) => resolve(s.success))
  })
  let done = false
  let success = false
  result.then((v) => {
    done = true
    success = v
  })
  const start = Date.now()
  while (!done && Date.now() - start < 10000) {
    /* spin */
  }
  return success
}

export interface CredentialScan {
  confluenceEmail?: string
  confluenceToken?: string
  linearApiKey?: string
  webhookToken?: string
  githubToken?: string
  notionToken?: string
}

export function scanCredentials(): CredentialScan {
  return {
    confluenceEmail: Deno.env.get("CONFLUENCE_EMAIL"),
    confluenceToken: Deno.env.get("CONFLUENCE_TOKEN"),
    linearApiKey: Deno.env.get("LINEAR_API_KEY"),
    webhookToken: Deno.env.get("WEBHOOK_TOKEN"),
    githubToken: Deno.env.get("GITHUB_TOKEN"),
    notionToken: Deno.env.get("NOTION_TOKEN"),
  }
}

export function inferAdapters(creds: CredentialScan, flags: {
  confluenceUrl?: string
  confluenceEmail?: string
  confluenceToken?: string
  linearApiKey?: string
  webhookTemplate?: string
  githubWiki?: boolean
  githubWikiRepo?: string
  notionToken?: string
  notionPageId?: string
}): string[] {
  const adapters: string[] = []

  if (
    flags.confluenceUrl || flags.confluenceEmail || flags.confluenceToken ||
    creds.confluenceEmail || creds.confluenceToken
  ) {
    adapters.push("confluence")
  }
  if (flags.linearApiKey || creds.linearApiKey) {
    adapters.push("linear")
  }
  if (flags.webhookTemplate || creds.webhookToken) {
    adapters.push("webhook")
  }
  if (flags.githubWiki || flags.githubWikiRepo) {
    adapters.push("github-wiki")
  }
  if (flags.notionToken || flags.notionPageId || creds.notionToken) {
    adapters.push("notion")
  }

  return adapters
}

export async function validateNotionCredentials(token: string): Promise<boolean> {
  try {
    const resp = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
      signal: AbortSignal.timeout(5000),
    })
    return resp.status === 200
  } catch {
    return false
  }
}

export async function validateGitHubToken(token: string): Promise<boolean> {
  try {
    const resp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(5000),
    })
    return resp.status === 200
  } catch {
    return false
  }
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

export async function checkConfluenceReachable(url: string): Promise<boolean> {
  try {
    const clean = url.replace(/\/$/, "")
    const resp = await fetch(`${clean}/wiki/rest/api/space?limit=1`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    })
    return resp.status !== 0
  } catch {
    return false
  }
}

export async function validateConfluenceCredentials(
  url: string,
  email: string,
  token: string,
): Promise<boolean> {
  try {
    const clean = url.replace(/\/$/, "")
    const auth = btoa(`${email}:${token}`)
    const resp = await fetch(`${clean}/wiki/rest/api/space?limit=1`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    return resp.status === 200
  } catch {
    return false
  }
}

export async function validateLinearCredentials(apiKey: string): Promise<boolean> {
  try {
    const resp = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "{ viewer { id } }" }),
      signal: AbortSignal.timeout(5000),
    })
    return resp.status === 200
  } catch {
    return false
  }
}

export function detectAtlassianCli(): boolean {
  try {
    const version = run("atlas", ["--version"])
    return !!version
  } catch {
    return false
  }
}

export function openBrowser(url: string): boolean {
  const commands: [string, string[]][] = Deno.build.os === "darwin"
    ? [["open", [url]]]
    : Deno.build.os === "windows"
    ? [["cmd", ["/c", "start", url]]]
    : [["xdg-open", [url]], ["sensible-browser", [url]]]

  for (const [cmd, args] of commands) {
    try {
      const proc = new Deno.Command(cmd, { args, stdout: "null", stderr: "null" })
      proc.outputSync()
      return true
    } catch { /* try next */ }
  }
  return false
}

function run(cmd: string, args: string[]): string | null {
  try {
    const proc = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" })
    const output = proc.outputSync()
    if (!output.success) return null
    return new TextDecoder().decode(output.stdout).trim()
  } catch {
    return null
  }
}
