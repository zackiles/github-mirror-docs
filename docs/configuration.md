# Configuration Reference

The `.docs-mirror.yml` file in your repository root controls which files are mirrored and where.

## Minimal config

One adapter, defaults for everything else:

```yaml
collection: Engineering Docs

mirrors:
  - adapter: confluence
    url: https://acme.atlassian.net
```

With this minimal config, docs-mirror will:

- Include `README.md` and `docs/**/*.md` by default
- Use your README.md H1 heading as the root page title
- Infer page hierarchy from your directory structure
- Create or find the "Engineering Docs" Confluence Space
- Nest all mirrored pages under a root page in that space

## Full config

All options with both adapters:

```yaml
collection: Engineering Docs

source:
  include:
    - README.md
    - docs/**/*.md
  exclude: []

defaults:
  publish: true
  tags: []

mirrors:
  - adapter: confluence
    url: https://acme.atlassian.net
    collection: Engineering Docs
    root_page: acme/my-service
    lock: true
    banner: true

  - adapter: linear

  - adapter: webhook
    template: .docs-mirror-webhook.yml
```

## Field reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `collection` | Yes | — | Default collection name (Confluence Space, Linear Project, or equivalent). |
| `source.include` | No | `["README.md", "docs/**/*.md"]` | Glob patterns for files to mirror. |
| `source.exclude` | No | `[]` | Glob patterns for files to skip. |
| `defaults.publish` | No | `true` | Default publish state for files without explicit frontmatter. |
| `defaults.tags` | No | `[]` | Tags applied to all mirrored pages. |
| `mirrors` | Yes | — | Array of mirror definitions. Must have at least one. |
| `mirrors[].adapter` | Yes | — | `confluence`, `linear`, or `webhook`. |
| `mirrors[].url` | Yes (confluence) | — | Confluence base URL (e.g. `https://acme.atlassian.net`). |
| `mirrors[].collection` | No | Top-level `collection` | Override collection for this mirror. |
| `mirrors[].root_page` | No | README.md title, or repo name | Top-level page title. When omitted, the root README.md H1 heading is used. Falls back to the repository name from the git remote. |
| `mirrors[].lock` | No | `true` | Lock mirrored pages from editing (Confluence only; Linear has no lock support). |
| `mirrors[].banner` | No | `true` | Add "Mirrored from GitHub" banner with edit link to each page. |
| `mirrors[].template` | Yes (webhook) | — | Path to webhook YAML template file. |

## Root page conventions

The root page is the top-level page in the mirror under which all your docs nest. Its title is resolved in this order:

1. **`mirrors[].root_page`** in config — explicit override for power users
2. **README.md title** — the H1 heading or frontmatter `title` of your root README.md
3. **Repository name** — derived from the git remote (e.g. `my-service`)
4. **`"Documentation"`** — ultimate fallback

Your root README.md content becomes the body of this root page. This gives non-technical stakeholders a proper landing page in Confluence or Linear without any extra configuration.

## Per-adapter config

### Confluence

```yaml
mirrors:
  - adapter: confluence
    url: https://acme.atlassian.net
    collection: Engineering Docs
    root_page: acme/my-service
    lock: true
    banner: true
```

- `url` — Required. Your Confluence Cloud instance URL.
- `collection` — Confluence Space name. Created if it does not exist.
- `root_page` — Top-level page in the space. Defaults to README.md title, then repo name.
- `lock` — Restrict editing to the sync user. Default `true`.
- `banner` — Prepend source link banner. Default `true`.

### Linear

```yaml
mirrors:
  - adapter: linear
    collection: Engineering Docs
    banner: true
```

- `collection` — Linear Project name. Created under your first team if it does not exist.
- `root_page` — Root document title in the project. Defaults to README.md title, then repo name.
- `banner` — Prepend source link banner. Default `true`.
- `lock` — Not supported by Linear; ignored.

### Webhook

```yaml
mirrors:
  - adapter: webhook
    template: .docs-mirror-webhook.yml
    collection: Engineering Docs
    banner: true
```

- `template` — Required. Path to a YAML file defining endpoints, auth, and response parsing. See [Webhook / Custom CMS](adapters/webhook.md).
- `collection` — Collection name passed to the template endpoints.
- `root_page` — Root page title.
- `banner` — Prepend source link banner. Default `true`.

## Environment variables

Credentials are read from environment variables (or `.env` for local sync). Never put secrets in `.docs-mirror.yml`.

| Variable | Adapter | Description |
|----------|---------|-------------|
| `CONFLUENCE_EMAIL` | confluence | Your Confluence account email. |
| `CONFLUENCE_TOKEN` | confluence | API token from [Atlassian](https://id.atlassian.com/manage-profile/security/api-tokens). |
| `LINEAR_API_KEY` | linear | Personal API key from Linear → Settings → API. |
| `WEBHOOK_TOKEN` | webhook | Bearer token (or see template for `token_env`, `username_env`, etc.). |

In GitHub Actions, add these as repository secrets (Settings → Secrets and variables → Actions). The workflow passes them to the sync step via `env:`.
