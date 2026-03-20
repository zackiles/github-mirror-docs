import { expandGlob } from "@std/fs"
import { basename, dirname, relative, resolve } from "@std/path"
import { crypto } from "@std/crypto"
import { encodeHex } from "@std/encoding/hex"
import { load as loadConfig, type MirrorConfig } from "./config.ts"
import { parse as parseFrontmatter, type ParsedFile, slugify } from "./frontmatter.ts"
import type { Adapter, AdapterConfig, Page, SyncResult } from "./adapters/types.ts"
import { SyncConflictError } from "./adapters/types.ts"
import { createConfluenceAdapter } from "./adapters/confluence.ts"
import { createLinearAdapter } from "./adapters/linear.ts"
import { createWebhookAdapter } from "./adapters/webhook.ts"
import { createGitHubWikiAdapter } from "./adapters/github-wiki.ts"
import { createNotionAdapter } from "./adapters/notion.ts"
import * as state from "./state.ts"

type DiscoveredFile = ParsedFile & { path: string; relativePath: string }

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

  const tracking = await state.load(cwd)
  const currentPaths = publishable.map((f) => f.relativePath)
  const results: EngineResult[] = []

  for (const mirror of mirrors) {
    const adapterInstance = createAdapter(mirror)
    const adapterName = adapterInstance.name
    const collection = mirror.collection ?? config.collection

    const readme = publishable.find((f) => f.relativePath.toLowerCase() === "readme.md")
    const rootTitle = mirror.root_page ??
      readme?.frontmatter.title ??
      repoUrl.match(/([^/]+)(?:\.git)?$/)?.[1] ??
      "Documentation"

    log(`\nSyncing to ${adapterName} (${collection})...`)

    if (options.dryRun) {
      const dryResults = publishable.map((f) => {
        const isRoot = f === readme
        return {
          slug: f.frontmatter.slug,
          action: "skipped" as const,
          url: `(dry-run) ${f.frontmatter.title}${isRoot ? " [root page]" : ""}`,
        }
      })
      for (const r of dryResults) {
        log(`  [dry-run] ${r.slug}: ${r.url}`)
      }
      results.push({ adapter: adapterName, results: dryResults })
      continue
    }

    await adapterInstance.validate(mirror)

    const renames = state.detectRenames(tracking, adapterName, currentPaths)
    for (const rename of renames) {
      log(`  [→] detected rename: ${rename.from} → ${rename.to} (id: ${rename.entry.id})`)
      state.remove(tracking, adapterName, rename.from)
      state.update(tracking, adapterName, rename.to, rename.entry)
    }

    const staleEntries = findStaleEntries(tracking, adapterName, currentPaths, renames)
    for (const [stalePath, entry] of staleEntries) {
      if (adapterInstance.delete) {
        try {
          log(`  [✕] removing stale resource: ${stalePath} (id: ${entry.id})`)
          await adapterInstance.delete(collection, entry.id)
        } catch (err) {
          log(`  [!] failed to delete ${stalePath}: ${err instanceof Error ? err.message : err}`)
        }
      }
      state.remove(tracking, adapterName, stalePath)
    }

    const contentFiles = readme ? publishable.filter((f) => f !== readme) : publishable

    const readmeContent = readme
      ? adapterInstance.convertMarkdown(
        readme.content,
        `${repoUrl}/blob/main/${readme.relativePath}`,
        mirror.banner !== false,
      )
      : undefined

    await adapterInstance.ensureCollection(collection)
    const rootInfo = await adapterInstance.ensureRootPage(collection, rootTitle, readmeContent)

    if (readme) {
      log(`  [*] ${readme.relativePath}: root page`)
      state.update(tracking, adapterName, readme.relativePath, {
        id: rootInfo.id,
        slug: rootInfo.slug,
        hash: await contentHash(readmeContent ?? ""),
      })
    }

    const fileMap = new Map(contentFiles.map((f) => [f.relativePath, f]))
    const pages = buildPages(
      contentFiles,
      config,
      mirror,
      repoUrl,
      adapterInstance,
      tracking,
      rootInfo.slug,
      fileMap,
    )

    detectSlugCollisions(pages)

    const syncResults = await adapterInstance.sync(collection, pages)

    for (const r of syncResults) {
      if (r.id) {
        const file = contentFiles.find((f) => f.frontmatter.slug === r.slug)
        if (file) {
          state.update(tracking, adapterName, file.relativePath, {
            id: r.id,
            slug: r.slug,
            hash: await contentHash(
              pages.find((p) => p.slug === r.slug)?.content ?? "",
            ),
          })
        }
      }
    }

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
      log(
        `  [${icon}] ${r.slug}: ${r.action}${r.url ? ` (${r.url})` : ""}${
          r.error ? ` ERROR: ${r.error}` : ""
        }`,
      )
    }

    results.push({ adapter: adapterName, results: syncResults })
  }

  await state.save(cwd, tracking)

  return results
}

function isReadme(filePath: string): boolean {
  return basename(filePath).toLowerCase() === "readme.md"
}

function findReadmeIn(dir: string, files: Map<string, DiscoveredFile>): DiscoveredFile | undefined {
  for (const [path, file] of files) {
    if (isReadme(path) && normDir(dirname(path)) === normDir(dir)) return file
  }
  return undefined
}

function normDir(dir: string): string {
  if (dir === "" || dir === ".") return "."
  return dir.replace(/\/$/, "")
}

export function inferParentSlug(
  filePath: string,
  files: Map<string, DiscoveredFile>,
  rootSlug: string,
): string {
  const dir = normDir(dirname(filePath))

  if (dir === ".") return rootSlug

  if (isReadme(filePath)) {
    const parentDir = normDir(dirname(dir))
    if (parentDir === ".") return rootSlug
    const parentReadme = findReadmeIn(parentDir, files)
    if (parentReadme) return parentReadme.frontmatter.slug
    return walkUpForParent(parentDir, files, rootSlug)
  }

  const dirReadme = findReadmeIn(dir, files)
  if (dirReadme) return dirReadme.frontmatter.slug

  return walkUpForParent(dir, files, rootSlug)
}

function walkUpForParent(
  startDir: string,
  files: Map<string, DiscoveredFile>,
  rootSlug: string,
): string {
  let dir = startDir
  while (dir !== "." && dir !== "") {
    dir = normDir(dirname(dir))
    if (dir === ".") break
    const readme = findReadmeIn(dir, files)
    if (readme) return readme.frontmatter.slug
  }
  return rootSlug
}

function createAdapter(config: AdapterConfig): Adapter {
  switch (config.adapter) {
    case "confluence":
      return createConfluenceAdapter(config)
    case "linear":
      return createLinearAdapter(config)
    case "webhook":
      return createWebhookAdapter(config)
    case "github-wiki":
      return createGitHubWikiAdapter(config)
    case "notion":
      return createNotionAdapter(config)
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
      if (entry.isFile && entry.name.endsWith(".md") && !excluded.has(entry.path)) {
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
): Promise<DiscoveredFile[]> {
  const results: DiscoveredFile[] = []
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
  files: DiscoveredFile[],
  config: MirrorConfig,
  mirror: AdapterConfig,
  repoUrl: string,
  adapter: Adapter,
  tracking: state.StateData | undefined,
  rootSlug: string,
  fileMap: Map<string, DiscoveredFile>,
): Page[] {
  return files
    .sort((a, b) => (a.frontmatter.order ?? 999) - (b.frontmatter.order ?? 999))
    .map((file) => {
      const sourceUrl = `${repoUrl}/blob/main/${file.relativePath}`
      const content = adapter.convertMarkdown(file.content, sourceUrl, mirror.banner !== false)
      const tracked = tracking ? state.lookup(tracking, adapter.name, file.relativePath) : undefined

      let parentSlug: string | undefined
      if (file.frontmatter.parent === false) {
        parentSlug = undefined
      } else if (typeof file.frontmatter.parent === "string") {
        parentSlug = slugify(file.frontmatter.parent)
      } else {
        parentSlug = inferParentSlug(file.relativePath, fileMap, rootSlug)
      }

      return {
        slug: file.frontmatter.slug,
        title: file.frontmatter.title,
        content,
        parentSlug,
        tags: [...(config.defaults.tags ?? []), ...file.frontmatter.tags],
        order: file.frontmatter.order ?? 999,
        remoteId: tracked?.id,
        sourcePath: file.relativePath,
      }
    })
}

export function detectSlugCollisions(pages: Page[]): void {
  const seen = new Map<string, string>()
  for (const page of pages) {
    const existing = seen.get(page.slug)
    if (existing) {
      throw new SyncConflictError(
        page.slug,
        `Duplicate slug '${page.slug}' produced by '${existing}' and '${page.sourcePath}'.`,
        `Add an explicit 'slug' in frontmatter to one of the conflicting files to make them unique.`,
      )
    }
    seen.set(page.slug, page.sourcePath ?? page.title)
  }
}

function findStaleEntries(
  tracking: state.StateData,
  adapter: string,
  currentPaths: string[],
  renames: state.Rename[],
): [string, state.ResourceEntry][] {
  const tracked = tracking.resources[adapter]
  if (!tracked) return []

  const currentSet = new Set(currentPaths)
  const renamedFrom = new Set(renames.map((r) => r.from))

  return Object.entries(tracked).filter(
    ([path]) => !currentSet.has(path) && !renamedFrom.has(path),
  )
}

export async function contentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return encodeHex(new Uint8Array(hash))
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
