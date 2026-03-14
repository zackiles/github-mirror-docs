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
    collection: Engineering Docs
    root_page: acme/my-service
    lock: true
    banner: true
```

| Field | Description |
|-------|-------------|
| `url` | Confluence base URL. No trailing slash. |
| `collection` | Space name. Created if it does not exist. |
| `root_page` | Top-level page title. Defaults to `{org}/{repo}` from git remote. |
| `lock` | Restrict editing to the sync user. Default `true`. |
| `banner` | Add "Mirrored from GitHub" info macro. Default `true`. |

## Finding the base URL

Your Confluence base URL is the domain you use to open Confluence:

- `https://acme.atlassian.net` — typical Cloud URL
- `https://acme.atlassian.net/wiki` — also valid; docs-mirror appends `/wiki` for API paths

Use the root domain without `/wiki` in config. Example: `https://acme.atlassian.net`.

## Collections and Spaces

The `collection` in config maps to a Confluence Space. Each mirror can use a different collection. If the space does not exist, docs-mirror creates it with a key derived from the name (e.g. "Engineering Docs" → key "ENGINEERINGDOCS").

Per-file `collection` in frontmatter overrides the config for that file.

## Page hierarchy

- **Root page** — Created under the space with the title from `root_page`. All mirrored pages nest under it.
- **Child pages** — Use `parent` in frontmatter to nest under another page. The parent value is the slug of the parent page.

Example: A page with `parent: getting-started` becomes a child of the page with slug `getting-started`.

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
