# Confluence Setup

This guide walks through configuring docs-mirror to sync documentation to Confluence Cloud.

## Prerequisites

- Atlassian Cloud account with access to Confluence
- Space Admin permissions (or ability to create spaces)
- Add/Update Pages and Set Page Restrictions permissions

## Credentials

docs-mirror uses email + API token authentication. Create an API token:

1. Go to [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Label it (e.g. "docs-mirror")
4. Copy the token and store it securely

Set these environment variables (or add to `.env` for local sync):

```
CONFLUENCE_EMAIL=your-email@company.com
CONFLUENCE_TOKEN=your-api-token
```

In GitHub Actions, add them as repository secrets (Settings → Secrets and variables → Actions).

## Required permissions

The account must have:

- **Space Admin** — Create spaces and manage space settings
- **Add/Update Pages** — Create and edit pages
- **Set Page Restrictions** — Lock pages so only the sync user can edit (optional but recommended)

## Configuration

Add the Confluence mirror to `.docs-mirror.yml`:

```yaml
collection: Engineering Docs

mirrors:
  - adapter: confluence
    url: https://your-company.atlassian.net
```

That's the minimal config. docs-mirror will:

- Create or find the "Engineering Docs" Space
- Use your README.md as the root page (title from H1)
- Infer hierarchy from your directory structure

For more control:

```yaml
mirrors:
  - adapter: confluence
    url: https://your-company.atlassian.net
    collection: Engineering Docs
    root_page: My Service Docs
    lock: true
    banner: true
```

| Field | Description |
|-------|-------------|
| `url` | Confluence base URL. No trailing slash. |
| `collection` | Space name. Created if it does not exist. |
| `root_page` | Top-level page title. Defaults to README.md title, then repo name. |
| `lock` | Restrict editing to the sync user. Default `true`. |
| `banner` | Add "Mirrored from GitHub" info macro. Default `true`. |

## Finding the base URL

Your Confluence base URL is the domain you use to open Confluence:

- `https://acme.atlassian.net` — typical Cloud URL
- `https://acme.atlassian.net/wiki` — also valid; docs-mirror appends `/wiki` for API paths

Use the root domain without `/wiki` in config. Example: `https://acme.atlassian.net`.

## How hierarchy maps to Confluence

docs-mirror creates a single sub-tree inside your Confluence Space. This means your mirrored docs occupy one branch of the page tree and never interfere with other content in the space.

```
Space: Engineering Docs
  ├── (other team pages, wikis, etc.)
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

**Safety:** docs-mirror only modifies pages it created. It marks every page with a `docs-mirror-slug` property. The root page is only updated if docs-mirror originally created it (checked via the marker property). Pages not managed by docs-mirror are never modified.

## Verification

Run a dry-run to confirm configuration and credentials:

```bash
npx docs-mirror sync --dry-run --adapter confluence
```

This validates credentials and lists what would be synced without making changes.

## Banner and page locking

**Banner:** When `banner: true` (default), each page gets an info macro at the top linking to the GitHub source and warning that edits will be overwritten.

**Locking:** When `lock: true` (default), pages created or updated by sync are restricted so only the `CONFLUENCE_EMAIL` account can edit. This prevents manual edits that would be overwritten on the next sync.

## Troubleshooting

### 401 Unauthorized

- Verify `CONFLUENCE_EMAIL` and `CONFLUENCE_TOKEN` are set
- Ensure the API token is valid and not revoked
- Check the token was created at https://id.atlassian.com/manage-profile/security/api-tokens

### Space not found

- Confirm the space name in `collection` matches exactly (case-sensitive)
- If the space should be created automatically, ensure the account has permission to create spaces
- Verify the base URL is correct for your Confluence instance

### Insufficient permissions

- The account needs Space Admin for the target space
- For locking, Set Page Restrictions permission is required
- If using a new space, the creating user becomes Space Admin by default
