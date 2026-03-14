import { extract } from "@std/front-matter/yaml"
import { stringify as stringifyYaml } from "@std/yaml"
import { basename } from "@std/path"

function hasFrontmatter(text: string): boolean {
  return /^---\s*\n/.test(text)
}

export interface Frontmatter {
  title: string
  publish: boolean
  collection?: string
  parent?: string
  tags: string[]
  order?: number
  slug: string
}

export interface ParsedFile {
  frontmatter: Frontmatter
  content: string
  raw: string
}

export function parse(raw: string, filePath: string): ParsedFile {
  if (hasFrontmatter(raw)) {
    const { attrs, body } = extract<Record<string, unknown>>(raw)
    const fm = resolve(attrs, body, filePath)
    return { frontmatter: fm, content: body, raw }
  }
  const fm = resolve({}, raw, filePath)
  return { frontmatter: fm, content: raw, raw }
}

export function resolve(
  attrs: Record<string, unknown>,
  body: string,
  filePath: string,
): Frontmatter {
  const title = (attrs.title as string) || extractTitle(body) || titleFromPath(filePath)
  return {
    title,
    publish: attrs.publish !== false,
    collection: attrs.collection as string | undefined,
    parent: attrs.parent as string | undefined,
    tags: Array.isArray(attrs.tags) ? attrs.tags.filter((t): t is string => typeof t === "string") : [],
    order: typeof attrs.order === "number" ? attrs.order : undefined,
    slug: (attrs.slug as string) || slugify(title),
  }
}

export function inject(raw: string, fields: Partial<Frontmatter>, filePath: string): string {
  if (hasFrontmatter(raw)) {
    return merge(raw, fields)
  }
  const resolved = resolve(fields as Record<string, unknown>, raw, filePath)
  const merged = { ...resolved, ...fields }
  const yaml = stringifyYaml(stripUndefined(merged)).trimEnd()
  return `---\n${yaml}\n---\n\n${raw}`
}

function merge(raw: string, fields: Partial<Frontmatter>): string {
  const { attrs, body } = extract<Record<string, unknown>>(raw)
  const merged: Record<string, unknown> = { ...attrs }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && !(key in merged)) {
      merged[key] = value
    }
  }
  const yaml = stringifyYaml(stripUndefined(merged)).trimEnd()
  return `---\n${yaml}\n---\n\n${body}`
}

export function extractTitle(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function titleFromPath(filePath: string): string {
  const name = basename(filePath).replace(/\.md$/i, "")
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value
  }
  return result
}
