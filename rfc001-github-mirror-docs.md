# RFC: Github Mirror Docs — Open-Source Repository Documentation Mirroring

**Author:** Platform Engineering  
**Date:** March 14, 2026  
**Status:** Proposed  
**Repository:** `zackiles/github-mirror-docs` (GitHub, public)

---

## 1. Summary

`github-mirror-docs` is an open-source project that gives any engineering team — from a solo developer to a large organization — a turnkey way to keep documentation in their GitHub repository as the source of truth while automatically mirroring that content to wherever non-technical stakeholders (or anyone not on GitHub) consume documentation.

The project ships as a **CLI** (for setup and local use) and a **GitHub Action** (for continuous delivery). It uses an **adapter architecture** so the same markdown files can mirror to multiple destinations simultaneously. Built-in adapters target **Confluence Cloud** and **Linear Docs**. A **generic webhook adapter template** ships alongside them, letting users point at any CMS with an HTTP API by filling out a commented YAML file — no code required.

The core design principle: a new user who finds this project on GitHub should understand what it does, install it, and run their first sync in under ten minutes — with no infrastructure to provision and no files left behind that they did not ask for.

---

## 2. Motivation

Engineering teams increasingly adopt docs-as-code — markdown files in the repository, reviewed via pull requests, validated in CI. This is the correct model for technical documentation. But organizations do not live on GitHub alone. Product managers, designers, customer-facing teams, and executives read documentation in Confluence, Linear, Notion, or whatever the company's primary knowledge hub is.

Today the choice is binary: either documentation lives in the repo and non-technical stakeholders are cut off, or it lives in a wiki and engineers lose version control, code co-location, and CI enforcement. `docs-mirror` eliminates this tradeoff. Write once in the repo, mirror everywhere else.

This RFC proposes the implementation design for the `docs-mirror` open-source project.

---

## 3. Goals and Non-Goals

**Goals:**

- Any engineering team can adopt `docs-mirror` in under ten minutes regardless of team size
- Adapter architecture that is fully abstracted from any single downstream mirror
- Confluence Cloud and Linear Docs supported as first-class adapters at launch
- Mirror destinations are treated as read-only projections of the repository source
- One config file, one workflow file, zero other artifacts added to the user's repository
- Clean install and uninstall via `npx` with no persistent scripts left behind
- Optional infrastructure-as-code modules for teams that manage repos at scale

**Non-Goals:**

- Bidirectional sync (mirrors are one-way: repo → destination)
- Replacing the destination platform's native authoring for content that is not engineering documentation
- Building a documentation site generator (tools like MkDocs and Docusaurus already exist)
- Implementing a Notion or SharePoint adapter in this RFC (the webhook template covers arbitrary platforms without dedicated adapters)

---

## 4. Project Repository Design

### 4.1 Repository Layout

```
docs-mirror/
├── README.md                        ← Project landing page (the "sell")
├── LICENSE                          ← MIT
├── action.yml                       ← GitHub Action definition (composite)
├── deno.json                        ← Deno 2 workspace config
├── src/
│   ├── cli.ts                       ← CLI entry point (init, sync, uninstall)
│   ├── config.ts                    ← Config loading and validation
│   ├── frontmatter.ts               ← Frontmatter parsing and injection
│   ├── markdown.ts                  ← Markdown-to-target format conversion
│   ├── engine.ts                    ← Core sync orchestrator
│   └── adapters/
│       ├── types.ts                 ← Adapter interface definition
│       ├── confluence.ts            ← Confluence Cloud adapter
│       ├── linear.ts               ← Linear Docs adapter
│       └── webhook.ts              ← Generic webhook adapter
├── templates/
│   └── webhook.yml                  ← Commented webhook adapter template (inactive by default)
├── docs/
│   ├── getting-started.md           ← Quick start guide
│   ├── configuration.md            ← Full config reference
│   ├── frontmatter.md              ← Frontmatter schema reference
│   ├── adapters/
│   │   ├── confluence.md            ← Confluence-specific setup guide
│   │   ├── linear.md               ← Linear-specific setup guide
│   │   └── webhook.md              ← Generic webhook / custom CMS guide
│   └── advanced/
│       ├── pulumi.md               ← Pulumi module usage guide
│       └── terraform.md            ← Terraform module usage guide
├── deploy/
│   ├── pulumi/                     ← Pulumi TypeScript module
│   │   ├── index.ts
│   │   ├── Pulumi.yaml
│   │   └── README.md
│   └── terraform/                  ← Terraform HCL module
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── README.md
└── tests/
    ├── engine_test.ts
    ├── frontmatter_test.ts
    ├── adapters/
    │   ├── confluence_test.ts
    │   └── linear_test.ts
    └── fixtures/
```

### 4.2 Distribution

| Channel | Artifact | Usage |
|---|---|---|
| **GitHub Action** | `docs-mirror/docs-mirror@v1` | Primary: continuous sync on push to `main` |
| **npm** | `docs-mirror` | CLI: `npx docs-mirror init`, `npx docs-mirror sync` |
| **JSR** | `@docs-mirror/docs-mirror` | Native Deno import for programmatic use |
| **GitHub Releases** | Compiled binaries per platform | Offline or CI environments without npm/Deno |

The GitHub Action is the primary distribution channel. The npm package exists for CLI commands (`init`, `sync`, `uninstall`) that run locally or in arbitrary CI systems. JSR is for Deno-native consumers who want to import the engine programmatically.

### 4.3 Versioning and Releases

The project follows **semantic versioning** (`MAJOR.MINOR.PATCH`).

- **GitHub Action tags** follow the `v{MAJOR}` convention (e.g., `@v1`) with floating major version tags updated on each compatible release, matching the pattern established by `actions/checkout` and similar first-party actions.
- **npm and JSR** publish the full semver on each release.
- **GitHub Releases** are created automatically via a release workflow triggered by a version tag push (`v*`). Each release includes compiled binaries for `linux-x64`, `darwin-x64`, `darwin-arm64`, and `windows-x64` using `deno compile`.
- **Changelog** is auto-generated from conventional commits using GitHub's release notes generation.

Users referencing `@v1` in their workflow get non-breaking improvements automatically. Adapter interface changes that would break community adapters require a major version bump.

### 4.4 Implementation Language

**Deno 2** (TypeScript). Rationale:

- First-class TypeScript without a build step
- Built-in test runner, formatter, linter
- `deno compile` produces standalone binaries for every platform (enables npm binary distribution)
- Native `fetch` for HTTP API calls to adapter endpoints
- YAML and frontmatter parsing available via standard library and established Deno modules

---

## 5. User Experience

### 5.1 Installation

Installation is a single `npx` command. Nothing persists in the repository except the files the user explicitly approves.

```
$ npx docs-mirror init

docs-mirror v1.0.0

? Which mirrors would you like to configure?
  ✔ Confluence
  ✔ Linear

? Confluence base URL: https://acme.atlassian.net
? Default collection name (used as the Confluence Space and Linear Project): Engineering Docs

Scanning for markdown files...

Found 5 files:
  README.md             → title: "Acme Service" (from H1)
  docs/setup.md         → title: "Setup Guide" (from H1)
  docs/api-reference.md → title: "API Reference" (from H1)
  docs/faq.md           → title: "FAQ" (from filename)
  docs/internal/notes.md → title: "Internal Notes" (from H1)

? Exclude any paths from mirroring? docs/internal/**

? Add frontmatter to 4 files and create config? (Y/n) Y

✔ Added frontmatter to 4 files (1 already had frontmatter, merged)
✔ Created .docs-mirror.yml
✔ Created .github/workflows/docs-mirror.yml
✔ Verified .env is in .gitignore

Next steps:

  1. Add secrets to your GitHub repository (Settings → Secrets → Actions):

     CONFLUENCE_EMAIL    your-email@company.com
     CONFLUENCE_TOKEN    create at https://id.atlassian.com/manage-profile/security/api-tokens
     LINEAR_API_KEY      create at Linear → Settings → API → Personal API keys

  2. Review and commit the changes
  3. Push to main to trigger your first sync

  Docs: https://github.com/docs-mirror/docs-mirror/blob/main/docs/getting-started.md
```

**What `init` does:**

1. Prompts for mirror selection and per-adapter config (URLs, default collection name)
2. Scans `README.md` and `docs/**/*.md` (configurable) for existing markdown files
3. For each discovered file, extracts the first `# H1` heading as the default `title`, falling back to the filename (without extension, title-cased)
4. For files that already have frontmatter, merges in missing fields without overwriting existing values
5. Writes `.docs-mirror.yml` with the selected adapters and defaults
6. Writes `.github/workflows/docs-mirror.yml` (a minimal workflow referencing the published Action)
7. Ensures `.env` is listed in `.gitignore` (for local credential files)
8. Prints credential setup instructions specific to the selected adapters

**What `init` does NOT do:**

- Install any dependencies in the repository
- Create any scripts (no `sync-docs.sh`, no `uninstall.sh`)
- Modify `package.json` or any dependency manifest
- Touch files outside of markdown files, `.docs-mirror.yml`, and `.github/workflows/`

### 5.2 Configuration

A single file `.docs-mirror.yml` in the repository root. This is the only configuration artifact `docs-mirror` adds (besides the workflow file in `.github/`).

**Minimal config (one adapter):**

```yaml
collection: Engineering Docs

mirrors:
  - adapter: confluence
    url: https://acme.atlassian.net
```

**Full config (both adapters, all options):**

```yaml
collection: Engineering Docs

source:
  include:
    - README.md
    - docs/**/*.md
  exclude:
    - docs/internal/**
    - docs/drafts/**

defaults:
  publish: true
  tags: []

mirrors:
  - adapter: confluence
    url: https://acme.atlassian.net
    collection: Eng Docs              # overrides top-level collection for this adapter
    root_page: acme/my-service        # top-level page name (default: {org}/{repo})
    lock: true                        # restrict editing on mirrored pages (default: true)
    banner: true                      # prepend source-link banner (default: true)

  - adapter: linear
    collection: Engineering           # overrides top-level collection for this adapter
    lock: false                       # Linear does not support edit restrictions
    banner: true                      # prepend source-link banner (default: true)
```

**Field reference:**

| Field | Required | Default | Description |
|---|---|---|---|
| `collection` | Yes | — | Default name for the top-level grouping in each mirror (Confluence Space, Linear Project). Per-adapter `collection` overrides this. |
| `source.include` | No | `["README.md", "docs/**/*.md"]` | Glob patterns for files to consider for sync. |
| `source.exclude` | No | `[]` | Glob patterns to exclude from sync. |
| `defaults.publish` | No | `true` | Default `publish` value for files without frontmatter `publish` field. |
| `defaults.tags` | No | `[]` | Default tags applied to all mirrored pages. |
| `mirrors` | Yes | — | Array of adapter configurations. At least one required. |
| `mirrors[].adapter` | Yes | — | Adapter name: `confluence` or `linear`. |
| `mirrors[].url` | Varies | — | Base URL for the adapter's API. Required for `confluence`. Not used by `linear`. |
| `mirrors[].collection` | No | Top-level `collection` | Adapter-specific override for the collection name. |
| `mirrors[].root_page` | No | `{org}/{repo}` | Name of the top-level page under which all mirrored pages are nested. |
| `mirrors[].lock` | No | `true` | Whether to restrict editing on the mirror side (adapter-dependent). |
| `mirrors[].banner` | No | `true` | Whether to prepend a "mirrored from GitHub" banner to each page. |

### 5.3 Frontmatter Schema

Every markdown file included in the sync must have YAML frontmatter. The `init` command adds this automatically. All field names are adapter-independent.

```yaml
---
title: "Setup Guide"
publish: true
collection: "Engineering Docs"
parent: "Getting Started"
tags: ["onboarding", "setup"]
order: 1
slug: "setup-guide"
---
```

**Field reference:**

| Field | Required | Default | Description |
|---|---|---|---|
| `title` | Yes | Auto-generated from H1 or filename | Display name of the page in the mirror destination. |
| `publish` | No | `true` (or `defaults.publish` from config) | Set `false` to exclude this file from mirroring. The file stays in the repo but is not synced. |
| `collection` | No | Config-level `collection` | Override the collection for this specific file. Maps to Confluence Space or Linear Project. |
| `parent` | No | Root page | Title or path of the parent page. Enables nesting (e.g., `parent: "API"` nests under the API page). |
| `tags` | No | `[]` | Labels applied to the mirrored page. Confluence: page labels. Linear: not currently supported (stored as metadata). |
| `order` | No | Alphabetical | Numeric sort position among sibling pages. Lower numbers appear first. |
| `slug` | No | Auto-generated from `title` | URL-friendly identifier. Used to match existing pages and prevent duplicates across syncs. |

**Why these names:**

- `title` — universal concept, no adapter uses a different term for this.
- `publish` — clearer intent than a negated `hide` flag. Matches publishing terminology used across platforms.
- `collection` — neutral term for "the top-level grouping this page belongs to." Avoids Confluence's "Space" or any adapter-specific jargon. Maps naturally to Confluence Spaces, Linear Projects, Notion Databases, SharePoint Sites, or any future adapter's grouping concept.
- `parent` — universal concept of page hierarchy.
- `tags` — universal. Every documentation platform has some form of labeling.
- `order` — self-explanatory numeric sort.
- `slug` — well-understood web concept for URL-safe identifiers.

### 5.4 Sync Workflow

**On push to `main` (CI/CD — primary flow):**

```
push to main → GitHub Action triggers → docs-mirror sync runs →
  for each configured adapter:
    1. Load config + resolve frontmatter for each included file
    2. Ensure collection exists (create if missing)
    3. Ensure root page exists (create if missing)
    4. For each markdown file (respecting order):
       a. Convert markdown to adapter's format
       b. Prepend banner (if enabled)
       c. Create or update the page (matched by slug)
       d. Apply edit restrictions (if lock enabled and adapter supports it)
       e. Apply tags/labels
    5. Log results (created, updated, skipped, failed)
```

**Locally (development/testing):**

```bash
# Sync all files to all configured mirrors
npx docs-mirror sync

# Sync to a specific adapter only
npx docs-mirror sync --adapter confluence

# Dry run (show what would happen, no API calls)
npx docs-mirror sync --dry-run

# Sync a single file
npx docs-mirror sync docs/setup.md
```

Credentials for local sync are read from environment variables or a `.env` file in the repository root (which must be gitignored).

**Idempotency:** Every sync is idempotent. The engine matches existing pages by `slug` (derived from the frontmatter `slug` field or auto-generated from `title`). Running the sync twice with unchanged content produces no API calls on the second run (content hash comparison).

### 5.5 Uninstallation

```
$ npx docs-mirror uninstall

docs-mirror — uninstall

? Remove .github/workflows/docs-mirror.yml? (Y/n) Y
? Remove .docs-mirror.yml? (Y/n) Y
? Strip docs-mirror frontmatter from markdown files? (y/N) N

✔ Removed .github/workflows/docs-mirror.yml
✔ Removed .docs-mirror.yml
⚠ Frontmatter preserved (run with --strip-frontmatter to remove)

Remaining manual steps:
  1. Remove GitHub Actions secrets if no longer needed:
     → CONFLUENCE_EMAIL, CONFLUENCE_TOKEN, LINEAR_API_KEY
     (Settings → Secrets → Actions)
  2. Mirrored pages in Confluence/Linear are NOT deleted automatically.
     Delete them manually if desired, or they will remain as a snapshot.
```

The uninstall command is run via `npx` — no script lives in the repository. It removes only the files `docs-mirror` created. Frontmatter stripping is opt-in because the frontmatter fields (`title`, `tags`, etc.) are valid general-purpose metadata that the user may want to keep for other tools.

Mirrored pages are intentionally NOT deleted during uninstall. Automatic deletion of production documentation is dangerous. The user is informed and can delete manually.

---

## 6. Architecture

### 6.1 Core Engine

The sync engine is adapter-agnostic. It:

1. Reads `.docs-mirror.yml`
2. Discovers and parses markdown files (frontmatter + content)
3. Resolves effective config per file (frontmatter overrides → config defaults)
4. Iterates over configured adapters, calling each adapter's interface methods
5. Reports results

```
┌─────────────────────────────────┐
│           CLI / Action          │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│         Sync Engine             │
│  - Config resolution            │
│  - File discovery               │
│  - Frontmatter parsing          │
│  - Content hashing              │
│  - Orchestration loop           │
└────────┬──────────┬─────────────┘
         │          │
┌────────▼───┐ ┌───▼──────┐ ┌───▼──────┐
│ Confluence │ │  Linear  │ │ Webhook  │
│  Adapter   │ │  Adapter │ │ Adapter  │
└────────────┘ └──────────┘ └──────────┘
```

### 6.2 Adapter Interface

Every adapter implements the following TypeScript interface:

```typescript
interface Page {
  slug: string
  title: string
  content: string            // adapter-native format (Confluence storage format, Linear markdown)
  parentSlug?: string
  tags: string[]
  order: number
}

interface SyncResult {
  slug: string
  action: "created" | "updated" | "skipped" | "failed"
  url?: string               // URL of the page in the destination
  error?: string
}

interface Adapter {
  name: string

  validate(config: AdapterConfig): Promise<void>

  ensureCollection(name: string): Promise<{ id: string; url: string }>

  ensureRootPage(collection: string, title: string): Promise<{ id: string; slug: string }>

  convertMarkdown(markdown: string, sourceUrl: string, banner: boolean): string

  sync(collection: string, pages: Page[]): Promise<SyncResult[]>

  lock(collection: string, slugs: string[]): Promise<void>
}
```

- `validate` — checks that credentials are present and have sufficient permissions. Called before any sync. Fails fast with actionable error messages (e.g., "CONFLUENCE_TOKEN is missing. Create one at https://...").
- `ensureCollection` — creates the collection (Space, Project) if it does not exist. Returns its ID and URL.
- `ensureRootPage` — creates or locates the top-level page that all mirrored pages nest under.
- `convertMarkdown` — transforms GitHub-flavored markdown into the adapter's native content format. Optionally prepends the source-link banner.
- `sync` — creates or updates pages. Uses slug matching for idempotency. Returns per-page results.
- `lock` — applies edit restrictions on the mirror side (no-op for adapters that do not support it).

### 6.3 Mirror Protection

Mirrors are read-only projections. The workflow must prevent accidental edits on the mirror side from being silently overwritten on next sync (causing confusion and lost work). Two mechanisms work together:

**Banner injection:** Each mirrored page is prepended with a visible notice:

> **Confluence** — rendered as an `info` macro panel at the top of the page:

```html
<ac:structured-macro ac:name="info">
  <ac:parameter ac:name="title">Mirrored from GitHub</ac:parameter>
  <ac:rich-text-body>
    <p>This page is automatically published from
      <a href="https://github.com/{org}/{repo}/blob/main/{path}">{org}/{repo}/{path}</a>.
      Edits made here will be overwritten on next sync.
      <a href="https://github.com/{org}/{repo}/edit/main/{path}">Edit on GitHub →</a>
    </p>
  </ac:rich-text-body>
</ac:structured-macro>
```

> **Linear** — rendered as a blockquote callout (Linear documents are markdown-native):

```markdown
> **📄 Mirrored from GitHub** — This document is published from
> [{org}/{repo}/{path}](https://github.com/{org}/{repo}/blob/main/{path}).
> Edits here will be overwritten on next sync.
> [Edit on GitHub →](https://github.com/{org}/{repo}/edit/main/{path})

---
```

**Edit restrictions (where supported):**

| Adapter | Mechanism | Behavior |
|---|---|---|
| Confluence | Content restrictions API (`PUT /wiki/rest/api/content/{id}/restriction`) | Page editing restricted to the service account used by `docs-mirror`. Other users can view but not edit. Admins can override. |
| Linear | Not supported | Linear's API does not expose document-level edit restrictions. The banner is the sole protection. The adapter setup guide instructs teams to establish a convention that mirrored documents (identifiable by the banner) are not edited directly. |
| Webhook | Optional (`lock_page` endpoint) | If the user configures a `lock_page` endpoint in the template, the adapter calls it after each sync. If left blank, the banner is the sole protection. |

Edit restrictions are enabled by default for adapters that support them (`lock: true` in config). Users can disable restrictions per adapter if their workflow requires collaborative editing on both sides (accepting the risk of overwrite).

---

## 7. Adapter: Confluence Cloud

### 7.1 API Surface

The Confluence adapter uses the **Confluence Cloud REST API v2** (and v1 for operations not yet available in v2).

| Operation | Endpoint | API Version |
|---|---|---|
| List spaces | `GET /wiki/api/v2/spaces` | v2 |
| Create space | `POST /wiki/api/v2/spaces` | v2 |
| Search pages | `GET /wiki/api/v2/pages?title={title}&space-id={id}` | v2 |
| Create page | `POST /wiki/api/v2/pages` | v2 |
| Update page | `PUT /wiki/api/v2/pages/{id}` | v2 |
| Get page properties | `GET /wiki/api/v2/pages/{id}/properties` | v2 |
| Set page property | `POST /wiki/api/v2/pages/{id}/properties` | v2 |
| Set content restriction | `PUT /wiki/rest/api/content/{id}/restriction` | v1 |
| Add page labels | `POST /wiki/rest/api/content/{id}/label` | v1 |

**Content format:** Pages are created with body in `storage` format (Confluence's XHTML-like markup). The adapter's `convertMarkdown` method transforms GitHub-flavored markdown to Confluence storage format, handling:

- Headings, paragraphs, lists, tables
- Code blocks (rendered as Confluence code macros with language hints)
- Images (uploaded as attachments, referenced inline)
- Links (relative repo links rewritten to absolute GitHub URLs)
- Mermaid diagrams (rendered as code blocks with a note, or converted to images via a rendering service if configured)

**Idempotency:** The adapter stores a custom page property `docs-mirror-slug` on each page. On subsequent syncs, pages are matched by this property rather than by title alone, preventing duplicates if a page is renamed in the mirror.

A content hash (`docs-mirror-hash`) is also stored as a page property. If the hash matches, the page update is skipped entirely, avoiding unnecessary API calls and version history noise.

### 7.2 Credentials

| Credential | Environment Variable | Description |
|---|---|---|
| Email | `CONFLUENCE_EMAIL` | The email address of the Atlassian account used for API access. |
| API Token | `CONFLUENCE_TOKEN` | An Atlassian API token generated at https://id.atlassian.com/manage-profile/security/api-tokens. |

**Authentication method:** HTTP Basic Auth with `{email}:{token}` base64-encoded in the `Authorization` header. This is the standard authentication method for Confluence Cloud REST API.

**Required permissions:** The account associated with the token must have:

- **Space Admin** permission on target spaces (or org-level admin to create new spaces)
- **Add Pages** and **Update Pages** permission in each space
- **Set Page Restrictions** permission (if `lock: true`)

**How to obtain:**

1. Log in to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a label (e.g., "docs-mirror")
4. Copy the token — it is shown only once

The Confluence adapter setup guide (`docs/adapters/confluence.md` in the project repo) walks through this process with screenshots and troubleshooting steps for common permission issues.

### 7.3 Mapping

| docs-mirror concept | Confluence concept |
|---|---|
| `collection` | Space (identified by name; created with auto-generated key) |
| `root_page` | Top-level page in the space |
| `title` | Page title |
| `parent` | Parent page (child pages nested under it) |
| `slug` | Stored as `docs-mirror-slug` page property |
| `tags` | Page labels |
| `order` | Not natively ordered in Confluence; pages are ordered by explicit `page.position` property via API |

### 7.4 Page Locking and Banner

When `lock: true` (default):

1. After creating or updating a page, the adapter calls the content restriction API to set an **update restriction** limiting edits to the service account.
2. The info-panel banner (Section 6.3) is prepended to every page body.
3. The banner includes a direct "Edit on GitHub" link pointing to the file's edit URL on the repository's default branch.

When `lock: false`:

1. No edit restrictions are applied.
2. The banner is still prepended (unless `banner: false`), serving as a visual indicator that the page is mirrored.

---

## 8. Adapter: Linear Docs

### 8.1 API Surface

The Linear adapter uses the **Linear GraphQL API**.

| Operation | GraphQL Operation | Type |
|---|---|---|
| List projects | `projects(filter: { name: { eq: $name } })` | Query |
| Create project | `projectCreate(input: { name: $name, teamIds: [$teamId] })` | Mutation |
| Search documents | `documents(filter: { project: { id: { eq: $projectId } } })` or `searchDocuments(term: $title)` | Query |
| Create document | `documentCreate(input: { title, content, projectId })` | Mutation |
| Update document | `documentUpdate(id: $id, input: { title, content })` | Mutation |

**Content format:** Linear documents are stored as markdown natively. The adapter's `convertMarkdown` method performs minimal transformation:

- Relative repository links rewritten to absolute GitHub URLs
- Image references rewritten to absolute URLs (Linear fetches and caches remote images)
- Banner callout prepended as a blockquote

This is a significant advantage over Confluence — no format conversion is needed, and markdown fidelity is preserved.

**Idempotency:** The adapter appends a hidden HTML comment at the end of each document's content:

```markdown
<!-- docs-mirror:slug={slug}&hash={hash} -->
```

On subsequent syncs, documents are matched by searching for this marker. If the hash matches, the update is skipped.

### 8.2 Credentials

| Credential | Environment Variable | Description |
|---|---|---|
| API Key | `LINEAR_API_KEY` | A personal API key or OAuth token for the Linear API. |

**Authentication method:** Bearer token in the `Authorization` header.

**Required permissions:** The API key must belong to an account that has:

- **Member** or **Admin** role on the Linear workspace
- Write access to the target team/project

Personal API keys inherit the permissions of the account that created them. For a service account approach, create a dedicated Linear user (e.g., "docs-mirror-bot") and use its API key.

**How to obtain:**

1. Open Linear → Settings (gear icon) → My Account → API
2. Under "Personal API keys", click "Create key"
3. Give it a label (e.g., "docs-mirror")
4. Copy the key

For **OAuth 2.0** (recommended for published integrations or multi-workspace setups):

1. Register an application at https://linear.app/settings/api/applications
2. Request scopes: `read`, `write`
3. Use the OAuth flow to obtain an access token
4. Set `LINEAR_API_KEY` to the OAuth access token

The Linear adapter setup guide (`docs/adapters/linear.md`) covers both methods with step-by-step instructions.

### 8.3 Mapping

| docs-mirror concept | Linear concept |
|---|---|
| `collection` | Project (documents grouped under a project) |
| `root_page` | A top-level document in the project (serves as index/parent) |
| `title` | Document title |
| `parent` | Not natively hierarchical in Linear; simulated via title prefixing or document order |
| `slug` | Stored as hidden HTML comment marker in document content |
| `tags` | Not supported by Linear Docs API; stored in marker comment for metadata preservation |
| `order` | `sortOrder` field on the document |

### 8.4 Document Protection and Banner

Linear does not expose document-level edit restrictions via its API. Protection relies on:

1. **Banner** (default `banner: true`): A blockquote callout prepended to the document content (see Section 6.3).
2. **Convention guidance**: The Linear adapter setup guide instructs teams to establish a team convention that documents with the mirror banner are not edited in Linear.
3. **Overwrite on sync**: If someone edits a mirrored document in Linear, the next sync overwrites those changes. The banner warns about this explicitly.

---

## 9. Adapter: Webhook (Generic / Custom CMS)

The webhook adapter is a **template-driven** adapter that lets users mirror documentation to any CMS or platform that exposes an HTTP API — without writing code. It ships as an inactive YAML template (`templates/webhook.yml`) in the project repository. The project README links to this template and directs users who need a destination beyond Confluence or Linear to read the inline instructions and fill it out.

### 9.1 How It Works

The user copies `templates/webhook.yml` into their repo (e.g., as `.docs-mirror-webhook.yml`) and fills out the endpoint URLs, auth, and field mappings by following the comments. They then reference it in `.docs-mirror.yml`:

```yaml
mirrors:
  - adapter: webhook
    template: .docs-mirror-webhook.yml
```

The sync engine loads the template, resolves credentials from environment variables, and makes HTTP calls to the configured endpoints for each adapter interface operation (ensure collection, create page, update page, etc.).

### 9.2 Template Design

The template file (`templates/webhook.yml`) ships fully commented with instructions. Every field is explained inline so the file itself serves as the documentation. The template is **not active** by default — it has no URLs filled in, and the engine skips it if referenced but incomplete.

```yaml
# ============================================================================
# docs-mirror: Generic Webhook Adapter Template
# ============================================================================
#
# This template lets you mirror documentation to any CMS or platform that
# has an HTTP API. Copy this file into your repository, fill out the
# sections below, and reference it in your .docs-mirror.yml:
#
#   mirrors:
#     - adapter: webhook
#       template: .docs-mirror-webhook.yml
#
# Every endpoint below maps to an operation the sync engine needs. If your
# CMS does not support an operation (e.g., locking pages), leave that
# endpoint blank and the engine will skip it.
#
# Placeholders like {collection}, {slug}, {title}, {page_id} are replaced
# at runtime with actual values from your config and frontmatter.
#
# ============================================================================

# --- Authentication ---------------------------------------------------------
#
# Choose ONE auth method. The engine reads credentials from environment
# variables — never put secrets directly in this file.
#
# Supported methods:
#   bearer   — Authorization: Bearer <token>
#   basic    — Authorization: Basic base64(<username>:<password>)
#   header   — A custom header name + value (e.g., X-API-Key)
#   none     — No authentication (for internal / localhost APIs)

auth:
  method: bearer                       # bearer | basic | header | none

  # For "bearer":
  token_env: WEBHOOK_TOKEN             # env var name containing the token

  # For "basic":
  # username_env: WEBHOOK_USERNAME     # env var name for username
  # password_env: WEBHOOK_PASSWORD     # env var name for password

  # For "header":
  # header_name: X-API-Key            # the header name to set
  # header_value_env: WEBHOOK_API_KEY  # env var name for the header value

# --- Content format ---------------------------------------------------------
#
# How should the markdown body be sent to your CMS?
#   markdown  — send the raw markdown as-is (e.g., Linear, Ghost, Dev.to)
#   html      — convert markdown to HTML before sending (e.g., WordPress, Drupal)

content_format: markdown               # markdown | html

# --- Endpoints --------------------------------------------------------------
#
# Each endpoint maps to one adapter interface operation. Configure the HTTP
# method, URL, and request body template for each.
#
# URLs can contain placeholders: {collection}, {slug}, {title}, {page_id}
# Body templates use the same placeholders plus {content} for the page body.
#
# If your CMS uses a single "upsert" endpoint for both create and update,
# set the same URL for both create_page and update_page.

endpoints:

  # Check if a collection (space, project, folder) exists.
  # Should return 2xx if it exists. The engine uses this before creating.
  get_collection:
    method: GET
    url: ""                            # e.g., https://cms.example.com/api/spaces/{collection}
    # Expected: 200 if exists, 404 if not

  # Create a new collection. Called only if get_collection returns 404.
  create_collection:
    method: POST
    url: ""                            # e.g., https://cms.example.com/api/spaces
    body: |
      {
        "name": "{collection}"
      }
    # Expected: 2xx on success. Response must include an "id" field (or
    # configure id_path below to tell the engine where to find it).

  # Look up an existing page by slug. Used for idempotent sync.
  get_page:
    method: GET
    url: ""                            # e.g., https://cms.example.com/api/pages?slug={slug}&space={collection}
    # Expected: 200 with page data if found, 404 if not.

  # Create a new page.
  create_page:
    method: POST
    url: ""                            # e.g., https://cms.example.com/api/pages
    body: |
      {
        "title": "{title}",
        "slug": "{slug}",
        "space": "{collection}",
        "parent": "{parent}",
        "body": "{content}",
        "tags": {tags}
      }
    # Expected: 2xx on success. Response must include the created page's ID.

  # Update an existing page. {page_id} is resolved from the get_page response.
  update_page:
    method: PUT
    url: ""                            # e.g., https://cms.example.com/api/pages/{page_id}
    body: |
      {
        "title": "{title}",
        "body": "{content}",
        "tags": {tags}
      }
    # Expected: 2xx on success.

  # (Optional) Lock a page from editing. Leave blank if unsupported.
  lock_page:
    method: ""
    url: ""                            # e.g., PUT https://cms.example.com/api/pages/{page_id}/lock
    body: ""

# --- Response parsing -------------------------------------------------------
#
# Tell the engine where to find IDs and URLs in your API's JSON responses.
# Uses dot-notation paths (e.g., "data.id", "result.url").

response:
  id_path: id                          # JSON path to the resource ID in create/get responses
  url_path: url                        # JSON path to the page URL (for sync result logs)

# --- Banner -----------------------------------------------------------------
#
# The banner is prepended to every page body before sending. It warns
# readers that the page is mirrored and links back to the GitHub source.
# Set to false to disable. The {source_url} and {edit_url} placeholders
# are replaced with the actual GitHub links at runtime.
#
# For markdown content_format, this is a markdown blockquote.
# For html content_format, this is an HTML div.

banner: true
```

### 9.3 Credentials

The webhook adapter reads credentials from environment variables named in the template's `auth` section. This keeps the credential model identical to the built-in adapters — secrets in GitHub Actions secrets or local `.env`, referenced by variable name.

| Auth Method | Required Env Vars | Typical Use Case |
|---|---|---|
| `bearer` | `WEBHOOK_TOKEN` (configurable name) | Most modern APIs (Ghost, Notion, Strapi) |
| `basic` | `WEBHOOK_USERNAME`, `WEBHOOK_PASSWORD` | Legacy CMS systems (WordPress XML-RPC, older Drupal) |
| `header` | `WEBHOOK_API_KEY` (configurable name + header) | APIs using custom header auth (X-API-Key, etc.) |
| `none` | — | Internal APIs behind a VPN or localhost development |

The env var names are configurable in the template — `WEBHOOK_TOKEN` is the default, but users can rename them to anything (e.g., `GHOST_API_KEY`, `STRAPI_TOKEN`). The workflow file must pass these as secrets the same way it does for Confluence or Linear.

### 9.4 Mapping to the Adapter Interface

The webhook adapter implements the same `Adapter` interface as Confluence and Linear. Each method maps to one or more configured endpoints:

| Adapter Method | Webhook Endpoint(s) Used |
|---|---|
| `validate` | Attempts a `GET` to `get_collection` to verify auth works. Fails fast if 401/403. |
| `ensureCollection` | Calls `get_collection`. If 404, calls `create_collection`. |
| `ensureRootPage` | Calls `get_page` with the root page slug. If 404, calls `create_page`. |
| `convertMarkdown` | Converts to `content_format` (passthrough for `markdown`, render for `html`). Prepends banner. |
| `sync` | For each page: `get_page` → if exists, `update_page`; if not, `create_page`. |
| `lock` | Calls `lock_page` if configured. No-op if endpoint is blank. |

### 9.5 Activation

The template is inactive by default. To activate it:

1. Copy `templates/webhook.yml` to your repo root (e.g., `.docs-mirror-webhook.yml`)
2. Fill in the endpoint URLs and auth method by following the inline comments
3. Add `adapter: webhook` with `template:` pointing to your filled-out file in `.docs-mirror.yml`
4. Add the relevant secrets to GitHub Actions (whatever env var names you chose in the `auth` section)

The project README includes a section linking to the template and explaining this flow. The `docs/adapters/webhook.md` guide provides worked examples for common CMS platforms (WordPress, Ghost, Strapi, Drupal) showing what a completed template looks like for each.

---

## 10. GitHub Action

The project publishes a composite GitHub Action to the GitHub Marketplace. Users reference it in their workflow:

```yaml
name: Mirror Docs
on:
  push:
    branches: [main]
    paths:
      - 'README.md'
      - 'docs/**'
      - '.docs-mirror.yml'

permissions:
  contents: read

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docs-mirror/docs-mirror@v1
        with:
          config: .docs-mirror.yml
        env:
          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
          CONFLUENCE_TOKEN: ${{ secrets.CONFLUENCE_TOKEN }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
```

**Design decisions for the workflow:**

- **Trigger on push to `main` only** — mirrors reflect the merged, reviewed state of documentation. Draft PRs and feature branches do not trigger syncs.
- **Path filtering** — the workflow only runs when documentation files or the config file change, not on every push.
- **`contents: read` permission** — the Action only needs to read the repository. It does not write back to the repo.
- **Secrets passed as environment variables** — follows the standard GitHub Actions pattern. No secrets in the config file.
- **Composite action** — the `action.yml` in the project repo sets up Deno and runs the sync command. No Docker image to pull, no container startup time. Typical run completes in under 30 seconds for repositories with fewer than 50 documentation files.

The `init` command generates this workflow file automatically. Users who want to customize triggers (e.g., sync on a schedule, sync on release tags) can edit the workflow file directly — it is standard GitHub Actions YAML.

---

## 11. Secrets and Credentials

### 11.1 GitHub Actions (CI/CD) — Primary Flow

Secrets are stored as **GitHub Actions secrets** in the repository settings:

```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

| Secret Name | Adapters | Value |
|---|---|---|
| `CONFLUENCE_EMAIL` | Confluence | Atlassian account email |
| `CONFLUENCE_TOKEN` | Confluence | Atlassian API token |
| `LINEAR_API_KEY` | Linear | Linear personal API key or OAuth token |

Non-secret configuration (like `CONFLUENCE_URL`) can optionally be stored as **GitHub Actions variables** (Settings → Secrets and variables → Actions → Variables tab) and referenced in the workflow as `${{ vars.CONFLUENCE_URL }}`. However, since this value is already in `.docs-mirror.yml`, using repository variables is optional and primarily useful for organizations that want to centralize configuration at the organization level using organization-level variables.

### 11.2 Local Development

For running `npx docs-mirror sync` locally:

**Option A: Environment variables (recommended)**

```bash
export CONFLUENCE_EMAIL="you@company.com"
export CONFLUENCE_TOKEN="your-token"
export LINEAR_API_KEY="lin_api_..."
npx docs-mirror sync
```

**Option B: `.env` file**

Create a `.env` file in the repository root (must be in `.gitignore`):

```
CONFLUENCE_EMAIL=you@company.com
CONFLUENCE_TOKEN=your-token
LINEAR_API_KEY=lin_api_...
```

The CLI loads `.env` automatically using Deno's built-in `.env` support. The `init` command ensures `.env` is in `.gitignore`.

**Option C: System keychain / secret manager (advanced)**

For teams that use tools like `1password-cli`, `aws-vault`, or `gcloud secrets`:

```bash
CONFLUENCE_TOKEN=$(op read "op://Vault/confluence/token") npx docs-mirror sync
```

The CLI does not integrate with specific secret managers but works with any tool that can inject environment variables.

### 11.3 Infrastructure-as-Code

For Pulumi and Terraform modules (Section 12), secrets are passed as stack/workspace configuration and provisioned as GitHub Actions secrets via the GitHub API. See Section 12 for details.

---

## 12. Infrastructure-as-Code Modules

The CLI (`npx docs-mirror init`) is the right tool for a single repo. For organizations that manage repositories through infrastructure-as-code, the project provides Pulumi and Terraform modules that do the same job declaratively: given a repository, the module provisions it to have a working `docs-mirror` workflow — config file, workflow file, and secrets — all managed as IaC state.

The key difference from the CLI: the IaC modules treat the workflow configuration as a **managed resource**. If someone manually deletes the workflow file or changes a secret, the next IaC apply restores it. This is the correct model for teams that provision dozens or hundreds of repos from a central pipeline.

Modules are located in `deploy/pulumi/` and `deploy/terraform/` with docs in `docs/advanced/`.

### 12.1 What the Modules Provision

For a given repository, each module manages exactly these resources:

| Resource | Purpose |
|---|---|
| `.github/workflows/docs-mirror.yml` | The GitHub Actions workflow file, committed to the repo via the GitHub Contents API |
| `.docs-mirror.yml` | The mirror configuration file, committed to the repo |
| GitHub Actions secrets | One secret per credential required by the configured adapters |

The modules do NOT manage frontmatter in markdown files. Frontmatter is content, not infrastructure — it is managed by the `init` CLI or by authors directly. After IaC provisions the repo, the team runs `npx docs-mirror init --config-only=false` to add frontmatter to their existing markdown files, or adds it manually.

### 12.2 Pulumi Module

**Location:** `deploy/pulumi/`  
**Language:** TypeScript  
**Provider:** `@pulumi/github`

```typescript
import { DocsMirror } from "docs-mirror/deploy/pulumi";

const mirror = new DocsMirror("my-service", {
  repository: "acme/my-service",
  branch: "main",
  collection: "Engineering Docs",
  adapters: {
    confluence: {
      url: "https://acme.atlassian.net",
      email: confluenceEmailSecret,
      token: confluenceTokenSecret,
    },
    linear: {
      apiKey: linearKeySecret,
    },
  },
  source: {
    include: ["README.md", "docs/**/*.md"],
  },
});

export const workflowUrl = mirror.workflowUrl;
```

**What happens on `pulumi up`:**

1. Generates `.docs-mirror.yml` content from the `collection`, `adapters`, and `source` inputs
2. Creates/updates the config file in the repo via `github.RepositoryFile`
3. Creates/updates the workflow file in the repo via `github.RepositoryFile`
4. Creates/updates `github.ActionsSecret` resources for each adapter's credentials
5. Outputs the workflow URL and list of secret names provisioned

**Fleet rollout** — provision multiple repos from one stack:

```typescript
const repos = ["acme/service-a", "acme/service-b", "acme/service-c"];

for (const repo of repos) {
  new DocsMirror(repo.split("/")[1], {
    repository: repo,
    collection: "Engineering Docs",
    adapters: {
      confluence: { url: "https://acme.atlassian.net", email, token },
    },
  });
}
```

### 12.3 Terraform Module

**Location:** `deploy/terraform/`  
**Provider:** `integrations/github`

```hcl
module "docs_mirror" {
  source     = "github.com/docs-mirror/docs-mirror//deploy/terraform"

  repository = "acme/my-service"
  branch     = "main"
  collection = "Engineering Docs"

  confluence_url   = "https://acme.atlassian.net"
  confluence_email = var.confluence_email
  confluence_token = var.confluence_token       # sensitive
  linear_api_key   = var.linear_api_key         # sensitive

  source_include = ["README.md", "docs/**/*.md"]
}

output "workflow_url" {
  value = module.docs_mirror.workflow_url
}
```

**What happens on `terraform apply`:**

1. Renders `.docs-mirror.yml` from the input variables using an internal template
2. Manages `github_repository_file` for both the config and workflow files
3. Manages `github_actions_secret` for each non-null credential variable
4. Outputs `workflow_url` and `secrets_configured`

**Fleet rollout** — provision across repos with `for_each`:

```hcl
variable "repositories" {
  type    = list(string)
  default = ["acme/service-a", "acme/service-b", "acme/service-c"]
}

module "docs_mirror" {
  for_each   = toset(var.repositories)
  source     = "github.com/docs-mirror/docs-mirror//deploy/terraform"
  repository = each.value
  collection = "Engineering Docs"

  confluence_url   = var.confluence_url
  confluence_email = var.confluence_email
  confluence_token = var.confluence_token
  linear_api_key   = var.linear_api_key
}
```

### 12.4 Removing docs-mirror via IaC

Removing the module from the stack/workspace and running apply deletes the managed resources: the workflow file, the config file, and the GitHub Actions secrets are all removed. This is the IaC equivalent of `npx docs-mirror uninstall`. Frontmatter in markdown files is unaffected (it was never managed by the module).

---

## 13. Per-Adapter Setup Guides

**The project must ship a dedicated setup guide for each supported adapter.** These guides are user-facing documentation (not code), located in `docs/adapters/` in the project repository. Each guide must cover:

1. **Prerequisites** — what accounts and permissions are needed before starting
2. **Credential creation** — step-by-step instructions with screenshots showing where to create API tokens/keys, what to name them, and what scopes to select
3. **Configuration** — the adapter-specific fields in `.docs-mirror.yml` with annotated examples
4. **Verification** — how to run `npx docs-mirror sync --dry-run --adapter {name}` to verify the setup works before committing
5. **Troubleshooting** — common errors and their resolutions (e.g., 401 unauthorized, space not found, insufficient permissions)
6. **Mirror protection** — what edit restrictions look like in the destination platform, how admins can override them, and the team convention for not editing mirrored pages

### Guide: Confluence (`docs/adapters/confluence.md`)

Must additionally cover:
- How to find the correct Confluence base URL (cloud vs. data center distinction, common mistakes)
- How Confluence Spaces work and how to choose a Space name
- How page hierarchy maps to the `docs/` folder structure
- The info-panel banner appearance and how admins can customize it
- How to grant the API token account Space Admin permissions

### Guide: Linear (`docs/adapters/linear.md`)

Must additionally cover:
- Personal API key vs. OAuth — when to use which
- How Linear Projects map to the `collection` concept
- The markdown-native advantage (no format conversion loss)
- The limitation around edit restrictions and the recommended team convention
- How to create a dedicated "docs-mirror" service account for team use

### Guide: Webhook / Custom CMS (`docs/adapters/webhook.md`)

Must additionally cover:
- How to copy and fill out the `templates/webhook.yml` file
- Worked examples of completed templates for common CMS platforms (WordPress REST API, Ghost Admin API, Strapi, Drupal JSON:API)
- How to test a webhook adapter locally with `npx docs-mirror sync --dry-run --adapter webhook`
- How each auth method works and when to use which
- How to map your CMS's response format to the `response.id_path` and `response.url_path` fields
- Debugging tips: how to inspect the actual HTTP requests the adapter makes (`--verbose` flag)

---

## 14. Edge Cases

| Scenario | Behavior |
|---|---|
| File has `publish: false` | File is skipped entirely. If a previously-published page exists in the mirror, it is NOT deleted (to avoid accidental content loss). A log warning is emitted suggesting manual deletion if intended. |
| File has no frontmatter | The sync engine skips the file and logs a warning. The `init` command should have added frontmatter; missing frontmatter indicates a file was added after init without running it again. |
| `collection` does not exist in the mirror | The adapter creates it automatically (Confluence: new Space, Linear: new Project). |
| `collection` creation fails (permissions) | The adapter logs an actionable error message with a link to the relevant permission documentation. The sync continues for other adapters. |
| Page title collision | The `slug` property (stored in the destination as metadata) is the authoritative identifier, not the title. Two files can have the same title in different parent contexts. |
| Large files (>1MB) | The adapter logs a warning. Confluence has a page body size limit (~5MB storage format). Linear has no documented limit but performance degrades on very large documents. |
| Binary files in `docs/` | Ignored. Only `.md` files matching `source.include` patterns are processed. |
| `README.md` missing | Not an error. If `source.include` lists `README.md` but it does not exist, the engine skips it silently. |
| Adapter API rate limiting | The engine implements exponential backoff with jitter. Confluence Cloud rate limits are generous (~100 req/s). Linear rate limits are lower (~250 req/min for complexity-based limits). The engine batches requests where possible. |
| Concurrent syncs | The workflow uses GitHub Actions concurrency groups (`concurrency: { group: docs-mirror, cancel-in-progress: true }`) to prevent parallel syncs from conflicting. |
| Markdown features unsupported by adapter | Graceful degradation. Unsupported features (e.g., Mermaid diagrams in Confluence without a rendering plugin) are rendered as code blocks with the original source. |
| Network failure mid-sync | The engine processes files sequentially per adapter. Completed pages are not rolled back. The next sync run picks up where the failure occurred (idempotency via slug matching). |

---

## 15. Future Extensibility

The adapter interface (Section 6.2) is designed for community extension. Future directions include:

- **Notion adapter** — Notion's API supports page creation and rich text blocks. The `collection` concept maps to a Notion database or top-level page.
- **SharePoint adapter** — for organizations using Microsoft 365 as their documentation hub.
- **GitBook adapter** — GitBook's API supports space and page management; `collection` maps to a GitBook space.
- **Bidirectional sync** — a future major version could support conflict detection and merge strategies for two-way sync. This is deliberately excluded from v1 to keep the mental model simple.
- **PR preview** — a future enhancement where the Action runs on pull requests and posts a comment with a diff preview of what would change in the mirror, without actually syncing.

Community adapters can be distributed as separate Deno/npm modules that export a class implementing the `Adapter` interface. The config file would reference them by package name:

```yaml
mirrors:
  - adapter: "@my-org/docs-mirror-notion"
    collection: Engineering Wiki
```

Users who need a quick integration without building a full adapter can use the webhook adapter template (Section 9) to point at any HTTP API.

---

## 16. References

### APIs

- [Confluence Cloud REST API v2](https://developer.atlassian.com/cloud/confluence/rest/v2/intro/) — page and space management
- [Confluence Content Restrictions](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content-restrictions/) — edit locking
- [Atlassian API Token Management](https://id.atlassian.com/manage-profile/security/api-tokens) — credential creation
- [Linear GraphQL API](https://developers.linear.app/docs/graphql/working-with-the-graphql-api) — document and project management
- [Linear Authentication](https://developers.linear.app/docs/graphql/working-with-the-graphql-api#authentication) — API keys and OAuth

### Standards and Patterns

- [GitHub Actions: Creating a Composite Action](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action) — action packaging
- [GitHub Actions: Encrypted Secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) — credential management
- [Deno 2](https://deno.com/) — runtime and toolchain
- [YAML Frontmatter](https://jekyllrb.com/docs/front-matter/) — frontmatter parsing conventions

### Infrastructure-as-Code

- [Pulumi GitHub Provider](https://www.pulumi.com/registry/packages/github/) — GitHub resource management
- [Terraform GitHub Provider](https://registry.terraform.io/providers/integrations/github/latest/docs) — GitHub resource management

---

**End of RFC**