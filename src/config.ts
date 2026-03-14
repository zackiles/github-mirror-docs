import { parse as parseYaml } from "@std/yaml"
import type { AdapterConfig } from "./adapters/types.ts"

export interface SourceConfig {
  include: string[]
  exclude: string[]
}

export interface DefaultsConfig {
  publish: boolean
  tags: string[]
}

export interface MirrorConfig {
  collection: string
  source: SourceConfig
  defaults: DefaultsConfig
  mirrors: AdapterConfig[]
}

const VALID_ADAPTERS = new Set(["confluence", "linear", "webhook"])

export async function load(path: string): Promise<MirrorConfig> {
  const text = await Deno.readTextFile(path)
  const raw = parseYaml(text) as Record<string, unknown>
  return validate(raw)
}

export function validate(raw: Record<string, unknown>): MirrorConfig {
  if (!raw.collection || typeof raw.collection !== "string") {
    throw new Error("Config: 'collection' is required and must be a string")
  }

  const source = resolveSource(raw.source as Record<string, unknown> | undefined)
  const defaults = resolveDefaults(raw.defaults as Record<string, unknown> | undefined)
  const mirrors = resolveMirrors(raw.mirrors as unknown[] | undefined)

  return { collection: raw.collection, source, defaults, mirrors }
}

function resolveSource(raw?: Record<string, unknown>): SourceConfig {
  return {
    include: asStringArray(raw?.include) ?? ["README.md", "docs/**/*.md"],
    exclude: asStringArray(raw?.exclude) ?? [],
  }
}

function resolveDefaults(raw?: Record<string, unknown>): DefaultsConfig {
  return {
    publish: raw?.publish !== false,
    tags: asStringArray(raw?.tags) ?? [],
  }
}

function resolveMirrors(raw?: unknown[]): AdapterConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Config: 'mirrors' must be a non-empty array")
  }

  return raw.map((entry, i) => {
    const m = entry as Record<string, unknown>
    if (!m.adapter || typeof m.adapter !== "string") {
      throw new Error(`Config: mirrors[${i}].adapter is required`)
    }
    if (!VALID_ADAPTERS.has(m.adapter)) {
      throw new Error(
        `Config: mirrors[${i}].adapter '${m.adapter}' is not valid. Use: ${[...VALID_ADAPTERS].join(", ")}`,
      )
    }
    if (m.adapter === "confluence" && !m.url) {
      throw new Error(`Config: mirrors[${i}] (confluence) requires 'url'`)
    }
    if (m.adapter === "webhook" && !m.template) {
      throw new Error(`Config: mirrors[${i}] (webhook) requires 'template'`)
    }
    return {
      adapter: m.adapter,
      url: m.url as string | undefined,
      collection: m.collection as string | undefined,
      root_page: m.root_page as string | undefined,
      lock: m.lock !== false,
      banner: m.banner !== false,
      template: m.template as string | undefined,
    }
  })
}

function asStringArray(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined
  return val.filter((v): v is string => typeof v === "string")
}
