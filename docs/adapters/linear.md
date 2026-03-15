# Linear Setup

This guide walks through configuring docs-mirror to sync documentation to Linear.

## Prerequisites

- Linear workspace
- Member or Admin role (to create projects and documents)

## Credentials

docs-mirror uses a Personal API key. Create one:

1. In Linear, go to **Settings** (gear icon)
2. Open **API** → **Personal API keys**
3. Click **Create key**
4. Name it (e.g. "docs-mirror") and copy the key

Set the environment variable:

```
LINEAR_API_KEY=lin_api_xxxxxxxxxxxx
```

In GitHub Actions, add it as a repository secret (Settings → Secrets and variables → Actions).

## OAuth for multi-workspace setups

Personal API keys are scoped to a single workspace. For multiple workspaces, use OAuth to obtain workspace-specific tokens. docs-mirror does not include OAuth flow; you would need to obtain a token per workspace and configure each mirror with the appropriate credentials (e.g. via different env vars and workflow jobs).

## Configuration

Add the Linear mirror to `.docs-mirror.yml`:

```yaml
collection: Engineering Docs

mirrors:
  - adapter: linear
```

That's the minimal config. docs-mirror will:

- Create or find the "Engineering Docs" Project
- Use your README.md as the root document (title from H1)
- Sync all docs as documents in the project

For more control:

```yaml
mirrors:
  - adapter: linear
    collection: Engineering Docs
    root_page: My Service Docs
    banner: true
```

| Field | Description |
|-------|-------------|
| `collection` | Project name. Created under your first team if it does not exist. |
| `root_page` | Root document title. Defaults to README.md title, then repo name. |
| `banner` | Add "Mirrored from GitHub" blockquote. Default `true`. |

## How hierarchy maps to Linear

Linear Documents are **flat** — there is no parent-child nesting. docs-mirror adapts to this model:

- All mirrored documents are placed in a single Linear Project
- The root document (from README.md) serves as an overview/index
- Other documents are ordered by their `order` frontmatter field
- Directory-based hierarchy from the repository is reflected in ordering, not nesting

```
Project: Engineering Docs
  Documents:
    - My Service (root — from README.md)
    - Getting Started
    - Configuration
    - API (from docs/api/README.md)
    - Endpoints
    - Authentication
    - Pulumi
    - Terraform
```

The `parent` frontmatter field is accepted but has no structural effect in Linear — it is stored in the document marker for metadata purposes only. If you also mirror to Confluence, the same `parent` field produces real nesting there.

## Markdown-native advantage

Linear Documents use markdown natively. docs-mirror sends markdown directly without converting to Confluence storage format or HTML. Formatting, code blocks, and links are preserved. Relative links are rewritten to point at the GitHub source.

## Edit restrictions

Linear does not support document-level edit restrictions. The `lock` option in config is ignored for the Linear adapter. To avoid conflicts:

- Use a dedicated service account for docs-mirror and instruct the team not to edit mirrored documents
- Or accept that manual edits in Linear may be overwritten on the next sync

## Creating a dedicated service account

For production, create a Linear user (e.g. "docs-mirror@company.com") and generate a Personal API key for that account. Use it in GitHub Actions secrets. This separates sync activity from personal accounts and makes it clear which documents are mirrored.

## Verification

Run a dry-run to confirm configuration and credentials:

```bash
npx docs-mirror sync --dry-run --adapter linear
```

This validates the API key and lists what would be synced without making changes.

## Troubleshooting

### LINEAR_API_KEY is missing

- Set the env var or add it to `.env` for local sync
- In GitHub Actions, add `LINEAR_API_KEY` as a repository secret and pass it via `env:` in the workflow

### No Linear team found

- Create at least one team in your Linear workspace before syncing
- docs-mirror creates projects under the first team when the project does not exist

### API error on document create/update

- Verify the API key has not been revoked
- Ensure the account has Member or Admin role
- Check that the project name does not conflict with an existing project in another team
