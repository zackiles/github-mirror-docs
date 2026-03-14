export interface Page {
  slug: string
  title: string
  content: string
  parentSlug?: string
  tags: string[]
  order: number
}

export interface SyncResult {
  slug: string
  action: "created" | "updated" | "skipped" | "failed"
  url?: string
  error?: string
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
  ensureRootPage(collection: string, title: string): Promise<{ id: string; slug: string }>
  convertMarkdown(markdown: string, sourceUrl: string, banner: boolean): string
  sync(collection: string, pages: Page[]): Promise<SyncResult[]>
  lock(collection: string, slugs: string[]): Promise<void>
}
