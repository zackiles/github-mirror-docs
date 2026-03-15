# Notion Setup

This guide walks through configuring docs-mirror to sync documentation to Notion.

## Prerequisites

- Notion workspace
- Ability to create internal integrations (requires workspace member or admin role)
- A parent page shared with the integration

## Credentials

docs-mirror uses a Notion internal integration token. Create one:

1. Go to [My Integrations](https://www.notion.so/my-integrations)
2. Click **New integration**
3. Name it (e.g. "docs-mirror")
4. Select the workspace where you want docs synced
5. Under **Capabilities**, ensure **Read content**, **Update content**, and **Insert content** are enabled
6. Click **Save** and copy the **Internal Integration Secret**

Set the environment variable:

```
NOTION_TOKEN=ntn_xxxxxxxxxxxx
```

In GitHub Actions, add it as a repository secret (Settings → Secrets and variables → Actions).

## Sharing pages with the integration

After creating the integration, you must share the target page:

1. Open the Notion page where docs should be created
2. Click **···** (menu) → **Connections** → **Connect to** → select your integration
3. Confirm the integration can access the page and all child pages

Without this step, the integration cannot read or create pages under your target.

## Configuration

Add the Notion mirror to `.docs-mirror.yml`:

```yaml
collection: Engineering Docs

mirrors:
  - adapter: notion
```

That's the minimal config. docs-mirror will:

- Search for a page titled "Engineering Docs" accessible to the integration
- Create it at the workspace root if it does not exist
- Use your README.md as the root page (title from H1)
- Sync all docs as child pages under the root

For more control:

```yaml
mirrors:
  - adapter: notion
    collection: Engineering Docs
    root_page: My Service Docs
    page_id: 1234abcd-5678-efgh-ijkl-9012mnop3456
    banner: true
```

| Field | Description |
|-------|-------------|
| `collection` | Parent page title. Created if it does not exist. Ignored when `page_id` is set. |
| `root_page` | Root page title for the documentation tree. Defaults to README.md title, then repo name. |
| `page_id` | Explicit Notion page ID to use as the parent. Skips collection search/creation. |
| `banner` | Add "Mirrored from GitHub" callout. Default `true`. |

## Using page_id

If you already have a Notion page where docs should live, provide its ID directly:

1. Open the page in Notion
2. Click **···** → **Copy link**
3. The URL looks like `https://notion.so/Page-Title-1234abcdef5678ghijkl9012mnop3456`
4. The ID is the last 32 hex characters (add dashes if needed): `1234abcd-ef56-78gh-ijkl-9012mnop3456`

```yaml
mirrors:
  - adapter: notion
    page_id: 1234abcd-ef56-78gh-ijkl-9012mnop3456
```

When `page_id` is set, the `collection` field is ignored — all pages are created under the specified parent.

## How hierarchy maps to Notion

Notion pages naturally nest inside other pages. docs-mirror uses this to reproduce your repository's directory structure:

```
Parent page (collection or page_id)
  └── My Service (root page — from README.md)
        ├── Getting Started
        ├── Configuration
        ├── API (from docs/api/README.md)
        │   ├── Endpoints
        │   └── Authentication
        ├── Pulumi
        └── Terraform
```

**How it works:**

- Your repository's `README.md` content fills the **root page**. Its H1 heading becomes the root page title (unless overridden by `root_page` in config).
- Directory structure determines parent-child nesting. A `README.md` inside a subdirectory becomes the section index for that directory.
- Files without a directory README ancestor nest directly under the root page.
- Frontmatter `parent` overrides the inferred hierarchy for any file.

## Markdown handling

Notion pages store content as blocks, not raw markdown. docs-mirror converts your markdown files into Notion blocks. Supported elements:

- Headings (H1–H3)
- Paragraphs with inline formatting (bold, italic, code, links)
- Bulleted and numbered lists
- Code blocks with language highlighting
- Block quotes
- Images (external URLs)
- Dividers
- Tables (as simple text blocks)

Relative links in your markdown are rewritten to point at the GitHub source.

## Content tracking

docs-mirror tracks pages using a marker block at the end of each page containing `docs-mirror:slug=<slug>&hash=<hash>`. This is a regular paragraph block — visible but unobtrusive. It enables:

- **Skip unchanged pages** — if the content hash matches, no update is made
- **Find managed pages** — the marker identifies which pages docs-mirror owns
- **Conflict detection** — pages not managed by docs-mirror are never modified

## Edit restrictions

Notion does not support page-level edit restrictions via API. The `lock` option in config is ignored for the Notion adapter. To avoid conflicts:

- Use a dedicated integration and instruct the team not to edit mirrored pages
- Or accept that manual edits in Notion may be overwritten on the next sync

## Deleting pages

When a markdown file is removed from the repository, docs-mirror **archives** the corresponding Notion page rather than permanently deleting it. Archived pages can be restored from Notion's trash.

## GitHub Actions workflow

A workflow is generated automatically by `docs-mirror init`. For manual setup:

```yaml
name: Mirror Docs
on:
  push:
    branches: [main]
    paths:
      - 'README.md'
      - 'docs/**'
      - '.docs-mirror.yml'

jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docs-mirror/docs-mirror@v1
        with:
          config: .docs-mirror.yml
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
```

## CLI flags

```bash
npx docs-mirror sync --notion-token <token> --notion-page-id <id>
```

| Flag | Description |
|------|-------------|
| `--notion-token` | Overrides `NOTION_TOKEN` env var |
| `--notion-page-id` | Sets the parent page ID (overrides `page_id` in config) |

## Verification

Run a dry-run to confirm configuration and credentials:

```bash
npx docs-mirror sync --dry-run --notion-token <token>
```

This validates the integration token and lists what would be synced without making changes.

## Troubleshooting

### NOTION_TOKEN is missing

- Set the env var or add it to `.env` for local sync
- In GitHub Actions, add `NOTION_TOKEN` as a repository secret and pass it via `env:` in the workflow

### Notion auth failed (401)

- Verify the integration token is correct and has not been regenerated
- Ensure the integration has not been deleted at https://www.notion.so/my-integrations

### Page not found or not accessible

- The target page must be shared with the integration
- Open the page → **···** → **Connections** → verify the integration is listed
- If using `page_id`, double-check the ID format (32 hex characters with or without dashes)

### Rate limiting (429)

- Notion enforces rate limits on API requests
- docs-mirror retries automatically with exponential backoff and respects the `Retry-After` header
- For large documentation sets, consider splitting into multiple sync runs

### Content not rendering correctly

- Notion blocks have a 2000-character limit per rich text segment
- Very long paragraphs may be truncated
- Complex nested markdown (e.g. deeply nested lists) may flatten
- Images must be external URLs — local file paths are rewritten to GitHub URLs
