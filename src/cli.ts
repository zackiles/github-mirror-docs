import { load as loadEnv } from "@std/dotenv"
import { expandGlob } from "@std/fs"
import { relative } from "@std/path"
import { stringify as stringifyYaml } from "@std/yaml"
import { parse as parseFrontmatter, inject, extractTitle, slugify } from "./frontmatter.ts"
import { sync } from "./engine.ts"

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

  if (flags.help && !command) {
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
      await uninstallBinary(flags)
      break
    case "--help":
    case "-h":
      printHelp()
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

interface InitFlags {
  confluenceUrl?: string
  confluenceEmail?: string
  confluenceToken?: string
  linearApiKey?: string
  collection?: string
  exclude?: string
  adapters: string[]
}

function parseInitFlags(args: string[]): InitFlags {
  const result: InitFlags = { adapters: [] }
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
      case "--collection":
        result.collection = args[++i]
        break
      case "--exclude":
        result.exclude = args[++i]
        break
      case "--adapter":
        result.adapters.push(args[++i])
        break
    }
  }
  return result
}

async function init(global: GlobalFlags, args: string[]) {
  console.log(`\ndocs-mirror v${VERSION}\n`)

  const initFlags = parseInitFlags(args)

  let adapters: string[]
  if (initFlags.adapters.length > 0) {
    adapters = initFlags.adapters
  } else if (global.interactive) {
    adapters = promptAdapters()
  } else {
    adapters = ["confluence"]
  }

  const adapterConfigs: Record<string, unknown>[] = []

  if (adapters.includes("confluence")) {
    let url: string
    if (global.interactive) {
      url = readLine("Confluence base URL", initFlags.confluenceUrl ?? "") ?? ""
    } else {
      url = initFlags.confluenceUrl ?? ""
    }
    adapterConfigs.push({ adapter: "confluence", url })
  }
  if (adapters.includes("linear")) {
    adapterConfigs.push({ adapter: "linear" })
  }

  let collection: string
  if (global.interactive) {
    collection = readLine(
      "Default collection name (Confluence Space / Linear Project)",
      initFlags.collection ?? "Engineering Docs",
    ) ?? "Engineering Docs"
  } else {
    collection = initFlags.collection ?? "Engineering Docs"
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
  if (initFlags.exclude) {
    excludeInput = initFlags.exclude
  } else if (global.interactive) {
    excludeInput = readLine("\nExclude any paths from mirroring? (glob pattern, or blank)")
  }
  const excludes = excludeInput ? [excludeInput] : []

  const filteredFiles = excludes.length > 0
    ? files.filter((f) => !excludes.some((e) => f.rel.match(globToRegex(e))))
    : files

  if (global.interactive) {
    const confirm = readLine(
      `\nAdd frontmatter to ${filteredFiles.length} files and create config? (Y/n)`,
    )
    if (confirm?.toLowerCase() === "n") {
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

  console.log(`\n✔ Added frontmatter to ${injected} files (${merged} already had frontmatter, merged)`)
  console.log("✔ Created .docs-mirror.yml")
  console.log("✔ Created .github/workflows/docs-mirror.yml")
  console.log("✔ Verified .env is in .gitignore")

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
  console.log("\n  2. Review and commit the changes")
  console.log("  3. Push to main to trigger your first sync")
  console.log(
    "\n  Docs: https://github.com/docs-mirror/docs-mirror/blob/main/docs/getting-started.md",
  )
}

interface SyncFlags {
  adapter?: string
  dryRun: boolean
  files: string[]
  configPath: string
  confluenceEmail?: string
  confluenceToken?: string
  linearApiKey?: string
}

function parseSyncFlags(args: string[]): SyncFlags {
  const result: SyncFlags = {
    dryRun: false,
    files: [],
    configPath: ".docs-mirror.yml",
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--adapter":
        result.adapter = args[++i]
        break
      case "--dry-run":
        result.dryRun = true
        break
      case "--config":
        result.configPath = args[++i]
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
      default:
        if (!args[i].startsWith("--")) {
          result.files.push(args[i])
        }
    }
  }
  return result
}

async function runSync(global: GlobalFlags, args: string[]) {
  const syncFlags = parseSyncFlags(args)

  const confluenceEmail = resolveEnv(syncFlags.confluenceEmail, "CONFLUENCE_EMAIL")
  const confluenceToken = resolveEnv(syncFlags.confluenceToken, "CONFLUENCE_TOKEN")
  const linearApiKey = resolveEnv(syncFlags.linearApiKey, "LINEAR_API_KEY")

  if (confluenceEmail) Deno.env.set("CONFLUENCE_EMAIL", confluenceEmail)
  if (confluenceToken) Deno.env.set("CONFLUENCE_TOKEN", confluenceToken)
  if (linearApiKey) Deno.env.set("LINEAR_API_KEY", linearApiKey)

  console.log(`docs-mirror v${VERSION} — sync\n`)

  const results = await sync({
    configPath: syncFlags.configPath,
    dryRun: syncFlags.dryRun,
    verbose: global.verbose,
    adapter: syncFlags.adapter,
    files: syncFlags.files.length > 0 ? syncFlags.files : undefined,
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

interface UninstallFlags {
  removeWorkflow?: boolean
  removeConfig?: boolean
  stripFrontmatter?: boolean
}

function parseUninstallFlags(args: string[]): UninstallFlags {
  const result: UninstallFlags = {}
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
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
    }
  }
  return result
}

async function uninstall(global: GlobalFlags, args: string[]) {
  console.log(`\ndocs-mirror — uninstall\n`)

  const uninstallFlags = parseUninstallFlags(args)

  let removeWorkflow: boolean
  let removeConfig: boolean
  let stripFm: boolean

  if (global.interactive) {
    removeWorkflow = uninstallFlags.removeWorkflow ??
      (readLine("Remove .github/workflows/docs-mirror.yml? (Y/n)")?.toLowerCase() !== "n")
    removeConfig = uninstallFlags.removeConfig ??
      (readLine("Remove .docs-mirror.yml? (Y/n)")?.toLowerCase() !== "n")
    stripFm = uninstallFlags.stripFrontmatter ??
      (readLine("Strip docs-mirror frontmatter from markdown files? (y/N)")?.toLowerCase() === "y")
  } else {
    removeWorkflow = uninstallFlags.removeWorkflow ?? true
    removeConfig = uninstallFlags.removeConfig ?? true
    stripFm = uninstallFlags.stripFrontmatter ?? false
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

  console.log("\nRemaining manual steps:")
  console.log("  1. Remove GitHub Actions secrets if no longer needed:")
  console.log("     → CONFLUENCE_EMAIL, CONFLUENCE_TOKEN, LINEAR_API_KEY")
  console.log("     (Settings → Secrets → Actions)")
  console.log("  2. Mirrored pages in Confluence/Linear are NOT deleted automatically.")
  console.log("     Delete them manually if desired, or they will remain as a snapshot.")
}

async function uninstallBinary(_global: GlobalFlags) {
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
  init                 Interactive setup
  sync [options]       Sync documentation to mirrors
  uninstall            Remove docs-mirror config from this repo
  uninstall-binary     Remove the docs-mirror binary from PATH

Global options:
  --interactive        Force interactive mode (default when TTY)
  --non-interactive    Disable prompts, use defaults
  --verbose            Show detailed output
  --version, -v        Print version
  --help, -h           Print help

Init options:
  --adapter <name>           Add adapter (confluence, linear, webhook). Repeatable.
  --confluence-url <url>     Confluence base URL
  --confluence-email <email> Confluence email (overrides CONFLUENCE_EMAIL env)
  --confluence-token <token> Confluence API token (overrides CONFLUENCE_TOKEN env)
  --linear-api-key <key>     Linear API key (overrides LINEAR_API_KEY env)
  --collection <name>        Collection name (default: Engineering Docs)
  --exclude <glob>           Exclude glob pattern

Sync options:
  --adapter <name>           Sync to a specific adapter only
  --dry-run                  Show what would happen without making changes
  --config <path>            Path to config file (default: .docs-mirror.yml)
  --confluence-email <email> Confluence email (overrides CONFLUENCE_EMAIL env)
  --confluence-token <token> Confluence API token (overrides CONFLUENCE_TOKEN env)
  --linear-api-key <key>     Linear API key (overrides LINEAR_API_KEY env)
  <file>                     Sync a specific file

Uninstall options:
  --remove-workflow          Remove workflow file (default in non-interactive)
  --keep-workflow            Keep workflow file
  --remove-config            Remove config file (default in non-interactive)
  --keep-config              Keep config file
  --strip-frontmatter        Strip frontmatter from markdown files
`)
}

function promptAdapters(): string[] {
  const adapters: string[] = []
  const confInput = readLine("Configure Confluence mirror? (Y/n)")
  if (confInput?.toLowerCase() !== "n") adapters.push("confluence")
  const linearInput = readLine("Configure Linear mirror? (Y/n)")
  if (linearInput?.toLowerCase() !== "n") adapters.push("linear")
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

  return `name: Mirror Docs
on:
  push:
    branches: [main]
    paths:
      - 'README.md'
      - 'docs/**'
      - '.docs-mirror.yml'

permissions:
  contents: read

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

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`)
}

main()
