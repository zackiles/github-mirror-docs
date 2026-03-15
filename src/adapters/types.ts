export class SyncConflictError extends Error {
  constructor(
    public readonly resource: string,
    public readonly reason: string,
    public readonly resolution: string,
  ) {
    super(`Conflict on '${resource}': ${reason}\n  → ${resolution}`)
    this.name = "SyncConflictError"
  }
}

export interface Page {
  slug: string
  title: string
  content: string
  parentSlug?: string
  tags: string[]
  order: number
  remoteId?: string
  sourcePath?: string
}

export interface SyncResult {
  slug: string
  action: "created" | "updated" | "skipped" | "failed"
  url?: string
  error?: string
  id?: string
}

export interface AdapterConfig {
  adapter: string
  url?: string
  collection?: string
  root_page?: string
  lock?: boolean
  banner?: boolean
  template?: string
  [key: string]: unknown
}

export interface Adapter {
  name: string
  validate(config: AdapterConfig): Promise<void>
  ensureCollection(name: string): Promise<{ id: string; url: string }>
  ensureRootPage(collection: string, title: string, content?: string): Promise<{ id: string; slug: string }>
  convertMarkdown(markdown: string, sourceUrl: string, banner: boolean): string
  sync(collection: string, pages: Page[]): Promise<SyncResult[]>
  lock(collection: string, slugs: string[]): Promise<void>
  delete?(collection: string, id: string): Promise<void>
}
