import { expandGlob } from "@std/fs"
import { basename, relative, resolve } from "@std/path"
import { type Frontmatter, inject, parse as parseFrontmatter, slugify } from "./frontmatter.ts"

type Tool = "claude" | "cursor"

interface FileEntry {
  path: string
  relativePath: string
  raw: string
  hasFrontmatter: boolean
  frontmatter: Frontmatter
  content: string
  needsStaging: boolean
}

interface AgentFileResult {
  path: string
  frontmatter: {
    title: string
    slug: string
    publish: boolean
    tags?: string[]
    order?: number
    collection?: string
  }
  fixHeading?: boolean
}

interface AgentResult {
  files: AgentFileResult[]
}

export interface StageOptions {
  basePath: string
  configPath: string
  interactive: boolean
  verbose: boolean
  dryRun: boolean
  agent?: string
  key?: string
}

export interface StageResult {
  path: string
  relativePath: string
  action: "injected" | "merged" | "skipped" | "unchanged"
  frontmatter?: Partial<Frontmatter>
}

export async function stage(options: StageOptions): Promise<StageResult[]> {
  const base = resolve(options.basePath)
  const all = await scanFiles(base)
  const targets = all.filter((e) => e.needsStaging)

  if (targets.length === 0) {
    console.log("All files have valid frontmatter. Nothing to stage.")
    return []
  }

  console.log(`Found ${targets.length} file(s) needing frontmatter:`)
  for (const t of targets) {
    console.log(`  ${t.relativePath} (${t.hasFrontmatter ? "incomplete" : "missing"})`)
  }

  if (options.agent) {
    return await runAgent(options, base, all, targets)
  }
  return await runNormal(options, base, all, targets)
}

export async function scanFiles(base: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  const seen = new Set<string>()

  for (const pattern of ["README.md", "docs/**/*.md"]) {
    for await (const entry of expandGlob(pattern, { root: base })) {
      if (!entry.isFile || seen.has(entry.path)) continue
      seen.add(entry.path)
      const rel = relative(base, entry.path)
      const raw = await Deno.readTextFile(entry.path)
      const hasFm = raw.startsWith("---")
      const parsed = parseFrontmatter(raw, entry.path)
      const complete = hasFm && hasCoreFields(raw)

      entries.push({
        path: entry.path,
        relativePath: rel,
        raw,
        hasFrontmatter: hasFm,
        frontmatter: parsed.frontmatter,
        content: parsed.content,
        needsStaging: !complete,
      })
    }
  }
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export function hasCoreFields(raw: string): boolean {
  const end = raw.indexOf("---", 3)
  if (end === -1) return false
  const block = raw.slice(3, end)
  return block.includes("title:") && block.includes("slug:")
}

async function runNormal(
  options: StageOptions,
  base: string,
  _all: FileEntry[],
  targets: FileEntry[],
): Promise<StageResult[]> {
  let collection: string | undefined
  try {
    const text = await Deno.readTextFile(resolve(base, options.configPath))
    const match = text.match(/collection:\s*(.+)/)
    if (match) collection = match[1].trim().replace(/^["']|["']$/g, "")
  } catch { /* config file not required */ }

  const results: StageResult[] = []

  for (const entry of targets) {
    const fields: Partial<Frontmatter> = {
      title: entry.frontmatter.title,
      slug: slugify(entry.frontmatter.title),
      publish: true,
    }
    if (collection) fields.collection = collection

    if (options.dryRun) {
      console.log(
        `  [dry-run] ${entry.relativePath}: title="${fields.title}" slug="${fields.slug}"`,
      )
      results.push({
        path: entry.path,
        relativePath: entry.relativePath,
        action: "skipped",
        frontmatter: fields,
      })
      continue
    }

    let raw = entry.raw
    if (!hasH1(entry.content)) {
      raw = fixHeading(raw, entry.frontmatter.title)
    }

    const updated = inject(raw, fields, entry.path)
    if (updated !== entry.raw) {
      await Deno.writeTextFile(entry.path, updated)
      results.push({
        path: entry.path,
        relativePath: entry.relativePath,
        action: entry.hasFrontmatter ? "merged" : "injected",
        frontmatter: fields,
      })
    } else {
      results.push({ path: entry.path, relativePath: entry.relativePath, action: "unchanged" })
    }
  }
  return results
}

export function hasH1(body: string): boolean {
  return /^#\s+/m.test(body)
}

export function fixHeading(raw: string, title: string): string {
  if (raw.startsWith("---")) {
    const end = raw.indexOf("---", 3)
    if (end !== -1) {
      return raw.slice(0, end + 3) + fixBody(raw.slice(end + 3), title)
    }
  }
  return fixBody(raw, title)
}

export function fixBody(body: string, title: string): string {
  if (/^#\s+/m.test(body)) return body

  const sub = body.match(/^(#{2,6})\s+(.+)$/m)
  if (sub) return body.replace(sub[0], `# ${sub[2]}`)

  const trimmed = body.replace(/^\n+/, "")
  return `\n# ${title}\n\n${trimmed}`
}

function detectTool(agentPath: string): Tool {
  const name = basename(agentPath).toLowerCase().replace(/\.exe$/, "")
  if (name.includes("claude")) return "claude"
  if (name.includes("cursor") || name === "agent") return "cursor"

  try {
    const cmd = new Deno.Command(agentPath, {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    })
    const out = cmd.outputSync()
    const combined = new TextDecoder().decode(out.stdout).toLowerCase() +
      new TextDecoder().decode(out.stderr).toLowerCase()
    if (combined.includes("claude")) return "claude"
    if (combined.includes("cursor") || combined.includes("agent")) return "cursor"
  } catch { /* fall through */ }

  throw new Error(
    `Cannot detect tool type for "${agentPath}". Expected a Claude CLI or Cursor CLI executable.`,
  )
}

function validateTool(
  agentPath: string,
  key: string | undefined,
): { tool: Tool; resolvedKey: string } {
  const tool = detectTool(agentPath)
  const envName = tool === "claude" ? "ANTHROPIC_API_KEY" : "CURSOR_API_KEY"
  const resolvedKey = key ?? Deno.env.get(envName)

  if (!resolvedKey) {
    throw new Error(`No API key provided. Pass --key <value> or set ${envName}.`)
  }

  try {
    const cmd = new Deno.Command(agentPath, {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    })
    const out = cmd.outputSync()
    if (!out.success) {
      const stderr = new TextDecoder().decode(out.stderr).trim()
      throw new Error(`"${agentPath}" returned an error: ${stderr || "(no output)"}`)
    }
    console.log(`✔ ${tool} CLI: ${new TextDecoder().decode(out.stdout).trim()}`)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error(`Executable not found: "${agentPath}". Ensure it exists or is on PATH.`)
    }
    throw err
  }

  return { tool, resolvedKey }
}

async function runAgent(
  options: StageOptions,
  base: string,
  all: FileEntry[],
  targets: FileEntry[],
): Promise<StageResult[]> {
  const rawAgent = options.agent!
  const resolved = resolve(Deno.cwd(), rawAgent)
  const execPath = await pathExists(resolved) ? resolved : rawAgent

  const { tool, resolvedKey } = validateTool(execPath, options.key)

  const readme = all.find((e) => e.relativePath.toLowerCase() === "readme.md")
  const configFull = resolve(base, options.configPath)
  const configExists = await pathExists(configFull)

  const prompt = compilePrompt(
    base,
    targets,
    all.filter((e) => !e.needsStaging && e.hasFrontmatter),
    readme?.relativePath,
    configExists ? options.configPath : undefined,
  )

  if (options.verbose) console.log(`Prompt length: ${prompt.length} chars`)

  const result = await executeAgent(tool, execPath, resolvedKey, prompt, base)
  console.log(`Agent returned results for ${result.files.length} file(s)`)

  return await applyAgentResults(options, targets, result)
}

export function compilePrompt(
  base: string,
  targets: FileEntry[],
  examples: FileEntry[],
  readmePath: string | undefined,
  configPath: string | undefined,
): string {
  const fileList = targets.map((e) => `- ${e.relativePath}`).join("\n")

  const exampleBlock = examples.slice(0, 5).map((e) => {
    const end = e.raw.indexOf("---", 3)
    const fm = end !== -1 ? e.raw.slice(0, end + 3) : ""
    return `File: ${e.relativePath}\n${fm}`
  }).join("\n\n")

  return PROMPT_TEMPLATE
    .replaceAll("{{BASE_PATH}}", base)
    .replaceAll("{{README_PATH}}", readmePath ?? "(none)")
    .replaceAll("{{CONFIG_PATH}}", configPath ?? "(none)")
    .replaceAll("{{FILE_LIST}}", fileList)
    .replaceAll("{{FILE_COUNT}}", String(targets.length))
    .replaceAll("{{EXAMPLES}}", exampleBlock || "(no existing examples)")
}

async function executeAgent(
  tool: Tool,
  execPath: string,
  key: string,
  prompt: string,
  cwd: string,
): Promise<AgentResult> {
  const envKey = tool === "claude" ? "ANTHROPIC_API_KEY" : "CURSOR_API_KEY"
  const env = { ...Deno.env.toObject(), [envKey]: key }

  const MAX_ARG = 20_000

  if (prompt.length <= MAX_ARG) {
    return await execDirect(tool, execPath, env, prompt, cwd)
  }
  return await execViaStdin(tool, execPath, env, prompt, cwd)
}

async function execDirect(
  tool: Tool,
  execPath: string,
  env: Record<string, string>,
  prompt: string,
  cwd: string,
): Promise<AgentResult> {
  const args = buildArgs(tool, prompt)
  console.log(`Running ${tool} agent...`)

  const cmd = new Deno.Command(execPath, {
    args,
    cwd,
    env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  })

  const output = await cmd.output()
  const stdout = new TextDecoder().decode(output.stdout)
  const stderr = new TextDecoder().decode(output.stderr)

  if (!output.success) {
    throw new Error(`${tool} agent failed:\n${stderr || stdout}`)
  }

  return parseOutput(stdout)
}

async function execViaStdin(
  tool: Tool,
  execPath: string,
  env: Record<string, string>,
  prompt: string,
  cwd: string,
): Promise<AgentResult> {
  const tmpFile = await Deno.makeTempFile({ prefix: "docs-mirror-stage-", suffix: ".md" })
  await Deno.writeTextFile(tmpFile, prompt)

  try {
    const args = buildArgs(
      tool,
      "Follow the detailed instructions from stdin. Return only valid JSON.",
    )
    console.log(`Running ${tool} agent (prompt via stdin)...`)

    const cmd = new Deno.Command(execPath, {
      args,
      cwd,
      env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    })

    const proc = cmd.spawn()
    const writer = proc.stdin.getWriter()
    await writer.write(new TextEncoder().encode(prompt))
    await writer.close()
    const output = await proc.output()

    const stdout = new TextDecoder().decode(output.stdout)
    const stderr = new TextDecoder().decode(output.stderr)

    if (!output.success) {
      throw new Error(`${tool} agent failed:\n${stderr || stdout}`)
    }

    return parseOutput(stdout)
  } finally {
    try {
      await Deno.remove(tmpFile)
    } catch { /* cleanup failure is fine */ }
  }
}

function buildArgs(tool: Tool, prompt: string): string[] {
  if (tool === "claude") {
    return [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--max-turns",
      "50",
      "--allowedTools",
      "Read",
      "Bash(ls *)",
    ]
  }
  return ["-p", prompt, "--output-format", "json"]
}

export function parseOutput(stdout: string): AgentResult {
  try {
    const outer = JSON.parse(stdout)

    const content: string = typeof outer.result === "string"
      ? outer.result
      : typeof outer.message === "string"
      ? outer.message
      : JSON.stringify(outer)

    const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    const raw = fenced ? fenced[1] : content

    try {
      const parsed = JSON.parse(raw)
      if (parsed.files && Array.isArray(parsed.files)) return parsed
    } catch { /* try deeper extraction */ }

    return extractJson(content)
  } catch {
    return extractJson(stdout)
  }
}

function extractJson(text: string): AgentResult {
  const idx = text.indexOf('{"files"')
  if (idx === -1) {
    throw new Error(
      `Agent output does not contain the expected JSON structure.\nFirst 500 chars:\n${
        text.slice(0, 500)
      }`,
    )
  }

  let depth = 0
  for (let i = idx; i < text.length; i++) {
    if (text[i] === "{") depth++
    else if (text[i] === "}") {
      depth--
      if (depth === 0) {
        const parsed = JSON.parse(text.slice(idx, i + 1))
        if (parsed.files && Array.isArray(parsed.files)) return parsed
        break
      }
    }
  }

  throw new Error(`Failed to parse agent JSON output.\nFirst 500 chars:\n${text.slice(0, 500)}`)
}

async function applyAgentResults(
  options: StageOptions,
  targets: FileEntry[],
  result: AgentResult,
): Promise<StageResult[]> {
  const results: StageResult[] = []
  const lookup = new Map(targets.map((e) => [e.relativePath, e]))

  for (const fr of result.files) {
    const entry = lookup.get(fr.path)
    if (!entry) {
      if (options.verbose) console.log(`  ⚠ Unknown file from agent: ${fr.path}`)
      continue
    }

    const fields: Partial<Frontmatter> = {
      title: fr.frontmatter.title,
      slug: fr.frontmatter.slug || slugify(fr.frontmatter.title),
      publish: fr.frontmatter.publish ?? true,
      tags: fr.frontmatter.tags ?? [],
    }
    if (fr.frontmatter.order !== undefined) fields.order = fr.frontmatter.order
    if (fr.frontmatter.collection) fields.collection = fr.frontmatter.collection

    if (options.dryRun) {
      console.log(`  [dry-run] ${entry.relativePath}: title="${fields.title}"`)
      results.push({
        path: entry.path,
        relativePath: entry.relativePath,
        action: "skipped",
        frontmatter: fields,
      })
      continue
    }

    let raw = entry.raw
    if (fr.fixHeading && !hasH1(entry.content)) {
      raw = fixHeading(raw, fields.title ?? entry.frontmatter.title)
    }

    const updated = inject(raw, fields, entry.path)
    if (updated !== entry.raw) {
      await Deno.writeTextFile(entry.path, updated)
      results.push({
        path: entry.path,
        relativePath: entry.relativePath,
        action: entry.hasFrontmatter ? "merged" : "injected",
        frontmatter: fields,
      })
    } else {
      results.push({ path: entry.path, relativePath: entry.relativePath, action: "unchanged" })
    }

    lookup.delete(fr.path)
  }

  for (const [, entry] of lookup) {
    results.push({ path: entry.path, relativePath: entry.relativePath, action: "skipped" })
  }

  return results
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await Deno.stat(p)
    return true
  } catch {
    return false
  }
}

const PROMPT_TEMPLATE =
  `You are a documentation frontmatter specialist. Analyze markdown files and determine ideal YAML frontmatter values for each.

PROJECT ROOT: {{BASE_PATH}}
ROOT README: {{README_PATH}}
CONFIG FILE: {{CONFIG_PATH}}

FILES NEEDING FRONTMATTER ({{FILE_COUNT}}):
{{FILE_LIST}}

EXISTING FRONTMATTER EXAMPLES (for convention reference):

{{EXAMPLES}}

FRONTMATTER SCHEMA:
- title (string): Page title
- slug (string): URL-safe identifier from title (lowercase, hyphens, no leading/trailing hyphens)
- publish (boolean): Whether to sync this page (default true)
- tags (string[]): Categorization tags
- order (number): Sort order among siblings (lower = first)
- collection (string): Group name override

STRATEGY — determine values using this progressive fallback:

Title:
1. Explicit title stated in the file content
2. H1 heading text
3. First sub-heading (H2-H6) promoted as title concept
4. Naming convention from peer files in the same directory
5. Naming convention from parent directory files
6. Title-cased filename (strip .md, replace hyphens/underscores with spaces)

Slug: always derived from title — lowercase, replace non-alphanumeric with hyphens, trim edges.

Tags: match conventions from peer files in same directory, then parent directory, then infer from content topic. Leave empty if no clear tags apply.

Order: follow ordering patterns from peer files, or infer logical reading order, or omit.

Collection: match the config file default if present, match peer file convention, or omit.

Publish: default true unless the file is clearly a draft, template, or internal-only note.

HEADING CHECK:
Set fixHeading to true if the file:
- Has no H1 heading at all
- Uses an H2, H3, H4, H5, or H6 where an H1 should be (first heading in the document)

RULES:
- Read each listed file to analyze its content before deciding
- Follow conventions established by existing files in the same directory
- If no sibling examples exist, look at the nearest parent directory for conventions
- Ensure all slugs are unique across the project
- Every input file MUST appear in the output array

OUTPUT FORMAT — return ONLY this JSON, no markdown code fences, no explanation text:
{"files":[{"path":"<relative path>","frontmatter":{"title":"...","slug":"...","publish":true,"tags":[],"order":999},"fixHeading":false}]}
`
