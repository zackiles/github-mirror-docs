import { load as loadEnv } from "@std/dotenv"
import { expandGlob } from "@std/fs"
import { relative } from "@std/path"
import { stringify as stringifyYaml } from "@std/yaml"
import { parse as parseFrontmatter, inject, extractTitle, slugify } from "./frontmatter.ts"
import { sync } from "./engine.ts"

const VERSION = "1.0.0"

async function main() {
  const args = Deno.args
  const command = args[0]

  try {
    await loadEnv({ export: true })
  } catch {
    // .env file is optional
  }

  switch (command) {
    case "init":
      await init()
      break
    case "sync":
      await runSync(args.slice(1))
      break
    case "uninstall":
      await uninstall()
      break
    case "--version":
    case "-v":
      console.log(`docs-mirror v${VERSION}`)
      break
    case "--help":
    case "-h":
    case undefined:
      printHelp()
      break
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      Deno.exit(1)
  }
}

async function init() {
  console.log(`\ndocs-mirror v${VERSION}\n`)

  const adapters = await promptAdapters()
  const adapterConfigs: Record<string, unknown>[] = []

  if (adapters.includes("confluence")) {
    const url = await prompt("Confluence base URL") ?? ""
    adapterConfigs.push({ adapter: "confluence", url })
  }
  if (adapters.includes("linear")) {
    adapterConfigs.push({ adapter: "linear" })
  }

  const collection = (await prompt("Default collection name (Confluence Space / Linear Project)")) ?? "Engineering Docs"

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

  const excludeInput = await prompt("\nExclude any paths from mirroring? (glob pattern, or blank)")
  const excludes = excludeInput ? [excludeInput] : []

  const filteredFiles = excludes.length > 0
    ? files.filter((f) => !excludes.some((e) => f.rel.match(globToRegex(e))))
    : files

  const confirmInput = await prompt(
    `\nAdd frontmatter to ${filteredFiles.length} files and create config? (Y/n)`,
  )
  if (confirmInput?.toLowerCase() === "n") {
    console.log("Aborted.")
    return
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

async function runSync(args: string[]) {
  const options: {
    adapter?: string
    dryRun: boolean
    verbose: boolean
    files: string[]
    configPath: string
  } = {
    dryRun: false,
    verbose: false,
    files: [],
    configPath: ".docs-mirror.yml",
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--adapter":
        options.adapter = args[++i]
        break
      case "--dry-run":
        options.dryRun = true
        break
      case "--verbose":
        options.verbose = true
        break
      case "--config":
        options.configPath = args[++i]
        break
      default:
        if (!args[i].startsWith("--")) {
          options.files.push(args[i])
        }
    }
  }

  console.log(`docs-mirror v${VERSION} — sync\n`)

  const results = await sync({
    configPath: options.configPath,
    dryRun: options.dryRun,
    verbose: options.verbose,
    adapter: options.adapter,
    files: options.files.length > 0 ? options.files : undefined,
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

async function uninstall() {
  console.log(`\ndocs-mirror — uninstall\n`)

  const removeWorkflow = (await prompt("Remove .github/workflows/docs-mirror.yml? (Y/n)"))?.toLowerCase() !== "n"
  const removeConfig = (await prompt("Remove .docs-mirror.yml? (Y/n)"))?.toLowerCase() !== "n"
  const stripFm = (await prompt("Strip docs-mirror frontmatter from markdown files? (y/N)"))?.toLowerCase() === "y"

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

function printHelp() {
  console.log(`
docs-mirror v${VERSION}

Usage:
  docs-mirror init                 Interactive setup
  docs-mirror sync [options]       Sync documentation to mirrors
  docs-mirror uninstall            Remove docs-mirror from this repo

Sync options:
  --adapter <name>    Sync to a specific adapter only
  --dry-run           Show what would happen without making changes
  --verbose           Show detailed output
  --config <path>     Path to config file (default: .docs-mirror.yml)
  <file>              Sync a specific file
`)
}

async function promptAdapters(): Promise<string[]> {
  const adapters: string[] = []
  const confInput = await prompt("Configure Confluence mirror? (Y/n)")
  if (confInput?.toLowerCase() !== "n") adapters.push("confluence")
  const linearInput = await prompt("Configure Linear mirror? (Y/n)")
  if (linearInput?.toLowerCase() !== "n") adapters.push("linear")
  if (adapters.length === 0) {
    console.log("No adapters selected. At least one is required.")
    Deno.exit(1)
  }
  return adapters
}

function prompt(message: string): Promise<string | null> {
  return new Promise((resolve) => {
    const buf = new Uint8Array(1024)
    Deno.stdout.writeSync(new TextEncoder().encode(`${message}: `))
    const n = Deno.stdin.readSync(buf)
    if (n === null) {
      resolve(null)
      return
    }
    resolve(new TextDecoder().decode(buf.subarray(0, n)).trim())
  })
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
