import { expandGlob } from "@std/fs"
import { relative, resolve } from "@std/path"
import { crypto } from "@std/crypto"
import { encodeHex } from "@std/encoding/hex"
import { load as loadConfig, type MirrorConfig } from "./config.ts"
import { parse as parseFrontmatter, type ParsedFile } from "./frontmatter.ts"
import type { Adapter, AdapterConfig, Page, SyncResult } from "./adapters/types.ts"
import { createConfluenceAdapter } from "./adapters/confluence.ts"
import { createLinearAdapter } from "./adapters/linear.ts"
import { createWebhookAdapter } from "./adapters/webhook.ts"

export interface SyncOptions {
  configPath: string
  dryRun?: boolean
  verbose?: boolean
  adapter?: string
  files?: string[]
  repoUrl?: string
}

export interface EngineResult {
  adapter: string
  results: SyncResult[]
}

export async function sync(options: SyncOptions): Promise<EngineResult[]> {
  const config = await loadConfig(options.configPath)
  const cwd = Deno.cwd()
  const repoUrl = options.repoUrl ?? detectRepoUrl()

  const files = options.files?.length
    ? await resolveExplicitFiles(options.files, cwd)
    : await discoverFiles(config.source.include, config.source.exclude, cwd)

  const parsed = await parseFiles(files, cwd)
  const publishable = parsed.filter(
    (f) => f.frontmatter.publish !== false && (config.defaults.publish || f.frontmatter.publish),
  )

  if (publishable.length === 0) {
    log("No publishable files found")
    return []
  }

  log(`Found ${publishable.length} publishable file(s)`)

  const mirrors = options.adapter
    ? config.mirrors.filter((m) => m.adapter === options.adapter)
    : config.mirrors

  const results: EngineResult[] = []

  for (const mirror of mirrors) {
    const adapterInstance = createAdapter(mirror)
    const collection = mirror.collection ?? config.collection
    const rootPage = mirror.root_page ?? repoUrl?.match(/([^/]+\/[^/]+)$/)?.[1] ?? "docs-mirror"

    log(`\nSyncing to ${adapterInstance.name} (${collection})...`)

    if (options.dryRun) {
      const dryResults = publishable.map((f) => ({
        slug: f.frontmatter.slug,
        action: "skipped" as const,
        url: `(dry-run) ${f.frontmatter.title}`,
      }))
      for (const r of dryResults) {
        log(`  [dry-run] ${r.slug}: ${r.url}`)
      }
      results.push({ adapter: adapterInstance.name, results: dryResults })
      continue
    }

    await adapterInstance.validate(mirror)
    const pages = buildPages(publishable, config, mirror, repoUrl, adapterInstance)

    await adapterInstance.ensureCollection(collection)
    await adapterInstance.ensureRootPage(collection, rootPage)

    const syncResults = await adapterInstance.sync(collection, pages)

    if (mirror.lock) {
      const created = syncResults
        .filter((r) => r.action === "created" || r.action === "updated")
        .map((r) => r.slug)
      if (created.length > 0) {
        await adapterInstance.lock(collection, created)
      }
    }

    for (const r of syncResults) {
      const icon = r.action === "created"
        ? "+"
        : r.action === "updated"
          ? "~"
          : r.action === "skipped"
            ? "-"
            : "!"
      log(`  [${icon}] ${r.slug}: ${r.action}${r.url ? ` (${r.url})` : ""}${r.error ? ` ERROR: ${r.error}` : ""}`)
    }

    results.push({ adapter: adapterInstance.name, results: syncResults })
  }

  return results
}

function createAdapter(config: AdapterConfig): Adapter {
  switch (config.adapter) {
    case "confluence":
      return createConfluenceAdapter(config)
    case "linear":
      return createLinearAdapter(config)
    case "webhook":
      return createWebhookAdapter(config)
    default:
      throw new Error(`Unknown adapter: ${config.adapter}`)
  }
}

async function discoverFiles(
  include: string[],
  exclude: string[],
  cwd: string,
): Promise<string[]> {
  const files: string[] = []
  const excluded = new Set<string>()

  for (const pattern of exclude) {
    for await (const entry of expandGlob(pattern, { root: cwd })) {
      excluded.add(entry.path)
    }
  }

  for (const pattern of include) {
    for await (const entry of expandGlob(pattern, { root: cwd })) {
      if (
        entry.isFile &&
        entry.name.endsWith(".md") &&
        !excluded.has(entry.path) &&
        !isUnderscored(relative(cwd, entry.path))
      ) {
        files.push(entry.path)
      }
    }
  }

  return [...new Set(files)].sort()
}

async function resolveExplicitFiles(paths: string[], cwd: string): Promise<string[]> {
  const resolved: string[] = []
  for (const p of paths) {
    const full = resolve(cwd, p)
    if (isUnderscored(relative(cwd, full))) {
      log(`Skipping underscored path: ${p}`)
      continue
    }
    try {
      await Deno.stat(full)
      resolved.push(full)
    } catch {
      log(`Warning: file not found: ${p}`)
    }
  }
  return resolved
}

async function parseFiles(
  files: string[],
  cwd: string,
): Promise<(ParsedFile & { path: string; relativePath: string })[]> {
  const results: (ParsedFile & { path: string; relativePath: string })[] = []
  for (const file of files) {
    const raw = await Deno.readTextFile(file)
    const parsed = parseFrontmatter(raw, file)
    const relativePath = relative(cwd, file)

    if (!parsed.frontmatter.title) {
      log(`Warning: ${relativePath} has no title, skipping`)
      continue
    }

    results.push({ ...parsed, path: file, relativePath })
  }
  return results
}

function buildPages(
  files: (ParsedFile & { path: string; relativePath: string })[],
  config: MirrorConfig,
  mirror: AdapterConfig,
  repoUrl: string,
  adapter: Adapter,
): Page[] {
  return files
    .sort((a, b) => (a.frontmatter.order ?? 999) - (b.frontmatter.order ?? 999))
    .map((file) => {
      const sourceUrl = `${repoUrl}/blob/main/${file.relativePath}`
      const content = adapter.convertMarkdown(file.content, sourceUrl, mirror.banner !== false)
      return {
        slug: file.frontmatter.slug,
        title: file.frontmatter.title,
        content,
        parentSlug: file.frontmatter.parent
          ? file.frontmatter.parent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
          : undefined,
        tags: [...(config.defaults.tags ?? []), ...file.frontmatter.tags],
        order: file.frontmatter.order ?? 999,
      }
    })
}

export async function contentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return encodeHex(new Uint8Array(hash))
}

function isUnderscored(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment.startsWith("_"))
}

function detectRepoUrl(): string {
  try {
    const cmd = new Deno.Command("git", {
      args: ["remote", "get-url", "origin"],
      stdout: "piped",
      stderr: "null",
    })
    const output = cmd.outputSync()
    const url = new TextDecoder().decode(output.stdout).trim()
    return url
      .replace(/\.git$/, "")
      .replace(/^git@github\.com:/, "https://github.com/")
  } catch {
    return "https://github.com/unknown/unknown"
  }
}

function log(msg: string): void {
  console.log(msg)
}
