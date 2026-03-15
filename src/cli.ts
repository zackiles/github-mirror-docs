import { load as loadEnv } from "@std/dotenv"
import { expandGlob } from "@std/fs"
import { relative } from "@std/path"
import { stringify as stringifyYaml } from "@std/yaml"
import { extractTitle, inject, parse as parseFrontmatter, slugify } from "./frontmatter.ts"
import { sync } from "./engine.ts"
import {
  detectAtlassianCli,
  detectGh,
  detectRepo,
  inferAdapters,
  openBrowser,
  scanCredentials,
  setGhSecret,
  validateConfluenceCredentials,
  validateGitHubToken,
  validateLinearCredentials,
  validateUrl,
} from "./discover.ts"

const VERSION = "1.0.0"
const IS_PRODUCTION = Deno.env.get("DOCS_MIRROR_PRODUCTION") === "true"

interface GlobalFlags {
  interactive: boolean
  verbose: boolean
  help: boolean
  version: boolean
}

function parseGlobalFlags(args: string[]): { flags: GlobalFlags; rest: string[] } {
  const flags: GlobalFlags = {
    interactive: true,
    verbose: false,
    help: false,
    version: false,
  }
  const rest: string[] = []

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--non-interactive":
      case "--no-interactive":
        flags.interactive = false
        break
      case "--interactive":
        flags.interactive = true
        break
      case "--verbose":
        flags.verbose = true
        break
      case "--help":
      case "-h":
        flags.help = true
        break
      case "--version":
      case "-v":
        flags.version = true
        break
      default:
        rest.push(args[i])
    }
  }

  if (!Deno.stdin.isTerminal()) {
    flags.interactive = false
  }

  return { flags, rest }
}

function resolveEnv(cliValue: string | undefined, envName: string): string | undefined {
  return cliValue ?? Deno.env.get(envName)
}

function readLine(message: string, defaultValue?: string): string | null {
  const suffix = defaultValue ? ` [${defaultValue}]` : ""
  Deno.stdout.writeSync(new TextEncoder().encode(`${message}${suffix}: `))
  const buf = new Uint8Array(1024)
  const n = Deno.stdin.readSync(buf)
  if (n === null) return defaultValue ?? null
  const input = new TextDecoder().decode(buf.subarray(0, n)).trim()
  return input || defaultValue || null
}

function confirm(message: string, defaultYes = true): boolean {
  const hint = defaultYes ? "Y/n" : "y/N"
  const answer = readLine(`${message} (${hint})`)
  if (!answer) return defaultYes
  return defaultYes ? answer.toLowerCase() !== "n" : answer.toLowerCase() === "y"
}

async function main() {
  const { flags, rest } = parseGlobalFlags(Deno.args)
  const command = rest[0]

  try {
    await loadEnv({ export: true })
  } catch {
    // .env file is optional
  }

  if (flags.version) {
    console.log(`docs-mirror v${VERSION}`)
    return
  }

  if (flags.help) {
    printHelp()
    return
  }

  switch (command) {
    case "init":
      await init(flags, rest.slice(1))
      break
    case "sync":
      await runSync(flags, rest.slice(1))
      break
    case "uninstall":
      await uninstall(flags, rest.slice(1))
      break
    case "uninstall-binary":
      await uninstallBinary()
      break
    case "--version":
    case "-v":
      console.log(`docs-mirror v${VERSION}`)
      break
    case undefined:
      printHelp()
      break
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      Deno.exit(1)
  }
}

interface ParsedFlags {
  confluenceUrl?: string
  confluenceEmail?: string
  confluenceToken?: string
  linearApiKey?: string
  webhookTemplate?: string
  githubWiki?: boolean
  githubWikiRepo?: string
  githubToken?: string
  collection?: string
  exclude?: string
  configPath: string
  dryRun: boolean
  files: string[]
  removeWorkflow?: boolean
  removeConfig?: boolean
  stripFrontmatter?: boolean
}

function parseFlags(args: string[]): ParsedFlags {
  const result: ParsedFlags = { configPath: ".docs-mirror.yml", dryRun: false, files: [] }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--confluence-url":
        result.confluenceUrl = args[++i]
        break
      case "--confluence-email":
        result.confluenceEmail = args[++i]
        break
      case "--confluence-token":
        result.confluenceToken = args[++i]
        break
      case "--linear-api-key":
        result.linearApiKey = args[++i]
        break
      case "--webhook-template":
        result.webhookTemplate = args[++i]
        break
      case "--github-wiki":
        result.githubWiki = true
        break
      case "--github-wiki-repo":
        result.githubWikiRepo = args[++i]
        result.githubWiki = true
        break
      case "--github-token":
        result.githubToken = args[++i]
        break
      case "--collection":
        result.collection = args[++i]
        break
      case "--exclude":
        result.exclude = args[++i]
        break
      case "--config":
        result.configPath = args[++i]
        break
      case "--dry-run":
        result.dryRun = true
        break
      case "--remove-workflow":
        result.removeWorkflow = true
        break
      case "--keep-workflow":
        result.removeWorkflow = false
        break
      case "--remove-config":
        result.removeConfig = true
        break
      case "--keep-config":
        result.removeConfig = false
        break
      case "--strip-frontmatter":
        result.stripFrontmatter = true
        break
      default:
        if (!args[i].startsWith("--")) {
          result.files.push(args[i])
        }
    }
  }
  return result
}

async function init(global: GlobalFlags, args: string[]) {
  console.log(`\ndocs-mirror v${VERSION}\n`)
  const flags = parseFlags(args)

  const repo = detectRepo()
  if (!repo) {
    console.log("⚠ Not inside a git repository. Run this from a repo root.")
    if (!global.interactive) Deno.exit(1)
    if (!confirm("Continue anyway?", false)) return
  } else if (global.verbose) {
    console.log(`✔ Git repo: ${repo.owner}/${repo.name} (${repo.branch})`)
  }

  const gh = detectGh()
  if (gh.available && gh.authenticated && global.verbose) {
    console.log(`✔ GitHub CLI: authenticated${gh.repo ? ` (${gh.repo})` : ""}`)
  }

  const creds = scanCredentials()
  const confluenceEmail = resolveEnv(flags.confluenceEmail, "CONFLUENCE_EMAIL")
  const confluenceToken = resolveEnv(flags.confluenceToken, "CONFLUENCE_TOKEN")
  const linearApiKey = resolveEnv(flags.linearApiKey, "LINEAR_API_KEY")
  const githubToken = resolveEnv(flags.githubToken, "GITHUB_TOKEN")

  let adapters = inferAdapters(creds, flags)

  if (adapters.length === 0 && global.interactive) {
    adapters = promptAdapters()
  } else if (adapters.length === 0) {
    console.error(
      "No adapters detected. Provide adapter-specific flags (e.g. --confluence-url) or set credential env vars.",
    )
    Deno.exit(1)
  }

  console.log(`Adapters: ${adapters.join(", ")}`)

  const adapterConfigs: Record<string, unknown>[] = []

  if (adapters.includes("confluence")) {
    let url: string
    if (flags.confluenceUrl) {
      url = flags.confluenceUrl
    } else if (global.interactive) {
      url = readLine("Confluence base URL") ?? ""
    } else {
      console.error("Confluence adapter requires --confluence-url")
      Deno.exit(1)
    }

    if (url && !validateUrl(url)) {
      console.error(`Invalid URL: ${url}`)
      Deno.exit(1)
    }

    if (url && confluenceEmail && confluenceToken) {
      console.log("Validating Confluence credentials...")
      const valid = await validateConfluenceCredentials(url, confluenceEmail, confluenceToken)
      if (valid) {
        console.log("✔ Confluence credentials valid")
      } else {
        console.log(
          "⚠ Could not validate Confluence credentials (may work in CI with correct network access)",
        )
      }
    } else if (global.interactive && !confluenceEmail) {
      await promptForCredentials("confluence", gh)
    }

    adapterConfigs.push({ adapter: "confluence", url })
  }

  if (adapters.includes("linear")) {
    if (linearApiKey) {
      console.log("Validating Linear API key...")
      const valid = await validateLinearCredentials(linearApiKey)
      if (valid) {
        console.log("✔ Linear API key valid")
      } else {
        console.log("⚠ Could not validate Linear API key (may work in CI)")
      }
    } else if (global.interactive) {
      await promptForCredentials("linear", gh)
    }

    adapterConfigs.push({ adapter: "linear" })
  }

  if (adapters.includes("webhook")) {
    const template = flags.webhookTemplate ?? ".docs-mirror-webhook.yml"
    adapterConfigs.push({ adapter: "webhook", template })
  }

  if (adapters.includes("github-wiki")) {
    if (githubToken) {
      console.log("Validating GitHub token...")
      const valid = await validateGitHubToken(githubToken)
      if (valid) {
        console.log("✔ GitHub token valid")
      } else {
        console.log("⚠ Could not validate GitHub token (may work in CI with correct permissions)")
      }
    } else if (global.interactive) {
      await promptForCredentials("github-wiki", gh)
    }

    const wikiConfig: Record<string, unknown> = { adapter: "github-wiki" }
    if (flags.githubWikiRepo) {
      wikiConfig.repo = flags.githubWikiRepo
    }
    adapterConfigs.push(wikiConfig)
  }

  let collection: string
  if (global.interactive) {
    const defaultName = repo ? `${repo.name} Docs` : "Engineering Docs"
    collection = readLine(
      "Collection name (Confluence Space / Linear Project)",
      flags.collection ?? defaultName,
    ) ?? defaultName
  } else {
    collection = flags.collection ?? "Engineering Docs"
  }

  console.log("\nScanning for markdown files...\n")

  const cwd = Deno.cwd()
  const files: { path: string; rel: string; title: string }[] = []
  for await (const entry of expandGlob("{README.md,docs/**/*.md}", { root: cwd })) {
    if (!entry.isFile) continue
    const rel = relative(cwd, entry.path)
    const raw = await Deno.readTextFile(entry.path)
    const parsed = parseFrontmatter(raw, entry.path)
    files.push({ path: entry.path, rel, title: parsed.frontmatter.title })
  }

  if (files.length === 0) {
    console.log("No markdown files found in README.md or docs/")
    return
  }

  console.log(`Found ${files.length} file(s):`)
  for (const f of files) {
    const source = extractTitle(await Deno.readTextFile(f.path)) ? "from H1" : "from filename"
    console.log(`  ${f.rel.padEnd(30)} → title: "${f.title}" (${source})`)
  }

  let excludeInput: string | null = null
  if (flags.exclude) {
    excludeInput = flags.exclude
  } else if (global.interactive) {
    excludeInput = readLine("\nExclude any paths from mirroring? (glob pattern, or blank)")
  }
  const excludes = excludeInput ? [excludeInput] : []

  const filteredFiles = excludes.length > 0
    ? files.filter((f) => !excludes.some((e) => f.rel.match(globToRegex(e))))
    : files

  if (global.interactive) {
    if (!confirm(`\nAdd frontmatter to ${filteredFiles.length} files and create config?`)) {
      console.log("Aborted.")
      return
    }
  }

  let injected = 0
  let merged = 0
  for (const f of filteredFiles) {
    const raw = await Deno.readTextFile(f.path)
    const hasExisting = raw.startsWith("---")
    const updated = inject(raw, {
      title: f.title,
      slug: slugify(f.title),
      publish: true,
      collection,
    }, f.path)
    if (updated !== raw) {
      await Deno.writeTextFile(f.path, updated)
      if (hasExisting) merged++
      else injected++
    }
  }

  const configContent = buildConfig(collection, adapterConfigs, excludes)
  await Deno.writeTextFile(".docs-mirror.yml", configContent)

  await Deno.mkdir(".github/workflows", { recursive: true })
  const workflowContent = buildWorkflow(adapters)
  await Deno.writeTextFile(".github/workflows/docs-mirror.yml", workflowContent)

  await ensureGitignore()

  console.log(
    `\n✔ Added frontmatter to ${injected} files (${merged} already had frontmatter, merged)`,
  )
  console.log("✔ Created .docs-mirror.yml")
  console.log("✔ Created .github/workflows/docs-mirror.yml")
  console.log("✔ Verified .env is in .gitignore")

  if (gh.available && gh.authenticated && global.interactive) {
    await offerGhSecrets(adapters, {
      confluenceEmail: confluenceEmail,
      confluenceToken: confluenceToken,
      linearApiKey: linearApiKey,
      githubToken: githubToken,
    })
  } else {
    printSecretInstructions(adapters)
  }

  console.log("\n  2. Review and commit the changes")
  console.log("  3. Push to main to trigger your first sync")
  console.log(
    "\n  Docs: https://github.com/docs-mirror/docs-mirror/blob/main/docs/getting-started.md",
  )
}

async function promptForCredentials(
  adapter: string,
  gh: { available: boolean; authenticated: boolean },
) {
  if (adapter === "confluence") {
    console.log("\n  Confluence credentials not found in environment.")

    if (detectAtlassianCli()) {
      console.log("  Atlassian CLI (atlas) detected.")
      const generate = confirm(
        "  Generate an API token via atlas CLI for local development?",
        false,
      )
      if (generate) {
        try {
          const cmd = new Deno.Command("atlas", {
            args: ["auth", "status"],
            stdout: "piped",
            stderr: "piped",
          })
          const out = cmd.outputSync()
          const text = new TextDecoder().decode(out.stdout)
          if (out.success && text.includes("Logged in")) {
            console.log("  ✔ Atlassian CLI is authenticated")
            console.log(
              "  → You can create an API token at: https://id.atlassian.com/manage-profile/security/api-tokens",
            )
            console.log("  → Then set CONFLUENCE_EMAIL and CONFLUENCE_TOKEN in .env")
          } else {
            console.log("  ⚠ Atlassian CLI is not authenticated. Run: atlas auth login")
          }
        } catch {
          console.log("  ⚠ Could not invoke atlas CLI")
        }
      }
    }

    if (confirm("  Open browser to create an Atlassian API token?", false)) {
      const opened = openBrowser("https://id.atlassian.com/manage-profile/security/api-tokens")
      if (!opened) {
        console.log(
          "  → Open manually: https://id.atlassian.com/manage-profile/security/api-tokens",
        )
      }
    }

    const email = readLine("  CONFLUENCE_EMAIL (or blank to skip)")
    const token = readLine("  CONFLUENCE_TOKEN (or blank to skip)")

    if (email && token) {
      Deno.env.set("CONFLUENCE_EMAIL", email)
      Deno.env.set("CONFLUENCE_TOKEN", token)
      await appendToEnvFile("CONFLUENCE_EMAIL", email)
      await appendToEnvFile("CONFLUENCE_TOKEN", token)
      console.log("  ✔ Saved to .env for local development")

      if (gh.available && gh.authenticated) {
        if (confirm("  Set these as GitHub Actions secrets via gh CLI?")) {
          setGhSecret("CONFLUENCE_EMAIL", email)
          setGhSecret("CONFLUENCE_TOKEN", token)
          console.log("  ✔ GitHub secrets set")
        }
      }
    }
  }

  if (adapter === "linear") {
    console.log("\n  Linear API key not found in environment.")

    if (confirm("  Open browser to create a Linear API key?", false)) {
      openBrowser("https://linear.app/settings/api")
    }

    const key = readLine("  LINEAR_API_KEY (or blank to skip)")
    if (key) {
      Deno.env.set("LINEAR_API_KEY", key)
      await appendToEnvFile("LINEAR_API_KEY", key)
      console.log("  ✔ Saved to .env for local development")

      if (gh.available && gh.authenticated) {
        if (confirm("  Set this as a GitHub Actions secret via gh CLI?")) {
          setGhSecret("LINEAR_API_KEY", key)
          console.log("  ✔ GitHub secret set")
        }
      }
    }
  }

  if (adapter === "github-wiki") {
    console.log("\n  GITHUB_TOKEN not found in environment.")
    console.log("  In GitHub Actions, ${{ github.token }} is available automatically.")
    console.log("  For local development, create a Personal Access Token with 'repo' scope.")

    if (confirm("  Open browser to create a GitHub PAT?", false)) {
      openBrowser("https://github.com/settings/tokens/new?scopes=repo&description=docs-mirror")
    }

    const token = readLine("  GITHUB_TOKEN (or blank to skip)")
    if (token) {
      Deno.env.set("GITHUB_TOKEN", token)
      await appendToEnvFile("GITHUB_TOKEN", token)
      console.log("  ✔ Saved to .env for local development")

      if (gh.available && gh.authenticated) {
        if (confirm("  Set this as a GitHub Actions secret via gh CLI?")) {
          setGhSecret("GITHUB_TOKEN", token)
          console.log("  ✔ GitHub secret set")
        }
      }
    }
  }
}

function offerGhSecrets(
  adapters: string[],
  creds: {
    confluenceEmail?: string
    confluenceToken?: string
    linearApiKey?: string
    githubToken?: string
  },
) {
  const secrets: [string, string][] = []

  if (adapters.includes("confluence") && creds.confluenceEmail && creds.confluenceToken) {
    secrets.push(["CONFLUENCE_EMAIL", creds.confluenceEmail])
    secrets.push(["CONFLUENCE_TOKEN", creds.confluenceToken])
  }
  if (adapters.includes("linear") && creds.linearApiKey) {
    secrets.push(["LINEAR_API_KEY", creds.linearApiKey])
  }
  if (adapters.includes("github-wiki") && creds.githubToken) {
    secrets.push(["GITHUB_TOKEN", creds.githubToken])
  }

  if (secrets.length === 0) {
    printSecretInstructions(adapters)
    return
  }

  console.log(`\n  GitHub CLI detected. Set ${secrets.length} secret(s) automatically?`)
  for (const [name] of secrets) console.log(`    • ${name}`)

  if (confirm("  Set GitHub Actions secrets now?")) {
    let ok = 0
    for (const [name, value] of secrets) {
      if (setGhSecret(name, value)) {
        console.log(`  ✔ ${name}`)
        ok++
      } else {
        console.log(`  ⚠ Failed to set ${name}`)
      }
    }
    if (ok === secrets.length) {
      console.log("\n  ✔ All secrets configured. No manual steps needed!")
      return
    }
  }

  printSecretInstructions(adapters)
}

function printSecretInstructions(adapters: string[]) {
  console.log("\nNext steps:\n")
  console.log("  1. Add secrets to your GitHub repository (Settings → Secrets → Actions):\n")
  if (adapters.includes("confluence")) {
    console.log("     CONFLUENCE_EMAIL    your-email@company.com")
    console.log(
      "     CONFLUENCE_TOKEN    create at https://id.atlassian.com/manage-profile/security/api-tokens",
    )
  }
  if (adapters.includes("linear")) {
    console.log(
      "     LINEAR_API_KEY      create at Linear → Settings → API → Personal API keys",
    )
  }
  if (adapters.includes("github-wiki")) {
    console.log(
      "     GITHUB_TOKEN        in Actions, use ${{ github.token }} (automatic) or a PAT with repo scope",
    )
  }
}

async function runSync(global: GlobalFlags, args: string[]) {
  const flags = parseFlags(args)

  const confluenceEmail = resolveEnv(flags.confluenceEmail, "CONFLUENCE_EMAIL")
  const confluenceToken = resolveEnv(flags.confluenceToken, "CONFLUENCE_TOKEN")
  const linearApiKey = resolveEnv(flags.linearApiKey, "LINEAR_API_KEY")
  const githubToken = resolveEnv(flags.githubToken, "GITHUB_TOKEN")

  if (confluenceEmail) Deno.env.set("CONFLUENCE_EMAIL", confluenceEmail)
  if (confluenceToken) Deno.env.set("CONFLUENCE_TOKEN", confluenceToken)
  if (linearApiKey) Deno.env.set("LINEAR_API_KEY", linearApiKey)
  if (githubToken) Deno.env.set("GITHUB_TOKEN", githubToken)

  const inferredAdapter = inferAdapterFilter(flags)

  console.log(`docs-mirror v${VERSION} — sync\n`)

  const results = await sync({
    configPath: flags.configPath,
    dryRun: flags.dryRun,
    verbose: global.verbose,
    adapter: inferredAdapter,
    files: flags.files.length > 0 ? flags.files : undefined,
  })

  console.log("\nSync complete:")
  for (const r of results) {
    const created = r.results.filter((x) => x.action === "created").length
    const updated = r.results.filter((x) => x.action === "updated").length
    const skipped = r.results.filter((x) => x.action === "skipped").length
    const failed = r.results.filter((x) => x.action === "failed").length
    console.log(
      `  ${r.adapter}: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed`,
    )
  }

  const anyFailed = results.some((r) => r.results.some((x) => x.action === "failed"))
  if (anyFailed) Deno.exit(1)
}

function inferAdapterFilter(flags: ParsedFlags): string | undefined {
  if (flags.confluenceEmail || flags.confluenceToken || flags.confluenceUrl) return "confluence"
  if (flags.linearApiKey) return "linear"
  if (flags.webhookTemplate) return "webhook"
  if (flags.githubWiki || flags.githubWikiRepo) return "github-wiki"
  return undefined
}

async function uninstall(global: GlobalFlags, args: string[]) {
  console.log(`\ndocs-mirror — uninstall\n`)

  const flags = parseFlags(args)

  let removeWorkflow: boolean
  let removeConfig: boolean
  let stripFm: boolean

  if (global.interactive) {
    removeWorkflow = flags.removeWorkflow ?? confirm("Remove .github/workflows/docs-mirror.yml?")
    removeConfig = flags.removeConfig ?? confirm("Remove .docs-mirror.yml?")
    stripFm = flags.stripFrontmatter ??
      confirm("Strip docs-mirror frontmatter from markdown files?", false)
  } else {
    removeWorkflow = flags.removeWorkflow ?? true
    removeConfig = flags.removeConfig ?? true
    stripFm = flags.stripFrontmatter ?? false
  }

  if (removeWorkflow) {
    try {
      await Deno.remove(".github/workflows/docs-mirror.yml")
      console.log("✔ Removed .github/workflows/docs-mirror.yml")
    } catch {
      console.log("⚠ .github/workflows/docs-mirror.yml not found")
    }
  }

  if (removeConfig) {
    try {
      await Deno.remove(".docs-mirror.yml")
      console.log("✔ Removed .docs-mirror.yml")
    } catch {
      console.log("⚠ .docs-mirror.yml not found")
    }
    try {
      await Deno.remove(".docs-mirror-state.json")
      console.log("✔ Removed .docs-mirror-state.json")
    } catch {
      // state file may not exist yet
    }
  }

  if (stripFm) {
    console.log("Stripping frontmatter from markdown files...")
    for await (const entry of expandGlob("{README.md,docs/**/*.md}")) {
      if (!entry.isFile) continue
      const raw = await Deno.readTextFile(entry.path)
      if (raw.startsWith("---")) {
        const end = raw.indexOf("---", 3)
        if (end !== -1) {
          const stripped = raw.slice(end + 3).replace(/^\n+/, "")
          await Deno.writeTextFile(entry.path, stripped)
        }
      }
    }
    console.log("✔ Frontmatter stripped")
  } else {
    console.log("⚠ Frontmatter preserved (run with --strip-frontmatter to remove)")
  }

  const gh = detectGh()
  if (gh.available && gh.authenticated && global.interactive) {
    if (confirm("Remove GitHub Actions secrets via gh CLI?", false)) {
      for (
        const name of ["CONFLUENCE_EMAIL", "CONFLUENCE_TOKEN", "LINEAR_API_KEY", "GITHUB_TOKEN"]
      ) {
        try {
          const cmd = new Deno.Command("gh", {
            args: ["secret", "delete", name, "--yes"],
            stdout: "null",
            stderr: "null",
          })
          cmd.outputSync()
        } catch { /* secret may not exist */ }
      }
      console.log("✔ GitHub Actions secrets removed")
    }
  } else {
    console.log("\nRemaining manual steps:")
    console.log("  1. Remove GitHub Actions secrets if no longer needed:")
    console.log("     → CONFLUENCE_EMAIL, CONFLUENCE_TOKEN, LINEAR_API_KEY, GITHUB_TOKEN")
    console.log("     (Settings → Secrets → Actions)")
  }

  console.log("  2. Mirrored pages in Confluence/Linear are NOT deleted automatically.")
  console.log("     Delete them manually if desired, or they will remain as a snapshot.")
}

async function uninstallBinary() {
  console.log("\ndocs-mirror — uninstall binary\n")

  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ""
  const isWindows = Deno.build.os === "windows"
  const candidates = isWindows
    ? [
      `${home}\\.docs-mirror\\bin\\docs-mirror.exe`,
      `${Deno.env.get("LOCALAPPDATA") ?? ""}\\docs-mirror\\bin\\docs-mirror.exe`,
    ]
    : [
      `${home}/.docs-mirror/bin/docs-mirror`,
      "/usr/local/bin/docs-mirror",
    ]

  let removed = false
  for (const path of candidates) {
    if (!path) continue
    try {
      await Deno.stat(path)
      await Deno.remove(path)
      console.log(`✔ Removed ${path}`)
      removed = true
    } catch {
      // path doesn't exist
    }
  }

  if (!removed) {
    console.log("No production binary found in standard locations.")
    console.log("Checked:")
    for (const p of candidates) {
      if (p) console.log(`  ${p}`)
    }
  }
}

function printHelp() {
  console.log(`
docs-mirror v${VERSION}${IS_PRODUCTION ? " (production)" : ""}

Usage:
  docs-mirror <command> [options]

Commands:
  init                 Interactive setup (detects adapters from flags/env)
  sync [options]       Sync documentation to mirrors
  uninstall            Remove docs-mirror config from this repo
  uninstall-binary     Remove the docs-mirror binary from PATH

Global options:
  --interactive        Force interactive mode (default when TTY)
  --non-interactive    Disable prompts, use defaults
  --verbose            Show detailed output
  --version, -v        Print version
  --help, -h           Print help

Adapter flags (used by init and sync — adapters are inferred automatically):
  --confluence-url <url>     Confluence base URL (implies Confluence adapter)
  --confluence-email <email> Confluence email (overrides CONFLUENCE_EMAIL env)
  --confluence-token <token> Confluence API token (overrides CONFLUENCE_TOKEN env)
  --linear-api-key <key>     Linear API key (overrides LINEAR_API_KEY env, implies Linear adapter)
  --webhook-template <path>  Webhook template path (implies Webhook adapter)
  --github-wiki              Enable GitHub Wiki adapter (implies github-wiki adapter)
  --github-wiki-repo <owner/repo>  Target a different repo's wiki (implies github-wiki adapter)
  --github-token <token>     GitHub token (overrides GITHUB_TOKEN env)

Init options:
  --collection <name>        Collection name (default: derived from repo name)
  --exclude <glob>           Exclude glob pattern

Sync options:
  --dry-run                  Show what would happen without making changes
  --config <path>            Path to config file (default: .docs-mirror.yml)
  <file>                     Sync a specific file

Uninstall options:
  --remove-workflow          Remove workflow file (default in non-interactive)
  --keep-workflow            Keep workflow file
  --remove-config            Remove config file (default in non-interactive)
  --keep-config              Keep config file
  --strip-frontmatter        Strip frontmatter from markdown files

Environment detection:
  • Adapters inferred from flags and env vars (no --adapter needed)
  • Git repo detected for root_page and collection defaults
  • GitHub CLI (gh) used to set secrets automatically when available
  • Confluence/Linear credentials validated before saving config
  • CLI flags always take precedence over environment variables
`)
}

function promptAdapters(): string[] {
  const adapters: string[] = []
  if (confirm("Configure Confluence mirror?")) adapters.push("confluence")
  if (confirm("Configure Linear mirror?")) adapters.push("linear")
  if (confirm("Configure GitHub Wiki mirror?")) adapters.push("github-wiki")
  if (adapters.length === 0) {
    console.log("No adapters selected. At least one is required.")
    Deno.exit(1)
  }
  return adapters
}

function buildConfig(
  collection: string,
  mirrors: Record<string, unknown>[],
  excludes: string[],
): string {
  const config: Record<string, unknown> = { collection }
  if (excludes.length > 0) {
    config.source = {
      include: ["README.md", "docs/**/*.md"],
      exclude: excludes,
    }
  }
  config.mirrors = mirrors
  return stringifyYaml(config)
}

function buildWorkflow(adapters: string[]): string {
  const secrets: string[] = []
  if (adapters.includes("confluence")) {
    secrets.push(
      "          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}",
      "          CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}",
    )
  }
  if (adapters.includes("linear")) {
    secrets.push("          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}")
  }
  if (adapters.includes("github-wiki")) {
    secrets.push("          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}")
  }

  return `name: Mirror Docs
on:
  push:
    branches: [main]
    paths:
      - 'README.md'
      - 'docs/**'
      - '.docs-mirror.yml'

permissions:
  contents: ${adapters.includes("github-wiki") ? "write" : "read"}

concurrency:
  group: docs-mirror
  cancel-in-progress: true

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docs-mirror/docs-mirror@v1
        with:
          config: .docs-mirror.yml
        env:
${secrets.join("\n")}
`
}

async function ensureGitignore() {
  let content = ""
  try {
    content = await Deno.readTextFile(".gitignore")
  } catch {
    // No .gitignore yet
  }
  if (!content.includes(".env")) {
    const newline = content.length > 0 && !content.endsWith("\n") ? "\n" : ""
    await Deno.writeTextFile(".gitignore", `${content}${newline}.env\n`)
  }
}

async function appendToEnvFile(key: string, value: string) {
  let content = ""
  try {
    content = await Deno.readTextFile(".env")
  } catch {
    // .env doesn't exist yet
  }
  if (content.includes(`${key}=`)) return
  const newline = content.length > 0 && !content.endsWith("\n") ? "\n" : ""
  await Deno.writeTextFile(".env", `${content}${newline}${key}=${value}\n`)
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`)
}

main()
